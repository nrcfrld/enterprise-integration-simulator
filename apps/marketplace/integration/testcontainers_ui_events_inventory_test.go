//go:build testcontainers

package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
)

func TestContainerEventDiscoveryAndProductInventory(t *testing.T) {
	app := startContainerServer(t, 200)
	admin := containerLogin(t, app.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, app.baseURL, admin, "Event and inventory learning")
	base := app.baseURL + "/control/v1/shops/" + shop
	product := containerJSON(t, "POST", base+"/products", admin, map[string]any{"sku": "LEARN-1", "name": "Learning mug", "price": 100, "stock": 10})
	productID := product["id"].(string)
	warehouse := containerJSON(t, "POST", base+"/warehouses", admin, map[string]any{"code": "INACTIVE", "name": "Inactive empty warehouse", "status": "INACTIVE", "priority": 20})
	order := containerJSON(t, "POST", base+"/orders", admin, map[string]any{"items": []any{map[string]any{"product_id": productID, "quantity": 2}}})
	orderID := order["id"].(string)
	assertInventory := func(onHand, reserved, available float64) {
		t.Helper()
		detail := containerJSON(t, "GET", base+"/products/"+productID, admin, nil)
		inventory := detail["warehouse_inventory"].([]any)
		if len(inventory) != 2 || detail["stock"] != available {
			t.Fatalf("inventory projection: %v", detail)
		}
		empty, stocked := inventory[0].(map[string]any), inventory[1].(map[string]any)
		if empty["warehouse_id"] != warehouse["id"] || empty["status"] != "INACTIVE" || empty["available_quantity"] != float64(0) {
			t.Fatalf("empty inactive warehouse hidden: %v", empty)
		}
		if stocked["on_hand_quantity"] != onHand || stocked["reserved_quantity"] != reserved || stocked["available_quantity"] != available {
			t.Fatalf("stock ledger: %v", stocked)
		}
		if len(detail["events"].([]any)) == 0 {
			t.Fatal("product event trail missing")
		}
	}
	assertInventory(10, 2, 8)
	client, secret := containerCreateCredential(t, app.baseURL, shop, admin)
	containerJSON(t, "POST", app.baseURL+"/control/v1/orders/"+orderID+"/actions/pay", admin, map[string]any{})
	for _, action := range []string{"ship-order", "ready-to-ship"} {
		status, _, body := containerShopeeJSON(t, "POST", app.baseURL, "/api/shopee/v1/orders/"+orderID+"/"+action, client, secret, nil)
		if status != 200 {
			t.Fatal(body)
		}
	}
	status, _, body := containerShopeeJSON(t, "POST", app.baseURL, "/api/shopee/v1/orders/"+orderID+"/shipments", client, secret, map[string]any{"shipping_provider": "shopee_express_like", "pickup_type": "PICKUP"})
	if status != 200 {
		t.Fatal(body)
	}
	shipmentID := body["response"].(map[string]any)["shipment"].(map[string]any)["id"].(string)
	for _, action := range []string{"ship", "in_delivery", "delivery_failed", "return_to_sender", "complete_return"} {
		containerJSON(t, "POST", app.baseURL+"/control/v1/shipments/"+shipmentID+"/actions/"+action, admin, map[string]any{"reason": "Recipient unavailable"})
	}
	assertInventory(8, 0, 8)
	feed := containerJSON(t, "GET", base+"/events?resource_type=shipment&limit=1&page=2", admin, nil)
	if feed["pagination"].(map[string]any)["total"] != float64(3) || len(feed["data"].([]any)) != 1 {
		t.Fatalf("filter before pagination: %v", feed)
	}
	filtered := containerJSON(t, "GET", base+"/events?aggregate_id="+shipmentID+"&event_type=shipment.returned", admin, nil)
	returned := filtered["data"].([]any)[0].(map[string]any)
	if returned["aggregate_type"] != "shipment" || returned["payload"] == nil {
		t.Fatal(returned)
	}
	if _, err := app.env.DB.Exec(context.Background(), `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES('wh_events',$1,'https://example.test/receiver','unused','["shipment.returned"]')`, shop); err != nil {
		t.Fatal(err)
	}
	if _, err := app.env.DB.Exec(context.Background(), `INSERT INTO webhook_deliveries(id,webhook_id,event_id,status) VALUES('del_events','wh_events',$1,'PENDING')`, returned["id"]); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{base + "/events?aggregate_id=" + shipmentID, app.baseURL + "/control/v1/shipments/" + shipmentID} {
		data := containerJSON(t, "GET", path, admin, nil)
		key := "events"
		if path == base+"/events?aggregate_id="+shipmentID {
			key = "data"
		}
		found := false
		for _, value := range data[key].([]any) {
			event := value.(map[string]any)
			if event["id"] == returned["id"] {
				found = len(event["deliveries"].([]any)) == 1
			}
		}
		if !found {
			t.Fatalf("delivery correlation missing: %v", data)
		}
	}
	detail := containerJSON(t, "GET", app.baseURL+"/control/v1/orders/"+orderID, admin, nil)
	found := false
	for _, value := range detail["events"].([]any) {
		event := value.(map[string]any)
		if event["id"] == returned["id"] && event["aggregate_id"] == shipmentID {
			found = true
		}
	}
	if !found || len(detail["deliveries"].([]any)) != 1 {
		t.Fatalf("order omits shipment trail: %v", detail)
	}
	// Archived products remain inspectable through the event feed.
	req, _ := http.NewRequest("DELETE", base+"/products/"+productID, nil)
	req.Header.Set("Authorization", "Bearer "+admin)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatalf("archive status %d", response.StatusCode)
	}
	archived := containerJSON(t, "GET", base+"/events?aggregate_id="+productID+"&event_type=product.deleted", admin, nil)
	if len(archived["data"].([]any)) != 1 {
		t.Fatal("archive event missing")
	}
	other := containerCreateShop(t, app.baseURL, admin, "Other shop")
	if data := containerJSON(t, "GET", app.baseURL+"/control/v1/shops/"+other+"/events?aggregate_id="+shipmentID, admin, nil); len(data["data"].([]any)) != 0 {
		t.Fatal("cross-shop events leaked")
	}
	outsider := containerJSON(t, "POST", app.baseURL+"/control/v1/auth/register", "", map[string]any{"email": "event-outsider@test.local", "password": "safe-test-password"})["token"].(string)
	for _, path := range []string{base + "/events", base + "/products/" + productID} {
		if status, _ := containerRawJSON(t, "GET", path, outsider, nil); status != 403 {
			t.Fatalf("unauthorized read %d", status)
		}
	}
	for _, query := range []string{"page=0", "limit=101", "resource_type=unknown"} {
		if status, _ := containerRawJSON(t, "GET", base+"/events?"+query, admin, nil); status != 400 {
			t.Fatalf("invalid filter accepted: %s", query)
		}
	}
}

