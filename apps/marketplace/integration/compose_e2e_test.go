//go:build integration

package integration

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOrderCreatedWebhookIsSignedAndDelivered(t *testing.T) {
	baseURL := os.Getenv("MARKETPLACE_E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:18080"
	}
	token := login(t, baseURL)
	shopID := createShop(t, baseURL, token)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/reset", token, map[string]any{})

	received := make(chan webhookRequest, 1)
	consumer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		received <- webhookRequest{body: body, header: request.Header.Clone()}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer consumer.Close()
	secret := "e2e-webhook-secret"
	endpoint := strings.Replace(consumer.URL, "127.0.0.1", "host.docker.internal", 1)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/webhooks", token, map[string]any{"url": endpoint, "secret": secret, "subscribed_events": []string{"order.created"}})
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/orders", token, map[string]any{})

	select {
	case request := <-received:
		if got := request.header.Get("X-Marketplace-Event"); got != "order.created" {
			t.Fatalf("event type = %q, want order.created", got)
		}
		if request.header.Get("X-Marketplace-Event-Id") == "" {
			t.Fatal("event ID is missing")
		}
		timestamp := request.header.Get("X-Marketplace-Timestamp")
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(timestamp + "." + string(request.body)))
		if got, want := request.header.Get("X-Marketplace-Signature"), hex.EncodeToString(mac.Sum(nil)); !hmac.Equal([]byte(got), []byte(want)) {
			t.Fatalf("signature = %s, want %s", got, want)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("timed out waiting for asynchronous webhook")
	}
}

func TestFailedWebhookRetriesAfterInitialBackoff(t *testing.T) {
	baseURL := os.Getenv("MARKETPLACE_E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:18080"
	}
	token := login(t, baseURL)
	shopID := createShop(t, baseURL, token)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/reset", token, map[string]any{})
	var calls atomic.Int32
	firstAttempt := make(chan time.Time, 1)
	success := make(chan time.Time, 1)
	consumer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempt := calls.Add(1)
		if attempt == 1 {
			firstAttempt <- time.Now()
			http.Error(writer, "retry me", http.StatusInternalServerError)
			return
		}
		success <- time.Now()
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer consumer.Close()
	endpoint := strings.Replace(consumer.URL, "127.0.0.1", "host.docker.internal", 1)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/webhooks", token, map[string]any{"url": endpoint, "secret": "retry-secret", "subscribed_events": []string{"order.created"}})
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/orders", token, map[string]any{})
	var first time.Time
	select {
	case first = <-firstAttempt:
	case <-time.After(12 * time.Second):
		t.Fatal("first webhook attempt was not made")
	}
	select {
	case second := <-success:
		if elapsed := second.Sub(first); elapsed < 28*time.Second || elapsed > 38*time.Second {
			t.Fatalf("retry elapsed %s, want approximately 30 seconds", elapsed)
		}
	case <-time.After(42 * time.Second):
		t.Fatal("webhook retry was not delivered")
	}
}

