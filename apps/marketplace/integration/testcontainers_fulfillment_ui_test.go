//go:build testcontainers

package integration

import "testing"

func TestContainerExplicitPackagesAndControlRelationships(t *testing.T) {
	app := startContainerServer(t, 1000)
	token := containerLogin(t, app.baseURL, "admin@test.local", "admin-password")
	for _, profile := range []string{"SHOPEE_LIKE", "TOKOPEDIA_LIKE"} {
		t.Run(profile, func(t *testing.T) {
			shop := containerJSON(t, "POST", app.baseURL+"/control/v1/shops", token, map[string]any{"name": profile, "provider_profile": profile})["id"].(string)
			product := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/products", token, map[string]any{"sku": "MUG", "name": "Mug", "price": 100, "stock": 2})
			credential := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/credentials", token, nil)
			order := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/orders", token, map[string]any{"items": []map[string]any{{"product_id": product["id"], "quantity": 2}}})["id"].(string)
			for _, action := range []string{"pay", "process", "ready_to_ship"} {
				containerJSON(t, "POST", app.baseURL+"/control/v1/orders/"+order+"/actions/"+action, token, map[string]any{})
			}
			detail := containerJSON(t, "GET", app.baseURL+"/control/v1/orders/"+order, token, nil)
			warehouse := detail["fulfillment"].(map[string]any)["warehouse_id"]
			item := detail["items"].([]any)[0].(map[string]any)
			if item["remaining_quantity"] != float64(2) {
				t.Fatalf("initial remaining = %#v", item)
			}
			packages := []string{}
			for range 2 {
				pkg := containerJSON(t, "POST", app.baseURL+"/control/v1/shops/"+shop+"/packages", token, map[string]any{"order_id": order, "items": []map[string]any{{"order_item_id": item["id"], "quantity": 1}}})["id"].(string)
				packages = append(packages, pkg)
			}
			ship := func(body map[string]any) (int, map[string]any) {
				if profile == "SHOPEE_LIKE" {
					status, _, result := containerShopeeJSON(t, "POST", app.baseURL, "/api/shopee/v1/orders/"+order+"/shipments", credential["client_id"].(string), credential["client_secret"].(string), body)
					return status, result
				}
				status, _, result := containerTokopediaJSON(t, "POST", app.baseURL, "/api/tokopedia/v202309/orders/"+order+"/shipments", credential["client_id"].(string), credential["client_secret"].(string), credential["access_token"].(string), body)
				return status, result
			}
			if status, result := ship(map[string]any{"shipping_provider": "provider_express", "pickup_type": "PICKUP"}); status != 400 {
				t.Fatalf("automatic packaging should fail after full allocation: %d %#v", status, result)
			}
			for _, pkg := range packages {
				status, result := ship(map[string]any{"shipping_provider": "provider_express", "pickup_type": "PICKUP", "package_id": pkg})
				if status != 200 {
					t.Fatalf("explicit package shipment: %d %#v", status, result)
				}
				packageDetail := containerJSON(t, "GET", app.baseURL+"/control/v1/packages/"+pkg, token, nil)
				if packageDetail["order_id"] != order || packageDetail["warehouse"].(map[string]any)["warehouse_id"] != warehouse {
					t.Fatalf("package links: %#v", packageDetail)
				}
				shipment := packageDetail["shipments"].([]any)[0].(map[string]any)
				shipmentDetail := containerJSON(t, "GET", app.baseURL+"/control/v1/shipments/"+shipment["id"].(string), token, nil)
				if shipmentDetail["package_id"] != pkg || shipmentDetail["order_id"] != order || shipmentDetail["warehouse"].(map[string]any)["warehouse_id"] != warehouse {
					t.Fatalf("shipment links: %#v", shipmentDetail)
				}
			}
			detail = containerJSON(t, "GET", app.baseURL+"/control/v1/orders/"+order, token, nil)
			if len(detail["packages"].([]any)) != 2 || len(detail["shipments"].([]any)) != 2 || detail["items"].([]any)[0].(map[string]any)["remaining_quantity"] != float64(0) {
				t.Fatalf("full allocation graph: %#v", detail)
			}
			for _, collection := range []string{"packages", "shipments"} {
				list := containerJSON(t, "GET", app.baseURL+"/control/v1/shops/"+shop+"/"+collection, token, nil)["data"].([]any)
				if len(list) != 2 || list[0].(map[string]any)["warehouse_id"] != warehouse {
					t.Fatalf("%s list links: %#v", collection, list)
				}
			}
		})
	}
}
