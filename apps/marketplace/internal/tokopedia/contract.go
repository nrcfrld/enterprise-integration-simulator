// Package tokopedia implements the Tokopedia & Shop-style adapter contract.
// It is based on the current Partner Center model, not retired Tokopedia Open
// API endpoints.
package tokopedia

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"sort"
	"strings"
)

// Sign reproduces the Partner Center style signing string: request path plus
// alphabetically ordered query keys (except sign/access_token), raw body, then
// wrapping the result with the app secret before HMAC-SHA256.
func Sign(secret, path string, query url.Values, body []byte) string {
	keys := make([]string, 0, len(query))
	for key := range query {
		if key != "sign" && key != "access_token" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString(path)
	for _, key := range keys {
		values := append([]string(nil), query[key]...)
		sort.Strings(values)
		for _, value := range values {
			b.WriteString(key)
			b.WriteString(value)
		}
	}
	b.Write(body)
	base := secret + b.String() + secret
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(base))
	return hex.EncodeToString(mac.Sum(nil))
}

// WebhookBody projects canonical events to the numeric Partner Center body.
func WebhookBody(eventID, shopID, event string, payload []byte, timestamp int64) ([]byte, int) {
	var data any
	if err := json.Unmarshal(payload, &data); err != nil {
		data = map[string]any{"raw_payload": string(payload)}
	}
	typeID := WebhookType(event)
	body, _ := json.Marshal(map[string]any{"type": typeID, "tts_notification_id": eventID, "shop_id": shopID, "timestamp": timestamp, "data": data})
	return body, typeID
}

// OrderStatus projects the canonical simulator lifecycle into current
// Tokopedia & Shop terminology without changing Generic/Shopee state storage.
func OrderStatus(status string) string {
	switch status {
	case "UNPAID":
		return "UNPAID"
	case "PAID":
		return "ON_HOLD"
	case "PROCESSING":
		return "AWAITING_SHIPMENT"
	case "READY_TO_SHIP":
		return "AWAITING_COLLECTION"
	case "SHIPPED", "IN_DELIVERY":
		return "IN_TRANSIT"
	case "CANCELLED", "RETURNED":
		return "CANCEL"
	default:
		return status
	}
}

// WebhookType maps canonical events to the numeric topics delivered by the
// Tokopedia & Shop Partner Center contract.
func WebhookType(event string) int {
	switch {
	case strings.HasPrefix(event, "product."):
		return 15 // product information change
	case strings.HasPrefix(event, "shipment.") || event == "order.shipped" || event == "order.in_delivery" || event == "order.delivered":
		return 4 // package update
	default:
		return 1 // order status change
	}
}
