//go:build testcontainers

package integration

import (
	"context"
	"testing"
)

func TestContainerUIRecoverySearchAndInventoryConflict(t *testing.T) {
	app := startContainerServer(t, 1000)
	token := containerLogin(t, app.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, app.baseURL, token, "Recovery exercise")
	base := app.baseURL + "/control/v1/shops/" + shop
	product := containerJSON(t, "POST", base+"/products", token, map[string]any{"sku": "SEARCH-MUG", "name": "Mug", "price": 100, "stock": 10})
	productID := product["id"].(string)
	order := containerJSON(t, "POST", base+"/orders", token, map[string]any{"items": []map[string]any{{"product_id": productID, "quantity": 2}}})
	orderID := order["id"].(string)
	for _, action := range []string{"pay", "process", "ready_to_ship"} {
		containerJSON(t, "POST", app.baseURL+"/control/v1/orders/"+orderID+"/actions/"+action, token, map[string]any{})
	}
	detail := containerJSON(t, "GET", app.baseURL+"/control/v1/orders/"+orderID, token, nil)
	warehouseID := detail["fulfillment"].(map[string]any)["warehouse_id"].(string)
	warehouseURL := app.baseURL + "/control/v1/warehouses/" + warehouseID
	readInventory := func() map[string]any {
		return containerJSON(t, "GET", warehouseURL, token, nil)["inventory"].([]any)[0].(map[string]any)
	}
	before := readInventory()
	client, secret := containerCreateCredential(t, app.baseURL, shop, token)
	status, _, body := containerShopeeJSON(t, "POST", app.baseURL, "/api/shopee/v1/orders/"+orderID+"/shipments", client, secret, map[string]any{"shipping_provider": "provider_express", "pickup_type": "PICKUP"})
	if status != 200 {
		t.Fatal(body)
	}
	shipment := body["response"].(map[string]any)["shipment"].(map[string]any)
	containerJSON(t, "POST", app.baseURL+"/control/v1/shipments/"+shipment["id"].(string)+"/actions/ship", token, map[string]any{})
	inventoryURL := warehouseURL + "/inventory/" + productID
	status, conflict := containerRawJSON(t, "PUT", inventoryURL, token, map[string]any{"on_hand_quantity": 15, "expected_updated_at": before["updated_at"]})
	if status != 409 || conflict["error"].(map[string]any)["code"] != "INVENTORY_CONFLICT" {
		t.Fatalf("stale replacement: %d %#v", status, conflict)
	}
	after := readInventory()
	if after["on_hand_quantity"] != float64(8) {
		t.Fatalf("shipment consumption overwritten: %#v", after)
	}
	containerJSON(t, "PUT", inventoryURL, token, map[string]any{"on_hand_quantity": 13, "expected_updated_at": after["updated_at"]})
	if status, _ := containerRawJSON(t, "PUT", inventoryURL, token, map[string]any{"on_hand_quantity": 15, "expected_updated_at": after["updated_at"]}); status != 409 {
		t.Fatalf("second stale writer = %d", status)
	}
	if status, _ := containerRawJSON(t, "PUT", inventoryURL, token, map[string]any{"on_hand_quantity": 15, "expected_updated_at": ""}); status != 409 {
		t.Fatalf("unexpected replacement of existing inventory = %d", status)
	}
	for _, path := range []string{"/orders?q=" + orderID, "/orders?q=" + detail["order_number"].(string), "/products?q=search-mug", "/shipments?q=" + shipment["tracking_number"].(string) + "&status=SHIPPED"} {
		list := containerJSON(t, "GET", base+path, token, nil)
		if list["pagination"].(map[string]any)["total"] != float64(1) {
			t.Fatalf("search %s: %#v", path, list)
		}
	}
	// Delivery lookup filters the complete authorized collection as well.
	hook := map[string]any{"id": "webhook_search"}
	if _, err := app.env.DB.Exec(context.Background(), `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES('webhook_search',$1,'https://receiver.example/search','unused','["order.created"]')`, shop); err != nil {
		t.Fatal(err)
	}
	eventID := detail["events"].([]any)[0].(map[string]any)["id"]
	if _, err := app.env.DB.Exec(context.Background(), `INSERT INTO webhook_deliveries(id,webhook_id,event_id,status) VALUES('delivery_search',$1,$2,'FAILED')`, hook["id"], eventID); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{hook["id"].(string), eventID.(string), "receiver.example"} {
		list := containerJSON(t, "GET", base+"/deliveries?q="+query+"&status=FAILED", token, nil)
		if list["pagination"].(map[string]any)["total"] != float64(1) || list["data"].([]any)[0].(map[string]any)["webhook_id"] != hook["id"] {
			t.Fatalf("delivery search: %#v", list)
		}
	}
	other := containerCreateShop(t, app.baseURL, token, "Other recovery shop")
	if list := containerJSON(t, "GET", app.baseURL+"/control/v1/shops/"+other+"/orders?q="+orderID, token, nil); len(list["data"].([]any)) != 0 {
		t.Fatal("cross-shop search leaked")
	}
	containerJSON(t, "PUT", base+"/scenario", token, map[string]any{"force_rate_limit": true})
	containerJSON(t, "PUT", base+"/scenario", token, map[string]any{})
	if scenario := containerJSON(t, "GET", base+"/scenario", token, nil); scenario["force_rate_limit"] != false {
		t.Fatal(scenario)
	}
	if status, _ := containerRawJSON(t, "PUT", base+"/scenario", token, map[string]any{"api_timeout_probability": 101}); status != 400 {
		t.Fatalf("invalid probability = %d", status)
	}
	operator := containerJSON(t, "POST", app.baseURL+"/control/v1/auth/register", "", map[string]any{"email": "recovery-operator@test.local", "password": "safe-test-password"})["token"].(string)
	containerJSON(t, "GET", app.baseURL+"/control/v1/maintenance", operator, nil)
	if status, _ := containerRawJSON(t, "PUT", app.baseURL+"/control/v1/maintenance", operator, map[string]any{"enabled": true}); status != 403 {
		t.Fatalf("operator changed global maintenance: %d", status)
	}
	if status, _ := containerRawJSON(t, "PUT", inventoryURL, operator, map[string]any{"on_hand_quantity": 99, "expected_updated_at": after["updated_at"]}); status != 403 {
		t.Fatalf("outsider inventory write: %d", status)
	}
}