func TestWebhookReplayKeepsStableEventID(t *testing.T) {
	baseURL := os.Getenv("MARKETPLACE_E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:18080"
	}
	token := login(t, baseURL)
	shopID := createShop(t, baseURL, token)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/reset", token, map[string]any{})
	received := make(chan webhookRequest, 2)
	consumer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		received <- webhookRequest{body: body, header: request.Header.Clone()}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer consumer.Close()
	endpoint := strings.Replace(consumer.URL, "127.0.0.1", "host.docker.internal", 1)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/webhooks", token, map[string]any{"url": endpoint, "secret": "replay-secret", "subscribed_events": []string{"order.created"}})
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/orders", token, map[string]any{})
	var first webhookRequest
	select {
	case first = <-received:
	case <-time.After(12 * time.Second):
		t.Fatal("initial webhook was not delivered")
	}
	eventID := first.header.Get("X-Marketplace-Event-Id")
	if eventID == "" {
		t.Fatal("initial delivery was missing event ID")
	}
	postJSON(t, baseURL+"/control/v1/events/"+eventID+"/replay", token, map[string]any{})
	select {
	case replay := <-received:
		if got := replay.header.Get("X-Marketplace-Event-Id"); got != eventID {
			t.Fatalf("replayed event ID = %q, want stable ID %q", got, eventID)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("replayed webhook was not delivered")
	}
}

func TestSignedPublicProductRequestIsIdempotentAndPaginates(t *testing.T) {
	baseURL := os.Getenv("MARKETPLACE_E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:18080"
	}
	token := login(t, baseURL)
	shopID := createShop(t, baseURL, token)
	seed := postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/reset", token, map[string]any{})
	credential, ok := seed["credential"].(map[string]any)
	if !ok || credential["client_secret"] != nil {
		t.Fatalf("seed must not reveal a credential secret: %#v", seed)
	}
	clientID, clientSecret := createCredential(t, baseURL, shopID, token)
	body := map[string]any{"sku": "E2E-PUBLIC-SKU", "name": "Public API Product", "description": "created with HMAC", "price": 77777, "stock": 7, "status": "ACTIVE"}
	first, firstHeader := publicJSON(t, http.MethodPost, baseURL, "/api/v1/products", clientID, clientSecret, "e2e-product-create", body)
	productID, _ := first["id"].(string)
	if productID == "" {
		t.Fatal("public create did not return a product ID")
	}
	second, secondHeader := publicJSON(t, http.MethodPost, baseURL, "/api/v1/products", clientID, clientSecret, "e2e-product-create", body)
	if got := secondHeader.Get("Idempotent-Replayed"); got != "true" {
		t.Fatalf("Idempotent-Replayed = %q, want true", got)
	}
	if got, _ := second["id"].(string); got != productID {
		t.Fatalf("replayed product ID = %q, want %q", got, productID)
	}
	if firstHeader.Get("X-RateLimit-Limit") != "100" {
		t.Fatal("public response did not expose rate-limit contract")
	}
	updated, _ := publicJSON(t, http.MethodPatch, baseURL, "/api/v1/products/"+productID, clientID, clientSecret, "e2e-product-name-only-patch", map[string]any{"name": "Renamed public product"})
	if updated["name"] != "Renamed public product" || updated["price"] != float64(77777) || updated["stock"] != float64(7) {
		t.Fatalf("name-only patch must preserve omitted price and stock: %#v", updated)
	}
	page, _ := publicJSON(t, http.MethodGet, baseURL, "/api/v1/products?limit=1&sort=price&direction=ASC", clientID, clientSecret, "", nil)
	pagination, ok := page["pagination"].(map[string]any)
	if !ok || pagination["has_more"] != true {
		t.Fatalf("expected a paginated product response: %#v", page)
	}
	cursor, _ := pagination["next_cursor"].(string)
	if cursor == "" {
		t.Fatal("first page did not return an opaque cursor")
	}
	next, _ := publicJSON(t, http.MethodGet, baseURL, "/api/v1/products?limit=1&sort=price&direction=ASC&cursor="+cursor, clientID, clientSecret, "", nil)
	firstRows, _ := page["data"].([]any)
	nextRows, _ := next["data"].([]any)
	if len(firstRows) != 1 || len(nextRows) != 1 {
		t.Fatalf("expected one product on both pages: first=%d next=%d", len(firstRows), len(nextRows))
	}
	firstRow, _ := firstRows[0].(map[string]any)
	nextRow, _ := nextRows[0].(map[string]any)
	if firstRow["id"] == nextRow["id"] {
		t.Fatal("cursor pagination returned the same product twice")
	}
}

func TestControlPlaneCustomOrderAndEventDebugControls(t *testing.T) {
	baseURL := os.Getenv("MARKETPLACE_E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:18080"
	}
	token := login(t, baseURL)
	shopID := createShop(t, baseURL, token)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/reset", token, map[string]any{})
	products := getJSON(t, baseURL+"/control/v1/shops/"+shopID+"/products", token)
	rows, ok := products["data"].([]any)
	if !ok || len(rows) == 0 {
		t.Fatal("seeded catalog did not contain products")
	}
	product, _ := rows[0].(map[string]any)
	productID, _ := product["id"].(string)
	if productID == "" {
		t.Fatal("seeded product did not contain an ID")
	}

	received := make(chan webhookRequest, 3)
	consumer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		received <- webhookRequest{body: body, header: request.Header.Clone()}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer consumer.Close()
	endpoint := strings.Replace(consumer.URL, "127.0.0.1", "host.docker.internal", 1)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/webhooks", token, map[string]any{"url": endpoint, "secret": "control-debug-secret", "subscribed_events": []string{"order.created"}})

	created := postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/orders", token, map[string]any{
		"items":            []map[string]any{{"product_id": productID, "quantity": 2}},
		"customer":         map[string]any{"name": "Custom E2E Customer", "phone": "+628111111111"},
		"shipping_address": map[string]any{"address_line": "Jl. E2E 1", "city": "Jakarta", "postal_code": "10110"},
	})
	orderID, _ := created["id"].(string)
	if orderID == "" {
		t.Fatal("custom order did not return an ID")
	}
	var initial webhookRequest
	select {
	case initial = <-received:
	case <-time.After(12 * time.Second):
		t.Fatal("custom order webhook was not delivered")
	}
	eventID := initial.header.Get("X-Marketplace-Event-Id")
	if eventID == "" {
		t.Fatal("custom order event ID was missing")
	}
	detail := getJSON(t, baseURL+"/control/v1/orders/"+orderID, token)
	customer, _ := detail["customer_data"].(map[string]any)
	if customer["name"] != "Custom E2E Customer" {
		t.Fatalf("customer snapshot = %#v", customer)
	}
	items, _ := detail["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("custom order items = %#v, want one snapshot", items)
	}

	postJSON(t, baseURL+"/control/v1/events/"+eventID+"/duplicate", token, map[string]any{})
	select {
	case duplicate := <-received:
		if got := duplicate.header.Get("X-Marketplace-Event-Id"); got != eventID {
			t.Fatalf("duplicate event ID = %q, want %q", got, eventID)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("duplicate webhook delivery was not delivered")
	}
	postJSON(t, baseURL+"/control/v1/events/"+eventID+"/delay", token, map[string]any{"delay_seconds": 1})
	select {
	case delayed := <-received:
		if got := delayed.header.Get("X-Marketplace-Event-Id"); got != eventID {
			t.Fatalf("delayed event ID = %q, want %q", got, eventID)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("delayed webhook delivery was not delivered")
	}
}

func TestMaintenanceReturnsDocumentedPublicFailure(t *testing.T) {
	baseURL := os.Getenv("MARKETPLACE_E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:18080"
	}
	token := login(t, baseURL)
	shopID := createShop(t, baseURL, token)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/reset", token, map[string]any{})
	clientID, clientSecret := createCredential(t, baseURL, shopID, token)
	controlJSON(t, http.MethodPut, baseURL+"/control/v1/maintenance", token, map[string]any{"enabled": true})
	defer controlJSON(t, http.MethodPut, baseURL+"/control/v1/maintenance", token, map[string]any{"enabled": false})

	request, err := signedRequest(http.MethodGet, baseURL, "/api/v1/products?limit=1", clientID, clientSecret, nil)
	if err != nil {
		t.Fatalf("build signed request: %v", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("maintenance request: %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(body), "MARKETPLACE_MAINTENANCE") {
		t.Fatalf("maintenance response = %d %s", response.StatusCode, body)
	}
}

func TestOrderLifecycleAndShipmentAPIsEndToEnd(t *testing.T) {
	baseURL := os.Getenv("MARKETPLACE_E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:18080"
	}
	token := login(t, baseURL)
	shopID := createShop(t, baseURL, token)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/reset", token, map[string]any{})
	products := getJSON(t, baseURL+"/control/v1/shops/"+shopID+"/products?limit=1", token)
	productID, _ := products["data"].([]any)[0].(map[string]any)["id"].(string)
	clientID, secret := createCredential(t, baseURL, shopID, token)
	created := postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/orders", token, map[string]any{
		"items":    []map[string]any{{"product_id": productID, "quantity": 1}},
		"customer": map[string]any{"name": "Lifecycle E2E"}, "shipping_address": map[string]any{"city": "Jakarta"},
	})
	orderID, _ := created["id"].(string)
	if created["status"] != "UNPAID" {
		t.Fatalf("created order status = %#v, want UNPAID", created["status"])
	}

	received := make(chan webhookRequest, 7)
	consumer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		received <- webhookRequest{body: body, header: request.Header.Clone()}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer consumer.Close()
	endpoint := strings.Replace(consumer.URL, "127.0.0.1", "host.docker.internal", 1)
	postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/webhooks", token, map[string]any{"url": endpoint, "secret": "lifecycle-e2e", "subscribed_events": []string{"order.paid", "order.processing", "order.ready_to_ship", "order.shipped", "order.in_delivery", "order.delivered", "order.completed"}})

	postJSON(t, baseURL+"/control/v1/orders/"+orderID+"/actions/pay", token, map[string]any{})
	for _, step := range []struct{ path, want string }{{"/ship-order", "PROCESSING"}, {"/ready-to-ship", "READY_TO_SHIP"}} {
		result := shopeeJSON(t, http.MethodPost, baseURL, "/api/shopee/v1/orders/"+orderID+step.path, clientID, secret, nil)
		if result["response"].(map[string]any)["order_status"] != step.want {
			t.Fatalf("%s result = %#v, want %s", step.path, result, step.want)
		}
	}
	shipmentResult := shopeeJSON(t, http.MethodPost, baseURL, "/api/shopee/v1/orders/"+orderID+"/shipments", clientID, secret, map[string]any{"shipping_provider": "shopee_express_like", "pickup_type": "PICKUP"})
	shipment := shipmentResult["response"].(map[string]any)["shipment"].(map[string]any)
	shipmentID, _ := shipment["id"].(string)
	if shipment["status"] != "CREATED" || shipmentID == "" {
		t.Fatalf("shipment create = %#v", shipment)
	}
	for _, action := range []string{"ship", "in_delivery", "deliver"} {
		postJSON(t, baseURL+"/control/v1/shipments/"+shipmentID+"/actions/"+action, token, map[string]any{})
	}
	postJSON(t, baseURL+"/control/v1/orders/"+orderID+"/actions/complete", token, map[string]any{})
	detail := getJSON(t, baseURL+"/control/v1/orders/"+orderID, token)
	if detail["status"] != "COMPLETED" || detail["payment"].(map[string]any)["status"] != "PAID" {
		t.Fatalf("completed control detail = %#v", detail)
	}

	seen := map[string]bool{}
	for range 7 {
		select {
		case request := <-received:
			seen[request.header.Get("X-Marketplace-Event")] = true
		case <-time.After(12 * time.Second):
			t.Fatalf("timed out waiting for lifecycle webhook events; seen=%#v", seen)
		}
	}
	for _, eventType := range []string{"order.paid", "order.processing", "order.ready_to_ship", "order.shipped", "order.in_delivery", "order.delivered", "order.completed"} {
		if !seen[eventType] {
			t.Fatalf("missing lifecycle webhook %s; seen=%#v", eventType, seen)
		}
	}
}

type webhookRequest struct {
	body   []byte
	header http.Header
}

func login(t *testing.T, baseURL string) string {
	t.Helper()
	response := postJSON(t, baseURL+"/control/v1/auth/login", "", map[string]any{"email": "admin@example.test", "password": "change-me-now"})
	token, _ := response["token"].(string)
	if token == "" {
		t.Fatal("login response did not contain token")
	}
	return token
}
func createShop(t *testing.T, baseURL, token string) string {
	t.Helper()
	response := postJSON(t, baseURL+"/control/v1/shops", token, map[string]any{"name": "E2E Webhook Shop " + time.Now().Format("150405.000")})
	id, _ := response["id"].(string)
	if id == "" {
		t.Fatal("shop response did not contain ID")
	}
	return id
}

func createCredential(t *testing.T, baseURL, shopID, token string) (string, string) {
	t.Helper()
	response := postJSON(t, baseURL+"/control/v1/shops/"+shopID+"/credentials", token, map[string]any{})
	clientID, _ := response["client_id"].(string)
	clientSecret, _ := response["client_secret"].(string)
	if clientID == "" || clientSecret == "" {
		t.Fatalf("credential create response is incomplete: %#v", response)
	}
	return clientID, clientSecret
}
func postJSON(t *testing.T, target, token string, body any) map[string]any {
	return controlJSON(t, http.MethodPost, target, token, body)
}

func getJSON(t *testing.T, target, token string) map[string]any {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		t.Fatalf("create GET request: %v", err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET %s: %v", target, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("GET %s returned %d: %s", target, response.StatusCode, raw)
	}
	result := map[string]any{}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	return result
}

func controlJSON(t *testing.T, method, target, token string, body any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request, err := http.NewRequest(method, target, strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("request %s: %v", target, err)
	}
	defer response.Body.Close()
	raw, err = io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("%s %s returned %d: %s", method, target, response.StatusCode, raw)
	}
	var result map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
	return result
}

