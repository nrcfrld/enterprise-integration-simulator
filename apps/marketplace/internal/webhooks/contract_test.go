package webhooks

import (
	"encoding/json"
	"testing"
	"time"
)

func TestWebhookEventMappings(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, event, wantShopee, wantCanonical string
		known                                  bool
	}{
		{name: "product event", event: "product.updated", wantShopee: "item_update", wantCanonical: "product.updated", known: true},
		{name: "shipment event", event: "order.shipped", wantShopee: "logistics_status_update", wantCanonical: "order.shipped", known: true},
		{name: "order event", event: "order.paid", wantShopee: "order_status_update", wantCanonical: "order.created", known: true},
		{name: "unknown event", event: "unknown.event", wantShopee: "order_status_update", known: false},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := ShopeeEvent(test.event); got != test.wantShopee {
				t.Fatalf("ShopeeEvent(%q) = %q, want %q", test.event, got, test.wantShopee)
			}
			canonical, ok := CanonicalShopeeEvent(test.wantShopee)
			if test.known && (!ok || canonical != test.wantCanonical) {
				t.Fatalf("CanonicalShopeeEvent(%q) = (%q, %v)", test.wantShopee, canonical, ok)
			}
		})
	}
	if SupportsEvent("order.paid") != true || SupportsEvent("order.reversed") != false {
		t.Fatal("SupportsEvent() did not enforce the public event allow-list")
	}
}

func TestDeliveryContract(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"order_id":"ord_1"}`)
	event, body := DeliveryContract("TOKOPEDIA_LIKE", "evt_1", "order.paid", payload)
	if event != "order.paid" || string(body) != string(payload) {
		t.Fatalf("non-Shopee delivery = (%q, %s)", event, body)
	}
	event, body = DeliveryContract("SHOPEE_LIKE", "evt_1", "order.shipped", payload)
	if event != "logistics_status_update" {
		t.Fatalf("Shopee event = %q", event)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal Shopee body: %v", err)
	}
	if decoded["request_id"] != "evt_1" {
		t.Fatalf("Shopee body = %#v", decoded)
	}
}

func TestRetryAfter(t *testing.T) {
	t.Parallel()
	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{attempt: -1, want: 30 * time.Second},
		{attempt: 1, want: 30 * time.Second},
		{attempt: 2, want: 2 * time.Minute},
		{attempt: 3, want: 10 * time.Minute},
		{attempt: 4, want: 30 * time.Minute},
		{attempt: 99, want: 30 * time.Minute},
	}
	for _, test := range tests {
		test := test
		t.Run(time.Duration(test.attempt).String(), func(t *testing.T) {
			t.Parallel()
			if got := RetryAfter(test.attempt); got != test.want {
				t.Fatalf("RetryAfter(%d) = %s, want %s", test.attempt, got, test.want)
			}
		})
	}
}
