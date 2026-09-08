//go:build testcontainers

package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestContainerControlLifecycleGuidanceAndDiagnostics(t *testing.T) {
	app := startContainerServer(t, 100)
	ctx := context.Background()
	admin := containerLogin(t, app.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, app.baseURL, admin, "UI diagnostics")
	product := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{"sku": "GUIDE-1", "name": "Learning item", "price": 100, "stock": 10})
	order := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []any{map[string]any{"product_id": product["id"], "quantity": 1}}})
	id := order["id"].(string)
	path := app.baseURL + "/control/v1/orders/" + id
	detail := containerJSON(t, "GET", path, admin, nil)
	ops := detail["operations"].(map[string]any)
	if ops["payment_status"] != "PENDING" || ops["provider_status"] != "UNPAID" {
		t.Fatalf("wrong initial guidance %v", ops)
	}
	choices := ops["cancellation_options"].([]any)
	if len(choices) != 1 || choices[0].(map[string]any)["actor"] != "CUSTOMER" {
		t.Fatalf("Shopee unpaid must only offer customer: %v", choices)
	}
	if status, _ := containerRawJSON(t, "POST", path+"/actions/cancel", admin, map[string]any{"actor": "SELLER", "reason": "OUT_OF_STOCK"}); status != 400 {
		t.Fatalf("illegal seller cancellation=%d", status)
	}
	containerJSON(t, "POST", path+"/actions/cancel", admin, map[string]any{"actor": "CUSTOMER", "reason": "ADDRESS_ISSUE"})
	detail = containerJSON(t, "GET", path, admin, nil)
	ops = detail["operations"].(map[string]any)
	if detail["status"] != "CANCELLED" || ops["cancellation_actor"] != "CUSTOMER" || ops["cancellation_reason"] != "ADDRESS_ISSUE" || len(ops["available_actions"].([]any)) != 0 {
		t.Fatalf("cancellation audit mismatch %v", detail)
	}
	if _, err := app.env.DB.Exec(ctx, `UPDATE shops SET provider_profile='TOKOPEDIA_LIKE' WHERE id=$1`, shop); err != nil {
		t.Fatal(err)
	}
	for _, state := range []struct{ canonical, provider string }{{"PAID", "ON_HOLD"}, {"PROCESSING", "AWAITING_SHIPMENT"}, {"READY_TO_SHIP", "AWAITING_COLLECTION"}, {"SHIPPED", "IN_TRANSIT"}, {"IN_DELIVERY", "IN_TRANSIT"}, {"CANCELLED", "CANCEL"}, {"RETURNED", "CANCEL"}} {
		if _, err := app.env.DB.Exec(ctx, `UPDATE orders SET status=$1 WHERE id=$2`, state.canonical, id); err != nil {
			t.Fatal(err)
		}
		result := containerJSON(t, "GET", path, admin, nil)
		if result["operations"].(map[string]any)["provider_status"] != state.provider {
			t.Fatalf("wrong projection for %s", state.canonical)
		}
	}
	// Legacy and new attempts coexist; no reconstruction after configuration changes.
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES('wh_diag',$1,'https://current.example.test/new','not-returned','["order.paid"]')`, []any{shop}},
		{`INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES('evt_diag',$1,'order.paid',$2,'{"status":"PAID"}')`, []any{shop, id}},
		{`INSERT INTO webhook_deliveries(id,webhook_id,event_id,status,attempt_count) VALUES('del_diag','wh_diag','evt_diag','FAILED',2)`, nil},
		{`INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt,request_headers,response_headers,response_body,status,duration_ms) VALUES('att_legacy','del_diag',1,'{}','{}','old response','FAILURE',1)`, nil},
		{`INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt,request_headers,response_headers,response_body,status,duration_ms,request_body,request_url,provider_profile,signing_client_id,started_at,http_attempted,failure_code,failure_reason,response_body_truncated) VALUES('att_snapshot','del_diag',2,'{"Authorization":"snapshot-signature"}','{"X-Receiver":"trace"}','','FAILURE',12,$1,'https://historical.example.test/old','TOKOPEDIA_LIKE','client_old',now(),true,'NETWORK_ERROR','connection refused',false)`, []any{"{\"data\": {\"status\":\"PAID\"}}"}},
	} {
		if _, err := app.env.DB.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	result := containerJSON(t, "GET", app.baseURL+"/control/v1/deliveries/del_diag", admin, nil)
	attempts := result["attempts"].([]any)
	legacy, snapshot := attempts[0].(map[string]any), attempts[1].(map[string]any)
	if legacy["request_body"] != nil || legacy["request_url"] != nil || snapshot["request_body"] != "{\"data\": {\"status\":\"PAID\"}}" || snapshot["request_url"] != "https://historical.example.test/old" || snapshot["failure_code"] != "NETWORK_ERROR" || result["event"].(map[string]any)["aggregate_id"] != id {
		t.Fatalf("diagnostic projection=%v", result)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "not-returned") {
		t.Fatal("credential cipher leaked")
	}
	list := containerJSON(t, "GET", app.baseURL+"/control/v1/shops/"+shop+"/deliveries", admin, nil)
	if list["data"].([]any)[0].(map[string]any)["failure_reason"] != "connection refused" {
		t.Fatal("list omitted persisted network failure")
	}
	if _, err := app.env.DB.Exec(ctx, `INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt,request_headers,response_headers,response_body,status,duration_ms) VALUES('att_success','del_diag',3,'{}','{}','accepted','SUCCESS',1)`); err != nil {
		t.Fatal(err)
	}
	list = containerJSON(t, "GET", app.baseURL+"/control/v1/shops/"+shop+"/deliveries", admin, nil)
	if list["data"].([]any)[0].(map[string]any)["failure_reason"] != "" {
		t.Fatal("successful attempt must not show its response or old failure as failure_reason")
	}
	outsider := containerJSON(t, "POST", app.baseURL+"/control/v1/auth/register", "", map[string]any{"email": "outsider-diagnostics@test.local", "password": "safe-test-password"})
	if status, _ := containerRawJSON(t, "GET", app.baseURL+"/control/v1/deliveries/del_diag", outsider["token"].(string), nil); status != http.StatusForbidden {
		t.Fatalf("other owner read diagnostic payload: %d", status)
	}
}