func TestContainerProviderSubscriptionCatalogParity(t *testing.T) {
	app := startContainerServer(t, 100)
	admin := containerLogin(t, app.baseURL, "admin@test.local", "admin-password")
	for _, profile := range []string{"SHOPEE_LIKE", "TOKOPEDIA_LIKE"} {
		t.Run(profile, func(t *testing.T) {
			shop := containerJSON(t, "POST", app.baseURL+"/control/v1/shops", admin, map[string]any{"name": profile, "provider_profile": profile})["id"].(string)
			credential := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/credentials", admin, map[string]any{})
			client, secret := credential["client_id"].(string), credential["client_secret"].(string)
			topics := []string{"order_status_update", "logistics_status_update", "item_update"}
			if profile == "TOKOPEDIA_LIKE" {
				topics = []string{"ORDER_STATUS_CHANGE", "PACKAGE_UPDATE", "PRODUCT_INFORMATION_CHANGE"}
			}
			for index, topic := range topics {
				input := map[string]any{"callback_url": "https://example.test/" + topic, "event_types": []string{topic}}
				var status int
				if profile == "SHOPEE_LIKE" {
					status, _, _ = containerShopeeJSON(t, "POST", app.baseURL, "/api/shopee/v1/webhooks", client, secret, input)
				} else {
					status, _, _ = containerTokopediaJSON(t, "PUT", app.baseURL, "/api/tokopedia/v202309/webhooks", client, secret, credential["access_token"].(string), input)
				}
				if status != 200 {
					t.Fatalf("register %s: %d", topic, status)
				}
				var raw []byte
				if err := app.env.DB.QueryRow(context.Background(), `SELECT subscribed_events FROM webhooks WHERE shop_id=$1 AND url=$2`, shop, input["callback_url"]).Scan(&raw); err != nil {
					t.Fatal(err)
				}
				var events []string
				if err := json.Unmarshal(raw, &events); err != nil {
					t.Fatal(err)
				}
				for _, event := range []string{"order.created", "order.paid", "order.processing", "order.ready_to_ship", "order.completed", "order.cancelled", "order.payment_failed", "order.payment_expired", "order.sla_expired", "order.shipped", "order.in_delivery", "order.delivered", "shipment.delivery_failed", "shipment.returning", "shipment.returned", "product.created", "product.updated", "product.deleted"} {
					want := webhooks.ShopeeEvent(event) == topic
					if profile == "TOKOPEDIA_LIKE" {
						want = tokopedia.WebhookType(event) == []int{1, 4, 15}[index]
					}
					if slices.Contains(events, event) != want {
						t.Errorf("subscription %s event %s included=%v want=%v", topic, event, slices.Contains(events, event), want)
					}
				}
			}
		})
	}
}
