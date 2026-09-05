//go:build testcontainers

package integration

import (
	"context"
	"fmt"
	"net/http"
	"testing"
)

func TestContainerWebhookDeletionRetainsHistory(t *testing.T) {
	app := startContainerServer(t, 1000)
	ctx := context.Background()
	token := containerLogin(t, app.baseURL, "admin@test.local", "admin-password")
	for _, via := range []string{"control", "shared"} {
		t.Run(via, func(t *testing.T) {
			shop := containerCreateShop(t, app.baseURL, token, "Retention "+via)
			clientID, secret := containerCreateCredential(t, app.baseURL, shop, token)
			path := "/control/v1/shops/" + shop + "/webhooks"
			hook := containerJSON(t, "POST", app.baseURL+path, token, map[string]any{"url": "https://receiver.example/webhooks", "subscribed_events": []string{"order.paid"}})["id"].(string)
			event := "evt_retention_" + via
			if _, err := app.env.DB.Exec(ctx, `INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES($1,$2,'order.paid','ord_example','{"order_id":"ord_example","status":"PAID"}')`, event, shop); err != nil {
				t.Fatal(err)
			}
			for _, status := range []string{"PENDING", "DELIVERED", "FAILED"} {
				id := "del_" + via + status
				if _, err := app.env.DB.Exec(ctx, `INSERT INTO webhook_deliveries(id,webhook_id,event_id,status,attempt_count,next_attempt_at,leased_until) VALUES($1,$2,$3,$4,1,now(),now()+interval '30 seconds')`, id, hook, event, status); err != nil {
					t.Fatal(err)
				}
				if _, err := app.env.DB.Exec(ctx, `INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt,request_headers,response_status,response_headers,response_body,duration_ms,status) VALUES($1,$2,1,'{}',500,'{}','retained diagnosis',1,'FAILURE')`, "att_"+id, id); err != nil {
					t.Fatal(err)
				}
			}
			// A webhook ID cannot be retired through a different shop's URL.
			otherShop := containerCreateShop(t, app.baseURL, token, "Other shop")
			status, _ := containerRawJSON(t, "DELETE", app.baseURL+"/control/v1/shops/"+otherShop+"/webhooks/"+hook, token, nil)
			if status != 404 {
				t.Fatalf("wrong-shop delete = %d", status)
			}
			if via == "control" {
				status, _ = containerRawJSON(t, "DELETE", app.baseURL+path+"/"+hook, token, nil)
			} else {
				status, _, _ = containerSignedJSON(t, "DELETE", app.baseURL, "/api/v1/webhooks/"+hook, clientID, secret, "delete-"+hook, nil)
			}
			if status != http.StatusNoContent {
				t.Fatalf("delete = %d", status)
			}
			listed := containerJSON(t, "GET", app.baseURL+path, token, nil)
			if len(listed["data"].([]any)) != 0 {
				t.Fatalf("deleted registration listed: %#v", listed)
			}
			status, _, public := containerSignedJSON(t, "GET", app.baseURL, "/api/v1/webhooks", clientID, secret, "", nil)
			if status != 200 || len(public["data"].([]any)) != 0 {
				t.Fatalf("shared list = %d %#v", status, public)
			}
			status, _, shopee := containerShopeeJSON(t, "GET", app.baseURL, "/api/shopee/v1/webhooks", clientID, secret, nil)
			if status != 200 || len(shopee["response"].(map[string]any)["webhook_list"].([]any)) != 0 {
				t.Fatalf("Shopee list = %d %#v", status, shopee)
			}
			deliveries := containerJSON(t, "GET", app.baseURL+"/control/v1/shops/"+shop+"/deliveries", token, nil)
			if len(deliveries["data"].([]any)) != 3 {
				t.Fatalf("lost delivery history: %#v", deliveries)
			}
			for _, original := range []string{"PENDING", "DELIVERED", "FAILED"} {
				id := "del_" + via + original
				detail := containerJSON(t, "GET", app.baseURL+"/control/v1/deliveries/"+id, token, nil)
				want := original
				if original == "PENDING" {
					want = "CANCELLED"
				}
				attempts := detail["attempts"].([]any)
				if detail["status"] != want || detail["webhook_deleted"] != true || len(attempts) != 1 || attempts[0].(map[string]any)["response_body"] != "retained diagnosis" {
					t.Fatalf("history = %#v", detail)
				}
				code, result := containerRawJSON(t, "POST", app.baseURL+"/control/v1/deliveries/"+id+"/retry", token, nil)
				if code != 409 || result["error"].(map[string]any)["code"] != "WEBHOOK_DELETED" {
					t.Fatalf("retry = %d %#v", code, result)
				}
			}
			status, _ = containerRawJSON(t, "PATCH", app.baseURL+path+"/"+hook, token, map[string]any{"url": "https://receiver.example/new", "subscribed_events": []string{"order.paid"}, "enabled": true})
			if status != 404 {
				t.Fatalf("edit resurrected registration: %d", status)
			}
			// Manual duplicate and delayed fanout must also exclude the deleted hook.
			for _, action := range []string{"duplicate", "delay"} {
				status, result := containerRawJSON(t, "POST", app.baseURL+"/control/v1/events/"+event+"/"+action, token, map[string]any{"delay_seconds": 1})
				if status != 202 || result["deliveries_created"] != float64(0) {
					t.Fatalf("deleted hook debug fanout: %d %#v", status, result)
				}
			}
			var count int
			if err := app.env.DB.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries WHERE webhook_id=$1`, hook).Scan(&count); err != nil || count != 3 {
				t.Fatalf("new deliveries after deletion: %d %v", count, err)
			}
			var cancelled bool
			if err := app.env.DB.QueryRow(ctx, `SELECT status='CANCELLED' AND next_attempt_at IS NULL AND leased_until IS NULL FROM webhook_deliveries WHERE id=$1`, "del_"+via+"PENDING").Scan(&cancelled); err != nil || !cancelled {
				t.Fatalf("pending lease not cancelled: %v", err)
			}
		})
	}
}

func TestContainerWebhookSigningCredentialMetadata(t *testing.T) {
	app := startContainerServer(t, 1000)
	token := containerLogin(t, app.baseURL, "admin@test.local", "admin-password")
	shop := containerJSON(t, "POST", app.baseURL+"/control/v1/shops", token, map[string]any{"name": "Tokopedia signing", "provider_profile": "TOKOPEDIA_LIKE"})["id"].(string)
	path := app.baseURL + "/control/v1/shops/" + shop + "/webhooks"
	check := func(want string) {
		t.Helper()
		result := containerJSON(t, "GET", path, token, nil)["delivery_contract"].(map[string]any)
		if result["provider_profile"] != "TOKOPEDIA_LIKE" || result["signing_client_id"] != want {
			t.Fatalf("signing metadata: %#v, want %s", result, want)
		}
	}
	check("")
	first := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/credentials", token, nil)
	second := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/credentials", token, nil)
	check(first["client_id"].(string))
	containerJSON(t, "POST", fmt.Sprintf("%s/control/v1/credentials/%s/revoke", app.baseURL, first["id"]), token, nil)
	check(second["client_id"].(string))
	containerJSON(t, "POST", fmt.Sprintf("%s/control/v1/credentials/%s/revoke", app.baseURL, second["id"]), token, nil)
	check("")
}
