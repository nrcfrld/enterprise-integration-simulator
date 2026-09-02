package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
	dummygenerator "github.com/enrico/enterprise-integration-simulator/packages/dummy-generator"
)

func TestAllowedTransition(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, from, to string
		want           bool
	}{
		{"unpaid to paid", "UNPAID", "PAID", true},
		{"unpaid cannot process", "UNPAID", "PROCESSING", false},
		{"paid cannot ship", "PAID", "SHIPPED", false},
		{"processing to ready", "PROCESSING", "READY_TO_SHIP", true},
		{"ready to ship can cancel", "READY_TO_SHIP", "CANCELLED", true},
		{"shipped cannot cancel", "SHIPPED", "CANCELLED", false},
		{"in delivery to delivered", "IN_DELIVERY", "DELIVERED", true},
		{"delivered to completed", "DELIVERED", "COMPLETED", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := orders.CanTransition(test.from, test.to); got != test.want {
				t.Fatalf("CanTransition(%s, %s)=%v, want %v", test.from, test.to, got, test.want)
			}
		})
	}
}

func TestSwaggerUIIsServedFromTheCommittedOpenAPISpec(t *testing.T) {
	t.Parallel()
	router := New(nil, nil, platform.Config{}, slog.New(slog.NewTextHandler(io.Discard, nil))).Router()
	request := httptest.NewRequest(http.MethodGet, "/swagger/index.html", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("Swagger UI status = %d, want %d", response.Code, http.StatusOK)
	}
	if !strings.Contains(response.Body.String(), "Swagger UI") {
		t.Fatal("Swagger UI response did not contain the interactive UI")
	}
}

func TestCursorRoundTripAndSortBinding(t *testing.T) {
	t.Parallel()
	raw, err := encodeCursor(pageCursor{Sort: "price", Direction: "DESC", Value: "25000", ID: "prd_123"})
	if err != nil {
		t.Fatalf("encode cursor: %v", err)
	}
	cursor, err := decodeCursor(raw, "price", "DESC")
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if cursor.ID != "prd_123" || cursor.Value != "25000" {
		t.Fatalf("unexpected cursor: %#v", cursor)
	}
	if _, err := decodeCursor(raw, "name", "DESC"); err == nil {
		t.Fatal("expected a cursor sort mismatch to fail")
	}
}

func TestApplyCursorUsesStableTuple(t *testing.T) {
	t.Parallel()
	raw, err := encodeCursor(pageCursor{Sort: "price", Direction: "ASC", Value: "25000", ID: "prd_123"})
	if err != nil {
		t.Fatal(err)
	}
	args := []any{"shop_123"}
	where := "shop_id=$1"
	if err := applyCursor(&args, &where, raw, "price", "ASC", productCursorValue); err != nil {
		t.Fatalf("apply cursor: %v", err)
	}
	if !strings.Contains(where, "(price, id) > ($2, $3)") {
		t.Fatalf("unexpected tuple predicate: %s", where)
	}
	if got, want := args[1], int64(25000); got != want {
		t.Fatalf("cursor price = %v, want %v", got, want)
	}
}

func TestSupportedWebhookEvent(t *testing.T) {
	t.Parallel()
	tests := []struct {
		event string
		want  bool
	}{
		{event: "order.created", want: true},
		{event: "order.shipped", want: true},
		{event: "product.updated", want: true},
		{event: "payment.captured", want: false},
		{event: "", want: false},
	}
	for _, test := range tests {
		t.Run(test.event, func(t *testing.T) {
			t.Parallel()
			if got := webhooks.SupportsEvent(test.event); got != test.want {
				t.Fatalf("SupportsEvent(%q) = %v, want %v", test.event, got, test.want)
			}
		})
	}
}

func TestNextSeededProductProducesUsableCatalogRecord(t *testing.T) {
	t.Parallel()

	product := products.SeedCatalogProduct(dummygenerator.New(products.CatalogSeed), 7)
	if product.SKU != "SIM-007" {
		t.Fatalf("SKU = %q, want SIM-007", product.SKU)
	}
	if product.Name == "" || product.Description == "" {
		t.Fatalf("seed product must have name and description: %#v", product)
	}
	if product.Price <= 0 || product.Stock <= 0 {
		t.Fatalf("seed product must have positive price and stock: %#v", product)
	}
}