func publicJSON(t *testing.T, method, baseURL, path, clientID, secret, idempotencyKey string, body any) (map[string]any, http.Header) {
	t.Helper()
	raw := []byte{}
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal public request: %v", err)
		}
	}
	request, err := signedRequest(method, baseURL, path, clientID, secret, raw)
	if err != nil {
		t.Fatalf("create public request: %v", err)
	}
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("public request %s: %v", path, err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read public response: %v", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("%s %s returned %d: %s", method, path, response.StatusCode, responseBody)
	}
	result := map[string]any{}
	if len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, &result); err != nil {
			t.Fatalf("decode public response: %v", err)
		}
	}
	return result, response.Header.Clone()
}

func shopeeJSON(t *testing.T, method, baseURL, path, clientID, secret string, body any) map[string]any {
	t.Helper()
	raw := []byte{}
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal Shopee request: %v", err)
		}
	}
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	request, err := http.NewRequest(method, baseURL+path, strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("create Shopee request: %v", err)
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(clientID + strings.Split(path, "?")[0] + stamp + string(raw)))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Shopee-Partner-Id", clientID)
	request.Header.Set("X-Shopee-Timestamp", stamp)
	request.Header.Set("X-Shopee-Signature", hex.EncodeToString(mac.Sum(nil)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("Shopee request %s: %v", path, err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read Shopee response: %v", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("%s %s returned %d: %s", method, path, response.StatusCode, responseBody)
	}
	result := map[string]any{}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		t.Fatalf("decode Shopee response: %v", err)
	}
	return result
}

func signedRequest(method, baseURL, path, clientID, secret string, raw []byte) (*http.Request, error) {
	request, err := http.NewRequest(method, baseURL+path, strings.NewReader(string(raw)))
	if err != nil {
		return nil, err
	}
	stamp := time.Now().Unix()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(method + strings.Split(path, "?")[0] + strconv.FormatInt(stamp, 10) + string(raw)))
	request.Header.Set("X-Client-Id", clientID)
	request.Header.Set("X-Timestamp", strconv.FormatInt(stamp, 10))
	request.Header.Set("X-Signature", hex.EncodeToString(mac.Sum(nil)))
	return request, nil
}
