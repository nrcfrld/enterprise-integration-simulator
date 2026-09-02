package webhooks

import (
	"encoding/json"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
)

// ShopeeEvent maps a canonical domain event into the intentionally distinct
// SHOPEE_LIKE webhook vocabulary. The simulator owns this contract; it is not
// a claim of compatibility with Shopee's production API.
func ShopeeEvent(event string) string {
	switch event {
	case "product.created", "product.updated", "product.deleted":
		return "item_update"
	case "order.shipped", "order.in_delivery", "order.delivered":
		return "logistics_status_update"
	default:
		return "order_status_update"
	}
}

// CanonicalShopeeEvent converts a SHOPEE_LIKE subscription name back to the
// durable internal event name used by the outbox.
func CanonicalShopeeEvent(event string) (string, bool) {
	switch event {
	case "item_update":
		return "product.updated", true
	case "order_status_update":
		return "order.created", true
	case "logistics_status_update":
		return "order.shipped", true
	default:
		return "", false
	}
}

// DeliveryContract returns the body and event header for a provider profile.
// Generic shops retain the original durable-event representation unchanged.
func DeliveryContract(provider, eventID, event string, payload []byte) (string, []byte) {
	if orders.NormaliseProvider(provider) != orders.ShopeeLike {
		return event, payload
	}
	var domain any
	if err := json.Unmarshal(payload, &domain); err != nil {
		domain = map[string]any{"raw_payload": string(payload)}
	}
	body, _ := json.Marshal(map[string]any{
		"code":       0,
		"message":    "success",
		"request_id": eventID,
		"response": map[string]any{
			"event_type": ShopeeEvent(event),
			"data":       domain,
		},
	})
	return ShopeeEvent(event), body
}
