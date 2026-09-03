package tokopedia

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func TestSign(t *testing.T) {
	t.Parallel()
	query := url.Values{"timestamp": {"1700000000"}, "app_key": {"app_1"}, "sign": {"ignored"}, "access_token": {"ignored"}, "tag": {"z", "a"}}
	got := Sign("secret", "/api/tokopedia/v202309/products/search", query, []byte(`{"page_size":20}`))
	const want = "1e5ba36dae326205878e2d535c1965f3a0ad2b569655f24dd6080f91413b9757"
	if got != want {
		t.Fatalf("Sign() = %q, want %q", got, want)
	}
}

func TestContractMappings(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, input, want string
	}{
		{name: "paid order", input: "PAID", want: "ON_HOLD"},
		{name: "shipment in transit", input: "SHIPPED", want: "IN_TRANSIT"},
		{name: "unknown status remains stable", input: "CUSTOM", want: "CUSTOM"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := OrderStatus(test.input); got != test.want {
				t.Fatalf("OrderStatus(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
	if WebhookType("product.updated") != 15 || WebhookType("shipment.returned") != 4 || WebhookType("order.paid") != 1 {
		t.Fatal("WebhookType() did not map provider event families")
	}
}

func TestCanonicalOrderStatuses(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, external string
		want           []string
		valid          bool
	}{
		{name: "single state", external: "AWAITING_COLLECTION", want: []string{"READY_TO_SHIP"}, valid: true},
		{name: "transit state", external: "IN_TRANSIT", want: []string{"SHIPPED", "IN_DELIVERY"}, valid: true},
		{name: "cancel state", external: "cancel", want: []string{"CANCELLED", "RETURNED"}, valid: true},
		{name: "unknown state", external: "MISSING", valid: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, valid := CanonicalOrderStatuses(test.external)
			if valid != test.valid || strings.Join(got, ",") != strings.Join(test.want, ",") {
				t.Fatalf("CanonicalOrderStatuses(%q) = %#v/%t, want %#v/%t", test.external, got, valid, test.want, test.valid)
			}
		})
	}
}

func TestWebhookBody(t *testing.T) {
	t.Parallel()
	body, typeID := WebhookBody("evt_1", "shop_1", "product.updated", []byte(`{"sku":"MUG-1"}`), 1700000000)
	if typeID != 15 {
		t.Fatalf("type = %d, want 15", typeID)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if decoded["tts_notification_id"] != "evt_1" || decoded["shop_id"] != "shop_1" {
		t.Fatalf("WebhookBody() = %#v", decoded)
	}
	invalid, _ := WebhookBody("evt_2", "shop_1", "order.paid", []byte("not-json"), 1700000000)
	if !json.Valid(invalid) {
		t.Fatalf("invalid payload projection is not JSON: %s", invalid)
	}
}
