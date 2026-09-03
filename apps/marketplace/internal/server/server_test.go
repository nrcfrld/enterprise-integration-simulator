package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/idempotency"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
	dummygenerator "github.com/enrico/enterprise-integration-simulator/packages/dummy-generator"
	"github.com/gin-gonic/gin"
)

type fakeIdempotencyBackend struct {
	completeErr    error
	completed      bool
	completedBody  string
	completedState int
	released       bool
}

func (f *fakeIdempotencyBackend) Acquire(context.Context, idempotency.Claim) (idempotency.Result, error) {
	return idempotency.Result{Outcome: idempotency.OutcomeExecute}, nil
}

func (f *fakeIdempotencyBackend) Complete(_ context.Context, _ idempotency.Claim, status int, body []byte) error {
	f.completed = true
	f.completedState = status
	f.completedBody = string(body)
	return f.completeErr
}

func (f *fakeIdempotencyBackend) Release(context.Context, idempotency.Claim) error {
	f.released = true
	return nil
}

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

func TestCORSAllowsEveryPublicContractHeader(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name            string
		origin          string
		requestHeaders  string
		wantAllowOrigin bool
	}{
		{
			name:            "Shopee-like simulator preflight",
			origin:          "http://localhost:5173",
			requestHeaders:  "content-type,x-shopee-partner-id,x-shopee-timestamp,x-shopee-signature",
			wantAllowOrigin: true,
		},
		{
			name:            "Tokopedia-like simulator preflight",
			origin:          "http://127.0.0.1:5173",
			requestHeaders:  "content-type,x-tts-access-token",
			wantAllowOrigin: true,
		},
		{
			name:            "untrusted browser origin",
			origin:          "https://untrusted.example",
			requestHeaders:  "x-shopee-partner-id",
			wantAllowOrigin: false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			router := New(nil, nil, platform.Config{}, slog.New(slog.NewTextHandler(io.Discard, nil))).Router()
			request := httptest.NewRequest(http.MethodOptions, "/api/shopee/v1/products", nil)
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Access-Control-Request-Method", http.MethodGet)
			request.Header.Set("Access-Control-Request-Headers", test.requestHeaders)
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusNoContent {
				t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusNoContent)
			}
			if got := response.Header().Get("Access-Control-Allow-Origin"); (got != "") != test.wantAllowOrigin {
				t.Fatalf("allow origin = %q, want present %v", got, test.wantAllowOrigin)
			}
			for _, header := range strings.Split(test.requestHeaders, ",") {
				if !headerListContains(response.Header().Get("Access-Control-Allow-Headers"), header) {
					t.Fatalf("allowed headers %q do not include %q", response.Header().Get("Access-Control-Allow-Headers"), header)
				}
			}
			for _, header := range []string{"X-RateLimit-Limit", "X-Shopee-Api-Call-Limit", "X-TTS-RateLimit-Limit"} {
				if !headerListContains(response.Header().Get("Access-Control-Expose-Headers"), header) {
					t.Fatalf("exposed headers %q do not include %q", response.Header().Get("Access-Control-Expose-Headers"), header)
				}
			}
		})
	}
}

func TestReadRequestBodyEnforcesConfiguredLimit(t *testing.T) {
	t.Parallel()
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader("12345"))

	if _, err := readRequestBody(context, 4); !isRequestTooLarge(err) {
		t.Fatalf("readRequestBody error = %v, want MaxBytesError", err)
	}
}

func TestRequestFingerprintIgnoresVolatileTokopediaSigningParameters(t *testing.T) {
	t.Parallel()
	first := httptest.NewRequest(http.MethodPost, "/api/tokopedia/v202309/orders/ord_1/pack?app_key=a&timestamp=1&sign=first&stable=yes", nil)
	second := httptest.NewRequest(http.MethodPost, "/api/tokopedia/v202309/orders/ord_1/pack?sign=second&timestamp=2&app_key=a&stable=yes", nil)
	if got, want := requestFingerprint(first, []byte(`{}`)), requestFingerprint(second, []byte(`{}`)); got != want {
		t.Fatalf("equivalent signed request fingerprints differ: %q != %q", got, want)
	}
	changed := httptest.NewRequest(http.MethodPost, "/api/tokopedia/v202309/orders/ord_1/pack?stable=no", nil)
	if requestFingerprint(first, []byte(`{}`)) == requestFingerprint(changed, []byte(`{}`)) {
		t.Fatal("logical query change did not change request fingerprint")
	}
}

func TestIdempotentResponseIsPublishedOnlyAfterClaimCompletion(t *testing.T) {
	tests := []struct {
		name             string
		completeErr      error
		wantStatus       int
		wantBody         string
		unwantedBody     string
		wantStoredStatus int
	}{
		{
			name:             "completed claim publishes the stable success response",
			wantStatus:       http.StatusCreated,
			wantBody:         `"result":"created"`,
			wantStoredStatus: http.StatusCreated,
		},
		{
			name:             "failed claim finalization hides the unrepeatable success response",
			completeErr:      errors.New("database unavailable"),
			wantStatus:       http.StatusInternalServerError,
			wantBody:         "IDEMPOTENCY_FINALIZATION_FAILED",
			unwantedBody:     `"result":"created"`,
			wantStoredStatus: http.StatusCreated,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			backend := &fakeIdempotencyBackend{completeErr: test.completeErr}
			server := &Server{
				idem:   backend,
				logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.POST("/mutation",
				func(c *gin.Context) {
					c.Set("client", integrationClient{CredentialID: "cred_1"})
					setRequestBody(c, []byte(`{"name":"example"}`))
				},
				server.idempotent("test.create"),
				func(c *gin.Context) {
					c.JSON(http.StatusCreated, gin.H{"result": "created"})
				},
			)

			request := httptest.NewRequest(http.MethodPost, "/mutation", strings.NewReader(`{"name":"example"}`))
			request.Header.Set("Idempotency-Key", "retry-key")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("response status = %d, want %d; body=%s", response.Code, test.wantStatus, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), test.wantBody) {
				t.Fatalf("response body = %q, want substring %q", response.Body.String(), test.wantBody)
			}
			if test.unwantedBody != "" && strings.Contains(response.Body.String(), test.unwantedBody) {
				t.Fatalf("response body leaked buffered success: %q", response.Body.String())
			}
			if !backend.completed || backend.completedState != test.wantStoredStatus || backend.completedBody != `{"result":"created"}` {
				t.Fatalf("completion call = completed:%v status:%d body:%q", backend.completed, backend.completedState, backend.completedBody)
			}
			if backend.released {
				t.Fatal("successful handler response must not release its idempotency claim")
			}
		})
	}
}

func headerListContains(values, want string) bool {
	for _, value := range strings.Split(values, ",") {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(want)) {
			return true
		}
	}
	return false
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
