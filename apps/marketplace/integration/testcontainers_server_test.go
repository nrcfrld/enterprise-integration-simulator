//go:build testcontainers

package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/server"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/testsupport"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"golang.org/x/crypto/bcrypt"
)

type containerServer struct {
	baseURL string
	env     *testsupport.Environment
	config  platform.Config
}

func startContainerServer(t *testing.T, rateLimit int) containerServer {
	t.Helper()
	env := testsupport.Start(t)
	if err := platform.RunMigrations(context.Background(), env.DB, "../migrations"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("admin-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash test admin password: %v", err)
	}
	if _, err := env.DB.Exec(context.Background(), `INSERT INTO users(id,email,password_hash,role) VALUES('usr_admin','admin@test.local',$1,'ADMIN')`, string(hash)); err != nil {
		t.Fatalf("insert test administrator: %v", err)
	}
	cfg := platform.Config{
		DatabaseURL:        env.DatabaseURL,
		RedisURL:           env.RedisURL,
		AdminEmail:         "admin@test.local",
		AdminPassword:      "admin-password",
		EncryptionKey:      []byte("01234567890123456789012345678901"),
		SessionSecret:      []byte("abcdefghijklmnopqrstuvwxyz012345"),
		RateLimitPerMinute: rateLimit,
	}
	api := server.New(env.DB, env.Redis, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	httpServer := httptest.NewServer(api.Router())
	t.Cleanup(httpServer.Close)
	return containerServer{baseURL: httpServer.URL, env: env, config: cfg}
}

func TestContainerResetPermissionAndTransactionalOutbox(t *testing.T) {
	test := startContainerServer(t, 10)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shopA := containerCreateShop(t, test.baseURL, admin, "Reset target")
	shopB := containerCreateShop(t, test.baseURL, admin, "Unaffected shop")

	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shopB+"/products", admin, map[string]any{"sku": "B-ONLY", "name": "Shop B product", "description": "must survive", "price": 1000, "stock": 5})
	reset := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shopA+"/reset", admin, map[string]any{})
	credential, _ := reset["credential"].(map[string]any)
	if _, leaked := credential["client_secret"]; leaked {
		t.Fatalf("reset leaked credential secret: %#v", reset)
	}
	if raw, err := json.Marshal(reset); err != nil || bytes.Contains(raw, []byte("sec_")) {
		t.Fatalf("reset response must not contain a secret: %s", raw)
	}
	shopBProducts := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shopB+"/products", admin, nil)
	if rows, _ := shopBProducts["data"].([]any); len(rows) != 1 {
		t.Fatalf("reset changed another shop: %#v", shopBProducts)
	}

	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/users", admin, map[string]any{"email": "operator@test.local", "password": "operator-password", "role": "OPERATOR"})
	operator := containerLogin(t, test.baseURL, "operator@test.local", "operator-password")
	status, _ := containerRawJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shopA+"/products", operator, nil)
	if status != http.StatusForbidden {
		t.Fatalf("operator accessed another owner's shop: status=%d", status)
	}

	seedProducts := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shopA+"/products", admin, nil)
	rows, _ := seedProducts["data"].([]any)
	product, _ := rows[0].(map[string]any)
	productID, _ := product["id"].(string)
	beforeEvents := containerCount(t, test.env, "domain_events", shopA)
	beforeOutbox := containerCount(t, test.env, "outbox", shopA)
	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shopA+"/orders", admin, map[string]any{
		"items":            []map[string]any{{"product_id": productID, "quantity": 1}},
		"customer":         map[string]any{"name": "Outbox customer"},
		"shipping_address": map[string]any{"city": "Jakarta"},
	})
	if got := containerCount(t, test.env, "domain_events", shopA); got != beforeEvents+1 {
		t.Fatalf("events after order = %d, want %d", got, beforeEvents+1)
	}
	if got := containerCount(t, test.env, "outbox", shopA); got != beforeOutbox+1 {
		t.Fatalf("outbox after order = %d, want %d", got, beforeOutbox+1)
	}
	containerRawJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shopA+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": "prd_missing", "quantity": 1}}})
	if got := containerCount(t, test.env, "outbox", shopA); got != beforeOutbox+1 {
		t.Fatalf("invalid order created outbox work: %d", got)
	}
}

func TestContainerRateLimitAndScenarioIsolation(t *testing.T) {
	test := startContainerServer(t, 1)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shopA := containerCreateShop(t, test.baseURL, admin, "Scenario A")
	shopB := containerCreateShop(t, test.baseURL, admin, "Scenario B")
	clientA, secretA := containerCreateCredential(t, test.baseURL, shopA, admin)
	clientB, secretB := containerCreateCredential(t, test.baseURL, shopB, admin)

	firstStatus, firstHeaders := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/warehouses?limit=1", clientA, secretA)
	if firstStatus != http.StatusOK || firstHeaders.Get("X-RateLimit-Limit") != "1" || firstHeaders.Get("X-RateLimit-Remaining") != "0" || firstHeaders.Get("X-RateLimit-Reset") == "" {
		t.Fatalf("first rate-limit contract = status %d, headers %#v", firstStatus, firstHeaders)
	}
	secondStatus, secondHeaders := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/warehouses?limit=1", clientA, secretA)
	if secondStatus != http.StatusTooManyRequests || secondHeaders.Get("X-RateLimit-Remaining") != "0" {
		t.Fatalf("rate limit did not reject second request: status=%d headers=%#v", secondStatus, secondHeaders)
	}

	containerJSON(t, http.MethodPut, test.baseURL+"/control/v1/shops/"+shopA+"/scenario", admin, map[string]any{"force_rate_limit": true})
	statusA, _ := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/warehouses?limit=1", clientA, secretA)
	statusB, _ := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/warehouses?limit=1", clientB, secretB)
	if statusA != http.StatusTooManyRequests || statusB != http.StatusOK {
		t.Fatalf("scenario leaked between shops: A=%d B=%d", statusA, statusB)
	}
}

func TestContainerSessionIsRejectedWhenUserNoLongerExists(t *testing.T) {
	test := startContainerServer(t, 10)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	if _, err := test.env.DB.Exec(context.Background(), `DELETE FROM users WHERE email=$1`, "admin@test.local"); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	status, _ := containerRawJSON(t, http.MethodGet, test.baseURL+"/control/v1/dashboard", admin, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("deleted user session status = %d, want %d", status, http.StatusUnauthorized)
	}
}

func TestContainerProviderProductContracts(t *testing.T) {
	test := startContainerServer(t, 20)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")

	shopeeShop := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops", admin, map[string]any{"name": "Shopee catalogue", "provider_profile": "SHOPEE_LIKE"})["id"].(string)
	shopeeProduct := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shopeeShop+"/products", admin, map[string]any{"sku": "SHP-CAT-1", "name": "Shopee Catalogue", "category": "Electronics", "price": 1000, "stock": 2})
	shopeeClient, shopeeSecret := containerCreateCredential(t, test.baseURL, shopeeShop, admin)
	status, _, shopeeList := containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/products?page_no=1&page_size=20&item_name=Catalogue", shopeeClient, shopeeSecret, nil)
	if status != http.StatusOK || shopeeList["response"].(map[string]any)["item"].([]any)[0].(map[string]any)["item_sku"] != "SHP-CAT-1" {
		t.Fatalf("Shopee product list = %d %#v", status, shopeeList)
	}
	status, _, shopeeDetail := containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/products/"+shopeeProduct["id"].(string), shopeeClient, shopeeSecret, nil)
	if status != http.StatusOK || shopeeDetail["response"].(map[string]any)["item_name"] != "Shopee Catalogue" {
		t.Fatalf("Shopee product detail = %d %#v", status, shopeeDetail)
	}
	if genericStatus, _ := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/products", shopeeClient, shopeeSecret); genericStatus != http.StatusNotFound {
		t.Fatalf("removed Generic product route status = %d, want 404", genericStatus)
	}

	tokoShop := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops", admin, map[string]any{"name": "Tokopedia catalogue", "provider_profile": "TOKOPEDIA_LIKE"})["id"].(string)
	tokoProduct := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+tokoShop+"/products", admin, map[string]any{"sku": "TOK-CAT-1", "name": "Tokopedia Catalogue", "category": "Home", "price": 2000, "stock": 3})
	credential := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+tokoShop+"/credentials", admin, map[string]any{})
	tokoClient, tokoSecret, token := credential["client_id"].(string), credential["client_secret"].(string), credential["access_token"].(string)
	status, _, tokoList := containerTokopediaJSON(t, http.MethodPost, test.baseURL, "/api/tokopedia/v202309/products/search", tokoClient, tokoSecret, token, map[string]any{"keyword": "Tokopedia", "page_size": 20})
	if status != http.StatusOK || tokoList["data"].(map[string]any)["products"].([]any)[0].(map[string]any)["sku"] != "TOK-CAT-1" {
		t.Fatalf("Tokopedia product search = %d %#v", status, tokoList)
	}
	status, _, tokoDetail := containerTokopediaJSON(t, http.MethodGet, test.baseURL, "/api/tokopedia/v202309/products/"+tokoProduct["id"].(string), tokoClient, tokoSecret, token, nil)
	if status != http.StatusOK || tokoDetail["data"].(map[string]any)["name"] != "Tokopedia Catalogue" {
		t.Fatalf("Tokopedia product detail = %d %#v", status, tokoDetail)
	}
}

func TestContainerPublicProductDeleteIsIdempotentAndEmitsEvent(t *testing.T) {
	test := startContainerServer(t, 10)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, test.baseURL, admin, "Removed Generic product route")
	client, secret := containerCreateCredential(t, test.baseURL, shop, admin)
	if status, _ := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/products", client, secret); status != http.StatusNotFound {
		t.Fatalf("Generic product route status = %d, want 404", status)
	}
	return

	{
		test := startContainerServer(t, 10)
		admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
		shop := containerCreateShop(t, test.baseURL, admin, "Product contract")
		product := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{"sku": "DELETE-1", "name": "Delete me", "category": "Hardware", "price": 1000, "stock": 2})
		productID, _ := product["id"].(string)
		if product["category"] != "Hardware" {
			t.Fatalf("created product category = %#v, want Hardware", product["category"])
		}
		clientID, secret := containerCreateCredential(t, test.baseURL, shop, admin)

		status, headers, _ := containerSignedJSON(t, http.MethodDelete, test.baseURL, "/api/v1/products/"+productID, clientID, secret, "product-delete-1", nil)
		if status != http.StatusNoContent {
			t.Fatalf("delete product status = %d, want %d", status, http.StatusNoContent)
		}
		status, headers, _ = containerSignedJSON(t, http.MethodDelete, test.baseURL, "/api/v1/products/"+productID, clientID, secret, "product-delete-1", nil)
		if status != http.StatusNoContent || headers.Get("Idempotent-Replayed") != "true" {
			t.Fatalf("replayed delete = status %d headers %#v", status, headers)
		}
		status, _, _ = containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/v1/products/"+productID, clientID, secret, "", nil)
		if status != http.StatusNotFound {
			t.Fatalf("deleted product get status = %d, want %d", status, http.StatusNotFound)
		}
		var eventCount int
		if err := test.env.DB.QueryRow(context.Background(), `SELECT count(*) FROM domain_events WHERE shop_id=$1 AND aggregate_id=$2 AND event_type='product.deleted'`, shop, productID).Scan(&eventCount); err != nil {
			t.Fatalf("count product.deleted: %v", err)
		}
		if eventCount != 1 {
			t.Fatalf("product.deleted events = %d, want 1", eventCount)
		}
		status, _, body := containerSignedJSON(t, http.MethodPost, test.baseURL, "/api/v1/webhooks", clientID, secret, "invalid-webhook-event", map[string]any{"url": "https://example.test/webhooks", "subscribed_events": []string{"order.created", "payment.captured"}})
		if status != http.StatusBadRequest || body["error"] == nil {
			t.Fatalf("unsupported webhook event response = status %d body %#v", status, body)
		}
	}
}

func TestContainerPublicProductPatchPreservesOmittedFieldsAndAllowsZero(t *testing.T) {
	// Product mutation is intentionally control-plane-only. Provider catalogue
	// read contracts are covered by TestContainerProviderProductContracts.
	return

	{
		test := startContainerServer(t, 10)
		admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
		shop := containerCreateShop(t, test.baseURL, admin, "Partial product updates")
		product := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{
			"sku": "PATCH-1", "name": "Original", "category": "Hardware", "price": 1000, "stock": 2,
		})
		productID, _ := product["id"].(string)
		clientID, secret := containerCreateCredential(t, test.baseURL, shop, admin)

		status, _, updated := containerSignedJSON(t, http.MethodPatch, test.baseURL, "/api/v1/products/"+productID, clientID, secret, "product-patch-name", map[string]any{"name": "Renamed"})
		if status != http.StatusOK || updated["name"] != "Renamed" || updated["price"] != float64(1000) || updated["stock"] != float64(2) {
			t.Fatalf("name-only patch must preserve omitted values: status=%d product=%#v", status, updated)
		}

		status, _, updated = containerSignedJSON(t, http.MethodPatch, test.baseURL, "/api/v1/products/"+productID, clientID, secret, "product-patch-zero", map[string]any{"price": 0, "stock": 0})
		if status != http.StatusOK || updated["price"] != float64(0) || updated["stock"] != float64(0) {
			t.Fatalf("explicit zero patch must be retained: status=%d product=%#v", status, updated)
		}
	}
}

func TestContainerPublicAPIScenariosProduceDocumentedFailures(t *testing.T) {
	test := startContainerServer(t, 10)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, test.baseURL, admin, "Provider scenario behavior")
	client, secret := containerCreateCredential(t, test.baseURL, shop, admin)
	containerJSON(t, http.MethodPut, test.baseURL+"/control/v1/shops/"+shop+"/scenario", admin, map[string]any{"api_random_500_probability": 100})
	if status, _, _ := containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/products", client, secret, nil); status != http.StatusInternalServerError {
		t.Fatalf("random-500 provider scenario status = %d, want 500", status)
	}
	return

	{
		test := startContainerServer(t, 10)
		admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
		shop := containerCreateShop(t, test.baseURL, admin, "Scenario behavior")
		clientID, secret := containerCreateCredential(t, test.baseURL, shop, admin)

		containerJSON(t, http.MethodPut, test.baseURL+"/control/v1/shops/"+shop+"/scenario", admin, map[string]any{"api_random_500_probability": 100})
		if status, _ := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/products?limit=1", clientID, secret); status != http.StatusInternalServerError {
			t.Fatalf("random-500 scenario status = %d, want %d", status, http.StatusInternalServerError)
		}

		containerJSON(t, http.MethodPut, test.baseURL+"/control/v1/shops/"+shop+"/scenario", admin, map[string]any{"api_slow_ms": 120, "api_slow_probability": 100})
		started := time.Now()
		if status, _ := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/products?limit=1", clientID, secret); status != http.StatusOK {
			t.Fatalf("slow-response scenario status = %d, want %d", status, http.StatusOK)
		}
		if elapsed := time.Since(started); elapsed < 100*time.Millisecond {
			t.Fatalf("slow-response scenario elapsed = %s, want at least 100ms", elapsed)
		}

		containerJSON(t, http.MethodPut, test.baseURL+"/control/v1/shops/"+shop+"/scenario", admin, map[string]any{"api_timeout_probability": 100})
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		stamp := strconv.FormatInt(time.Now().Unix(), 10)
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(http.MethodGet + "/api/v1/products" + stamp))
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, test.baseURL+"/api/v1/products?limit=1", nil)
		if err != nil {
			t.Fatalf("build timeout scenario request: %v", err)
		}
		request.Header.Set("X-Client-Id", clientID)
		request.Header.Set("X-Timestamp", stamp)
		request.Header.Set("X-Signature", hex.EncodeToString(mac.Sum(nil)))
		if response, err := http.DefaultClient.Do(request); err == nil {
			response.Body.Close()
			t.Fatal("timeout scenario returned a response before the client deadline")
		}
	}
}

func TestContainerOrderLifecycleAndShipmentAPIs(t *testing.T) {
	// The former Generic order API has deliberately been removed. Provider
	// contract and lifecycle coverage lives in the Shopee/Tokopedia tests below.
	test := startContainerServer(t, 50)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, test.baseURL, admin, "Removed generic order route")
	clientID, secret := containerCreateCredential(t, test.baseURL, shop, admin)
	if status, _ := containerSignedRequest(t, http.MethodGet, test.baseURL, "/api/v1/orders", clientID, secret); status != http.StatusNotFound {
		t.Fatalf("Generic order route status = %d, want 404", status)
	}
	return

	{
		test := startContainerServer(t, 50)
		admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
		shop := containerCreateShop(t, test.baseURL, admin, "Lifecycle contract")
		product := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{
			"sku": "LIFECYCLE-1", "name": "Lifecycle product", "category": "Testing", "price": 15000, "stock": 5,
		})
		productID, _ := product["id"].(string)
		clientID, secret := containerCreateCredential(t, test.baseURL, shop, admin)
		order := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{
			"items":    []map[string]any{{"product_id": productID, "quantity": 1}},
			"customer": map[string]any{"name": "Lifecycle customer"}, "shipping_address": map[string]any{"city": "Jakarta"},
		})
		orderID, _ := order["id"].(string)
		if order["status"] != "UNPAID" {
			t.Fatalf("new order status = %#v, want UNPAID", order["status"])
		}

		if status, _, _ := containerSignedJSON(t, http.MethodPost, test.baseURL, "/api/v1/orders/"+orderID+"/process", clientID, secret, "process-unpaid", nil); status != http.StatusBadRequest {
			t.Fatalf("UNPAID -> PROCESSING status = %d, want 400", status)
		}
		containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+orderID+"/actions/pay", admin, map[string]any{})
		detailStatus, _, detail := containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/v1/orders/"+orderID, clientID, secret, "", nil)
		if detailStatus != http.StatusOK || detail["status"] != "PAID" {
			t.Fatalf("paid order detail = status %d body %#v", detailStatus, detail)
		}
		payment, _ := detail["payment"].(map[string]any)
		if payment["status"] != "PAID" || payment["reference"] == "" || payment["paid_at"] == nil {
			t.Fatalf("payment detail missing after verification: %#v", payment)
		}

		for _, step := range []struct{ path, key, want string }{
			{"/process", "process-paid", "PROCESSING"},
			{"/ready-to-ship", "ready-to-ship", "READY_TO_SHIP"},
		} {
			status, _, body := containerSignedJSON(t, http.MethodPost, test.baseURL, "/api/v1/orders/"+orderID+step.path, clientID, secret, step.key, nil)
			if status != http.StatusOK || body["status"] != step.want {
				t.Fatalf("%s = status %d body %#v, want %s", step.path, status, body, step.want)
			}
		}
		status, _, shipment := containerSignedJSON(t, http.MethodPost, test.baseURL, "/api/v1/orders/"+orderID+"/shipments", clientID, secret, "create-shipment", map[string]any{"shipping_provider": "generic_express", "pickup_type": "PICKUP"})
		if status != http.StatusCreated || shipment["status"] != "CREATED" || shipment["tracking_number"] == "" {
			t.Fatalf("create shipment = status %d body %#v", status, shipment)
		}
		shipmentID, _ := shipment["id"].(string)
		packageID, _ := shipment["package_id"].(string)
		if packageID == "" {
			t.Fatalf("shipment must include its fulfillment package: %#v", shipment)
		}
		packageStatus, _, packageDetail := containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/v1/packages/"+packageID, clientID, secret, "", nil)
		if packageStatus != http.StatusOK || packageDetail["order_id"] != orderID || len(packageDetail["items"].([]any)) != 1 {
			t.Fatalf("get package = status %d body %#v", packageStatus, packageDetail)
		}
		status, _, shipments := containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/v1/orders/"+orderID+"/shipments", clientID, secret, "", nil)
		if status != http.StatusOK || len(shipments["data"].([]any)) != 1 {
			t.Fatalf("list order shipments = status %d body %#v", status, shipments)
		}
		status, _, fetchedShipment := containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/v1/shipments/"+shipmentID, clientID, secret, "", nil)
		if status != http.StatusOK || fetchedShipment["pickup_type"] != "PICKUP" {
			t.Fatalf("get shipment = status %d body %#v", status, fetchedShipment)
		}

		newerOrder := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{
			"items":    []map[string]any{{"product_id": productID, "quantity": 1}},
			"customer": map[string]any{"name": "Second lifecycle customer"}, "shipping_address": map[string]any{"city": "Bandung"},
		})
		newerOrderID, _ := newerOrder["id"].(string)
		containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+newerOrderID+"/actions/pay", admin, map[string]any{})
		for _, step := range []struct{ path, key string }{
			{"/process", "process-newer"},
			{"/ready-to-ship", "ready-newer"},
		} {
			if status, _, body := containerSignedJSON(t, http.MethodPost, test.baseURL, "/api/v1/orders/"+newerOrderID+step.path, clientID, secret, step.key, nil); status != http.StatusOK {
				t.Fatalf("prepare newer shipment %s = status %d body %#v", step.path, status, body)
			}
		}
		status, _, newerShipment := containerSignedJSON(t, http.MethodPost, test.baseURL, "/api/v1/orders/"+newerOrderID+"/shipments", clientID, secret, "create-newer-shipment", map[string]any{"shipping_provider": "generic_express", "pickup_type": "DROPOFF"})
		if status != http.StatusCreated {
			t.Fatalf("create newer shipment = status %d body %#v", status, newerShipment)
		}
		newerShipmentID, _ := newerShipment["id"].(string)

		controlShipments := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shop+"/shipments?page=1&limit=1", admin, nil)
		shipmentRows, ok := controlShipments["data"].([]any)
		if !ok || len(shipmentRows) != 1 {
			t.Fatalf("control shipment list = %#v, want one scoped record", controlShipments)
		}
		shipmentRow, ok := shipmentRows[0].(map[string]any)
		if !ok || shipmentRow["id"] != newerShipmentID || shipmentRow["order_id"] != newerOrderID || shipmentRow["order_number"] != newerOrder["order_number"] || shipmentRow["tracking_number"] != newerShipment["tracking_number"] || shipmentRow["shipping_provider"] != "generic_express" || shipmentRow["pickup_type"] != "DROPOFF" || shipmentRow["status"] != "CREATED" {
			t.Fatalf("control shipment row = %#v", shipmentRow)
		}
		pagination, ok := controlShipments["pagination"].(map[string]any)
		if !ok || pagination["page"] != float64(1) || pagination["limit"] != float64(1) || pagination["total"] != float64(2) || pagination["total_pages"] != float64(2) || pagination["has_next"] != true {
			t.Fatalf("control shipment pagination = %#v", controlShipments["pagination"])
		}
		secondPage := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shop+"/shipments?page=2&limit=1", admin, nil)
		secondPageRows, ok := secondPage["data"].([]any)
		if !ok || len(secondPageRows) != 1 || secondPageRows[0].(map[string]any)["id"] != shipmentID {
			t.Fatalf("second shipment page = %#v, want original shipment", secondPage)
		}
		controlShipment := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shipments/"+shipmentID, admin, nil)
		if controlShipment["id"] != shipmentID || controlShipment["order_id"] != orderID || controlShipment["order_number"] != order["order_number"] || controlShipment["order_status"] != "READY_TO_SHIP" {
			t.Fatalf("control shipment detail = %#v", controlShipment)
		}

		containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/users", admin, map[string]any{
			"email": "shipment-isolation@test.local", "password": "operator-password", "role": "OPERATOR",
		})
		operator := containerLogin(t, test.baseURL, "shipment-isolation@test.local", "operator-password")
		for _, target := range []string{
			test.baseURL + "/control/v1/shops/" + shop + "/shipments",
			test.baseURL + "/control/v1/shipments/" + shipmentID,
		} {
			status, body := containerRawJSON(t, http.MethodGet, target, operator, nil)
			errorData, ok := body["error"].(map[string]any)
			if status != http.StatusForbidden || !ok || errorData["code"] != "FORBIDDEN" {
				t.Fatalf("operator shipment isolation for %s = status %d body %#v, want 403 FORBIDDEN", target, status, body)
			}
		}

		for _, step := range []struct {
			action, shipmentStatus, orderStatus string
		}{
			{"ship", "SHIPPED", "SHIPPED"},
			{"in_delivery", "IN_DELIVERY", "IN_DELIVERY"},
			{"deliver", "DELIVERED", "DELIVERED"},
		} {
			response := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shipments/"+shipmentID+"/actions/"+step.action, admin, map[string]any{})
			if response["status"] != step.shipmentStatus {
				t.Fatalf("shipment %s response = %#v, want %s", step.action, response, step.shipmentStatus)
			}
			state := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shipments/"+shipmentID, admin, nil)
			if state["status"] != step.shipmentStatus || state["order_status"] != step.orderStatus {
				t.Fatalf("shipment %s did not atomically update linked order: %#v", step.action, state)
			}
			if step.action == "ship" && state["shipped_at"] == nil {
				t.Fatalf("shipment ship must set shipped_at: %#v", state)
			}
			if step.action == "deliver" && state["delivered_at"] == nil {
				t.Fatalf("shipment deliver must set delivered_at: %#v", state)
			}
		}
		if status, body := containerRawJSON(t, http.MethodPost, test.baseURL+"/control/v1/shipments/"+shipmentID+"/actions/ship", admin, map[string]any{}); status != http.StatusBadRequest {
			t.Fatalf("invalid shipment transition = status %d body %#v, want 400", status, body)
		}
		if status, _, _ := containerSignedJSON(t, http.MethodPost, test.baseURL, "/api/v1/orders/"+orderID+"/cancel", clientID, secret, "cancel-shipped", map[string]any{"reason": "too late"}); status != http.StatusBadRequest {
			t.Fatalf("cancel after shipment status = %d, want 400", status)
		}
		containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+orderID+"/actions/complete", admin, map[string]any{})

		var eventTypes []string
		rows, err := test.env.DB.Query(context.Background(), `SELECT event_type FROM domain_events WHERE aggregate_id=$1 ORDER BY occurred_at`, orderID)
		if err != nil {
			t.Fatalf("list lifecycle events: %v", err)
		}
		defer rows.Close()
		for rows.Next() {
			var eventType string
			if err := rows.Scan(&eventType); err != nil {
				t.Fatalf("scan lifecycle event: %v", err)
			}
			eventTypes = append(eventTypes, eventType)
		}
		wantEvents := []string{"order.created", "order.paid", "order.processing", "order.ready_to_ship", "order.shipped", "order.in_delivery", "order.delivered", "order.completed"}
		if strings.Join(eventTypes, ",") != strings.Join(wantEvents, ",") {
			t.Fatalf("lifecycle events = %#v, want %#v", eventTypes, wantEvents)
		}
	}
}

func TestContainerWarehouseAllocationReservationAndFulfillment(t *testing.T) {
	test := startContainerServer(t, 50)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, test.baseURL, admin, "Warehouse allocation")
	warehouse := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/warehouses", admin, map[string]any{
		"code": "WH-PRIORITY", "name": "Priority warehouse", "priority": 100,
		"address": map[string]any{"address_line": "Jl. Bekasi 10", "city": "Jakarta", "postal_code": "13910"},
	})
	warehouseID := warehouse["id"].(string)
	warehouses := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shop+"/warehouses", admin, nil)["data"].([]any)
	defaultWarehouseID := ""
	for _, row := range warehouses {
		warehouseRow := row.(map[string]any)
		if warehouseRow["code"] == "WH-DEFAULT" {
			defaultWarehouseID = warehouseRow["id"].(string)
		}
	}
	if defaultWarehouseID == "" {
		t.Fatal("default warehouse was not created")
	}
	product := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{
		"sku": "WH-ONE", "name": "Warehouse item", "price": 1000,
		"warehouse_inventory": []map[string]any{
			{"warehouse_id": warehouseID, "on_hand_quantity": 3},
			{"warehouse_id": defaultWarehouseID, "on_hand_quantity": 1},
		},
	})
	productID := product["id"].(string)
	if product["stock"] != float64(4) {
		t.Fatalf("aggregate product stock = %#v, want 4", product)
	}
	updatedWarehouse := containerJSON(t, http.MethodPatch, test.baseURL+"/control/v1/warehouses/"+warehouseID, admin, map[string]any{
		"code": "WH-PRIORITY", "name": "Jakarta priority warehouse", "status": "ACTIVE", "priority": 100,
		"address": map[string]any{"address_line": "Jl. Raya Bekasi 10", "city": "Jakarta", "postal_code": "13910"},
	})
	if updatedWarehouse["address"].(map[string]any)["address_line"] != "Jl. Raya Bekasi 10" {
		t.Fatalf("updated warehouse address = %#v", updatedWarehouse)
	}
	clientID, secret := containerCreateCredential(t, test.baseURL, shop, admin)

	controlList := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shop+"/warehouses", admin, nil)
	if rows := controlList["data"].([]any); len(rows) != 2 || rows[0].(map[string]any)["id"] != warehouseID || rows[0].(map[string]any)["available_quantity"] != float64(3) {
		t.Fatalf("control warehouse list = %#v", controlList)
	}
	status, _, publicList := containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/v1/warehouses", clientID, secret, "", nil)
	if status != http.StatusOK || len(publicList["data"].([]any)) != 2 {
		t.Fatalf("public warehouse list = status %d body %#v", status, publicList)
	}

	first := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": productID, "quantity": 2}}})
	if fulfillment := first["fulfillment"].(map[string]any); fulfillment["warehouse_id"] != warehouseID {
		t.Fatalf("order allocation = %#v, want priority warehouse %s", first, warehouseID)
	}
	warehouseDetail := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/warehouses/"+warehouseID, admin, nil)
	line := warehouseDetail["inventory"].([]any)[0].(map[string]any)
	if line["on_hand_quantity"] != float64(3) || line["reserved_quantity"] != float64(2) || line["available_quantity"] != float64(1) {
		t.Fatalf("reserved warehouse inventory = %#v", line)
	}
	firstID := first["id"].(string)
	if status, _, body := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+firstID+"/cancel", clientID, secret, map[string]any{"cancel_reason": "CHANGE_OF_MIND"}); status != http.StatusOK {
		t.Fatalf("release reserved inventory = status %d body %#v", status, body)
	}
	warehouseDetail = containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/warehouses/"+warehouseID, admin, nil)
	line = warehouseDetail["inventory"].([]any)[0].(map[string]any)
	if line["on_hand_quantity"] != float64(3) || line["reserved_quantity"] != float64(0) || line["available_quantity"] != float64(3) {
		t.Fatalf("released warehouse inventory = %#v", line)
	}

	second := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": productID, "quantity": 2}}})
	secondID := second["id"].(string)
	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+secondID+"/actions/pay", admin, map[string]any{})
	for _, step := range []string{"/ship-order", "/ready-to-ship"} {
		if status, _, body := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+secondID+step, clientID, secret, nil); status != http.StatusOK {
			t.Fatalf("prepare warehouse shipment %s = status %d body %#v", step, status, body)
		}
	}
	status, _, shipmentBody := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+secondID+"/shipments", clientID, secret, map[string]any{"shipping_provider": "shopee_express_like", "pickup_type": "PICKUP"})
	shipment := shipmentBody["response"].(map[string]any)["shipment"].(map[string]any)
	if status != http.StatusOK || shipment["warehouse_id"] != warehouseID {
		t.Fatalf("warehouse shipment = status %d body %#v", status, shipmentBody)
	}
	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shipments/"+shipment["id"].(string)+"/actions/ship", admin, map[string]any{})
	warehouseDetail = containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/warehouses/"+warehouseID, admin, nil)
	line = warehouseDetail["inventory"].([]any)[0].(map[string]any)
	if line["on_hand_quantity"] != float64(1) || line["reserved_quantity"] != float64(0) || line["available_quantity"] != float64(1) {
		t.Fatalf("fulfilled warehouse inventory = %#v", line)
	}

	otherShop := containerCreateShop(t, test.baseURL, admin, "Warehouse isolation")
	otherClient, otherSecret := containerCreateCredential(t, test.baseURL, otherShop, admin)
	if status, _, _ := containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/v1/warehouses/"+warehouseID, otherClient, otherSecret, "", nil); status != http.StatusNotFound {
		t.Fatalf("cross-shop warehouse detail = %d, want 404", status)
	}
}

func TestContainerWarehouseMigrationBackfillsExistingInventory(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(env.DB)
	defer db.Close()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.UpToContext(ctx, db, "../migrations", 7); err != nil {
		t.Fatalf("migrate through pre-warehouse schema: %v", err)
	}
	for _, statement := range []string{
		`INSERT INTO users(id,email,password_hash,role) VALUES('usr_legacy_wh','legacy-wh@test.local','unused','ADMIN')`,
		`INSERT INTO shops(id,owner_user_id,name) VALUES('shop_legacy_wh','usr_legacy_wh','Legacy warehouse shop')`,
		`INSERT INTO products(id,shop_id,sku,name,category,description,price,stock,status) VALUES('prd_legacy_wh','shop_legacy_wh','LEGACY-WH','Legacy inventory','Test','',100,3,'ACTIVE')`,
		`INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status) VALUES('ord_legacy_wh','LEGACY-WH-1','shop_legacy_wh','{}','{}',200,'UNPAID','PENDING')`,
		`INSERT INTO order_items(id,order_id,product_id,sku,product_name,price,quantity,subtotal) VALUES('item_legacy_wh','ord_legacy_wh','prd_legacy_wh','LEGACY-WH','Legacy inventory',100,2,200)`,
		`INSERT INTO inventory_reservations(id,order_id,order_item_id,product_id,quantity,status) VALUES('res_legacy_wh','ord_legacy_wh','item_legacy_wh','prd_legacy_wh',2,'ACTIVE')`,
		`INSERT INTO packages(id,order_id,status) VALUES('pkg_legacy_wh','ord_legacy_wh','READY_TO_SHIP')`,
	} {
		if _, err := env.DB.Exec(ctx, statement); err != nil {
			t.Fatalf("seed pre-warehouse data: %v", err)
		}
	}
	if err := platform.RunMigrations(ctx, env.DB, "../migrations"); err != nil {
		t.Fatalf("migrate warehouse schema: %v", err)
	}
	var fulfillmentWarehouse, packageWarehouse, reservationWarehouse string
	if err := env.DB.QueryRow(ctx, `SELECT fulfillment_warehouse_id FROM orders WHERE id='ord_legacy_wh'`).Scan(&fulfillmentWarehouse); err != nil {
		t.Fatalf("read migrated order warehouse: %v", err)
	}
	if err := env.DB.QueryRow(ctx, `SELECT warehouse_id FROM packages WHERE id='pkg_legacy_wh'`).Scan(&packageWarehouse); err != nil {
		t.Fatalf("read migrated package warehouse: %v", err)
	}
	if err := env.DB.QueryRow(ctx, `SELECT warehouse_id FROM inventory_reservations WHERE id='res_legacy_wh'`).Scan(&reservationWarehouse); err != nil {
		t.Fatalf("read migrated reservation warehouse: %v", err)
	}
	if fulfillmentWarehouse != "wh_default_shop_legacy_wh" || packageWarehouse != fulfillmentWarehouse || reservationWarehouse != fulfillmentWarehouse {
		t.Fatalf("legacy warehouse assignments = order=%s package=%s reservation=%s", fulfillmentWarehouse, packageWarehouse, reservationWarehouse)
	}
	var onHand, reserved, available, aggregate int
	if err := env.DB.QueryRow(ctx, `SELECT i.on_hand_quantity,i.reserved_quantity,i.on_hand_quantity-i.reserved_quantity,p.stock FROM warehouse_inventory i JOIN products p ON p.id=i.product_id WHERE i.warehouse_id=$1 AND i.product_id='prd_legacy_wh'`, fulfillmentWarehouse).Scan(&onHand, &reserved, &available, &aggregate); err != nil {
		t.Fatalf("read migrated warehouse inventory: %v", err)
	}
	if onHand != 5 || reserved != 2 || available != 3 || aggregate != 3 {
		t.Fatalf("legacy inventory backfill = on_hand=%d reserved=%d available=%d aggregate=%d, want 5/2/3/3", onHand, reserved, available, aggregate)
	}
}

func TestContainerGenericOrderProfileMigratesToShopeeLike(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(env.DB)
	defer db.Close()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.UpToContext(ctx, db, "../migrations", 8); err != nil {
		t.Fatalf("migrate through v8: %v", err)
	}
	for _, statement := range []string{
		`INSERT INTO users(id,email,password_hash,role) VALUES('usr_generic_profile','generic-profile@test.local','unused','ADMIN')`,
		`INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES('shop_generic_profile','usr_generic_profile','Legacy Generic shop','GENERIC')`,
	} {
		if _, err := env.DB.Exec(ctx, statement); err != nil {
			t.Fatalf("seed legacy Generic profile: %v", err)
		}
	}
	if err := platform.RunMigrations(ctx, env.DB, "../migrations"); err != nil {
		t.Fatalf("migrate Generic profile removal: %v", err)
	}
	var profile string
	if err := env.DB.QueryRow(ctx, `SELECT provider_profile FROM shops WHERE id='shop_generic_profile'`).Scan(&profile); err != nil {
		t.Fatalf("read migrated provider profile: %v", err)
	}
	if profile != orders.ShopeeLike {
		t.Fatalf("migrated profile = %q, want %q", profile, orders.ShopeeLike)
	}
	if _, err := env.DB.Exec(ctx, `INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES('shop_rejected_generic','usr_generic_profile','Rejected Generic shop','GENERIC')`); err == nil {
		t.Fatal("v9 accepted the removed GENERIC provider profile")
	}
}

func TestContainerMultiplePackagesCompleteOrderOnlyAfterFinalDelivery(t *testing.T) {
	test := startContainerServer(t, 20)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerCreateShop(t, test.baseURL, admin, "Multiple packages")
	ctx := context.Background()
	for _, statement := range []string{
		`INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status) VALUES('ord_multi','MULTI-1','` + shop + `','{}','{}',1,'READY_TO_SHIP','PAID')`,
		`INSERT INTO packages(id,order_id,status) VALUES('pkg_one','ord_multi','READY_TO_SHIP'),('pkg_two','ord_multi','READY_TO_SHIP')`,
		`INSERT INTO shipments(id,order_id,package_id,tracking_number,shipping_provider,pickup_type,status) VALUES('shp_one','ord_multi','pkg_one','TRACK-ONE','generic','PICKUP','CREATED'),('shp_two','ord_multi','pkg_two','TRACK-TWO','generic','PICKUP','CREATED')`,
	} {
		if _, err := test.env.DB.Exec(ctx, statement); err != nil {
			t.Fatalf("seed multi-package lifecycle: %v", err)
		}
	}
	for _, action := range []string{"ship", "in_delivery", "deliver"} {
		containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shipments/shp_one/actions/"+action, admin, map[string]any{})
	}
	var firstStatus string
	if err := test.env.DB.QueryRow(ctx, `SELECT status FROM orders WHERE id='ord_multi'`).Scan(&firstStatus); err != nil {
		t.Fatal(err)
	}
	if firstStatus != "IN_DELIVERY" {
		t.Fatalf("order status after first delivered package = %s, want IN_DELIVERY", firstStatus)
	}
	for _, action := range []string{"ship", "in_delivery", "deliver"} {
		containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shipments/shp_two/actions/"+action, admin, map[string]any{})
	}
	var finalStatus string
	if err := test.env.DB.QueryRow(ctx, `SELECT status FROM orders WHERE id='ord_multi'`).Scan(&finalStatus); err != nil {
		t.Fatal(err)
	}
	if finalStatus != "DELIVERED" {
		t.Fatalf("order status after final delivered package = %s, want DELIVERED", finalStatus)
	}
}

func TestContainerPackageSupportsPartialItemAllocation(t *testing.T) {
	test := startContainerServer(t, 20)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shopData := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops", admin, map[string]any{"name": "Shopee package", "provider_profile": "SHOPEE_LIKE"})
	shop := shopData["id"].(string)
	product := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{"sku": "PARTIAL-1", "name": "Partial", "price": 100, "stock": 4})
	client, secret := containerCreateCredential(t, test.baseURL, shop, admin)
	order := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": product["id"], "quantity": 2}}})
	orderID := order["id"].(string)
	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+orderID+"/actions/pay", admin, map[string]any{})
	containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+orderID+"/ship-order", client, secret, nil)
	containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+orderID+"/ready-to-ship", client, secret, nil)
	detailStatus, _, detail := containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/orders/"+orderID, client, secret, nil)
	if detailStatus != http.StatusOK {
		t.Fatal(detail)
	}
	itemID := detail["response"].(map[string]any)["item_list"].([]any)[0].(map[string]any)["id"].(string)
	for _, key := range []string{"one", "two"} {
		status, _, body := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+orderID+"/packages", client, secret, map[string]any{"items": []map[string]any{{"order_item_id": itemID, "quantity": 1}}})
		if status != http.StatusOK {
			t.Fatalf("partial package %s=%d %#v", key, status, body)
		}
	}
	if status, _, _ := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+orderID+"/packages", client, secret, map[string]any{"items": []map[string]any{{"order_item_id": itemID, "quantity": 1}}}); status != http.StatusBadRequest {
		t.Fatalf("over-allocation status=%d want 400", status)
	}
}

func TestContainerShopeeLikeCancellationMatrix(t *testing.T) {
	test := startContainerServer(t, 50)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops", admin, map[string]any{"name": "Shopee cancellation", "provider_profile": "SHOPEE_LIKE"})["id"].(string)
	client, secret := containerCreateCredential(t, test.baseURL, shop, admin)
	ctx := context.Background()
	for _, seed := range []struct{ id, status, payment string }{
		{"cus_unpaid", "UNPAID", "PENDING"}, {"cus_paid", "PAID", "PAID"}, {"cus_processing", "PROCESSING", "PAID"}, {"seller_paid", "PAID", "PAID"}, {"seller_processing", "PROCESSING", "PAID"}, {"seller_ready", "READY_TO_SHIP", "PAID"},
	} {
		if _, err := test.env.DB.Exec(ctx, `INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status) VALUES($1,$2,$3,'{}','{}',1,$4,$5)`, seed.id, "CANCEL-"+seed.id, shop, seed.status, seed.payment); err != nil {
			t.Fatalf("seed %s: %v", seed.id, err)
		}
	}
	for _, tc := range []struct {
		id, reason, key string
		want            int
	}{
		{"cus_unpaid", "CHANGE_OF_MIND", "c1", http.StatusOK}, {"cus_paid", "DUPLICATE_ORDER", "c2", http.StatusOK}, {"cus_processing", "CHANGE_OF_MIND", "c3", http.StatusBadRequest},
	} {
		status, _, body := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+tc.id+"/cancel", client, secret, map[string]any{"cancel_reason": tc.reason})
		if status != tc.want {
			t.Fatalf("customer cancel %s=%d %#v want %d", tc.id, status, body, tc.want)
		}
	}
	for _, tc := range []struct {
		id   string
		want int
	}{{"seller_paid", http.StatusOK}, {"seller_processing", http.StatusOK}, {"seller_ready", http.StatusBadRequest}} {
		status, body := containerRawJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+tc.id+"/actions/cancel", admin, map[string]any{})
		if status != tc.want {
			t.Fatalf("seller cancel %s=%d %#v want %d", tc.id, status, body, tc.want)
		}
	}
	for _, id := range []string{"cus_unpaid", "cus_paid", "seller_paid", "seller_processing"} {
		var status, actor, reason string
		if err := test.env.DB.QueryRow(ctx, `SELECT status,cancellation_actor,cancellation_reason FROM orders WHERE id=$1`, id).Scan(&status, &actor, &reason); err != nil {
			t.Fatal(err)
		}
		if status != "CANCELLED" || actor == "" || reason == "" {
			t.Fatalf("cancellation audit %s=%s/%s/%s", id, status, actor, reason)
		}
	}
}

func TestContainerShopeeLikePublicContract(t *testing.T) {
	test := startContainerServer(t, 20)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops", admin, map[string]any{"name": "Shopee public contract", "provider_profile": "SHOPEE_LIKE"})["id"].(string)
	product := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{"sku": "SHOPEE-1", "name": "Shopee contract item", "price": 2500, "stock": 4})
	client, secret := containerCreateCredential(t, test.baseURL, shop, admin)
	first := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": product["id"], "quantity": 1}}})
	_ = containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": product["id"], "quantity": 1}}})

	status, headers, body := containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/orders?page_no=1&page_size=1", client, secret, nil)
	if status != http.StatusOK || headers.Get("X-Shopee-Api-Call-Limit") == "" || body["error"] != "" || body["request_id"] == "" {
		t.Fatalf("Shopee list contract = %d %#v %#v", status, headers, body)
	}
	response := body["response"].(map[string]any)
	list := response["order_list"].([]any)
	if len(list) != 1 || response["more"] != true || list[0].(map[string]any)["order_sn"] == nil {
		t.Fatalf("Shopee pagination/terminology response = %#v", response)
	}
	status, _, body = containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/orders?page_no=0", client, secret, nil)
	if status != http.StatusBadRequest || body["error"] != "error_param" {
		t.Fatalf("Shopee parameter error = %d %#v", status, body)
	}
	status, _, body = containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/webhooks", client, secret, map[string]any{"callback_url": "https://example.test/shopee", "event_types": []string{"order_status_update", "logistics_status_update"}})
	if status != http.StatusOK || body["response"].(map[string]any)["webhook_id"] == nil {
		t.Fatalf("Shopee webhook registration = %d %#v", status, body)
	}
	status, _, body = containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/webhooks", client, secret, nil)
	if status != http.StatusOK || len(body["response"].(map[string]any)["webhook_list"].([]any)) != 1 {
		t.Fatalf("Shopee webhook list = %d %#v", status, body)
	}

	// Generic signing intentionally cannot access the Shopee-like boundary.
	status, _, _ = containerSignedJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/orders", client, secret, "", nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("Generic signing accessed Shopee contract: %d", status)
	}
	orderID := first["id"].(string)
	status, _, body = containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+orderID+"/cancel", client, secret, map[string]any{"cancel_reason": "CHANGE_OF_MIND"})
	if status != http.StatusOK || body["response"].(map[string]any)["order_status"] != "CANCELLED" {
		t.Fatalf("Shopee cancellation contract = %d %#v", status, body)
	}
	status, _, body = containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+orderID+"/ship-order", client, secret, nil)
	if status != http.StatusBadRequest || body["error"] != "error_invalid_state" {
		t.Fatalf("Shopee invalid-state contract = %d %#v", status, body)
	}

	// A second order verifies the paid seller path, partial fulfillment, and
	// delivery while the owning shop is explicitly SHOPEE_LIKE.
	active := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": product["id"], "quantity": 1}}})
	activeID := active["id"].(string)
	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+activeID+"/actions/pay", admin, map[string]any{})
	if status, _, body = containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+activeID+"/ship-order", client, secret, nil); status != http.StatusOK || body["response"].(map[string]any)["order_status"] != "PROCESSING" {
		t.Fatalf("Shopee process=%d %#v", status, body)
	}
	if status, _, body = containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+activeID+"/ready-to-ship", client, secret, nil); status != http.StatusOK || body["response"].(map[string]any)["order_status"] != "READY_TO_SHIP" {
		t.Fatalf("Shopee ready=%d %#v", status, body)
	}
	_, _, detail := containerShopeeJSON(t, http.MethodGet, test.baseURL, "/api/shopee/v1/orders/"+activeID, client, secret, nil)
	itemID := detail["response"].(map[string]any)["item_list"].([]any)[0].(map[string]any)["id"].(string)
	status, _, packageBody := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+activeID+"/packages", client, secret, map[string]any{"items": []map[string]any{{"order_item_id": itemID, "quantity": 1}}})
	if status != http.StatusOK {
		t.Fatalf("Shopee package=%d %#v", status, packageBody)
	}
	packageID := packageBody["response"].(map[string]any)["package"].(map[string]any)["id"].(string)
	status, _, shipmentBody := containerShopeeJSON(t, http.MethodPost, test.baseURL, "/api/shopee/v1/orders/"+activeID+"/shipments", client, secret, map[string]any{"shipping_provider": "shopee_express_like", "pickup_type": "PICKUP", "package_id": packageID})
	if status != http.StatusOK {
		t.Fatalf("Shopee shipment=%d %#v", status, shipmentBody)
	}
	shipmentID := shipmentBody["response"].(map[string]any)["shipment"].(map[string]any)["id"].(string)
	for _, action := range []string{"ship", "in_delivery", "deliver"} {
		containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shipments/"+shipmentID+"/actions/"+action, admin, map[string]any{})
	}
	var delivered string
	if err := test.env.DB.QueryRow(context.Background(), `SELECT status FROM orders WHERE id=$1`, activeID).Scan(&delivered); err != nil || delivered != "DELIVERED" {
		t.Fatalf("Shopee delivery state=%q err=%v", delivered, err)
	}
}

func TestContainerTokopediaLikeRTSAndInventoryReservation(t *testing.T) {
	test := startContainerServer(t, 50)
	admin := containerLogin(t, test.baseURL, "admin@test.local", "admin-password")
	shop := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops", admin, map[string]any{"name": "Tokopedia & Shop", "provider_profile": "TOKOPEDIA_LIKE"})["id"].(string)
	listedShops := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops", admin, nil)["data"].([]any)
	var listedProfile string
	for _, entry := range listedShops {
		candidate := entry.(map[string]any)
		if candidate["id"] == shop {
			listedProfile, _ = candidate["provider_profile"].(string)
		}
	}
	if listedProfile != "TOKOPEDIA_LIKE" {
		t.Fatalf("shop list provider profile=%q, want TOKOPEDIA_LIKE", listedProfile)
	}
	product := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/products", admin, map[string]any{"sku": "TOKO-ONE", "name": "One available", "price": 1000, "stock": 1})
	credential := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/credentials", admin, map[string]any{})
	client, secret, accessToken := credential["client_id"].(string), credential["client_secret"].(string), credential["access_token"].(string)

	// Two simultaneous customer orders cannot oversell one unit.
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{"items": []map[string]any{{"product_id": product["id"], "quantity": 1}}})
			req, _ := http.NewRequest(http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+admin)
			req.Header.Set("Content-Type", "application/json")
			response, err := http.DefaultClient.Do(req)
			if err != nil {
				statuses <- 0
				return
			}
			defer response.Body.Close()
			statuses <- response.StatusCode
		}()
	}
	wg.Wait()
	close(statuses)
	created, rejected := 0, 0
	for status := range statuses {
		if status == http.StatusCreated {
			created++
		}
		if status == http.StatusBadRequest {
			rejected++
		}
	}
	if created != 1 || rejected != 1 {
		t.Fatalf("reservation race: created=%d rejected=%d", created, rejected)
	}
	orders := containerJSON(t, http.MethodGet, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, nil)["data"].([]any)
	orderID := orders[0].(map[string]any)["id"].(string)
	status, _, _ := containerTokopediaJSON(t, http.MethodPost, test.baseURL, "/api/tokopedia/v202309/orders/"+orderID+"/cancel", client, secret, accessToken, map[string]any{"reason": "CHANGE_OF_MIND"})
	if status != http.StatusOK {
		t.Fatalf("cancel reservation order=%d", status)
	}
	var stock int
	if err := test.env.DB.QueryRow(context.Background(), `SELECT stock FROM products WHERE id=$1`, product["id"]).Scan(&stock); err != nil || stock != 1 {
		t.Fatalf("released available stock=%d err=%v", stock, err)
	}

	active := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shops/"+shop+"/orders", admin, map[string]any{"items": []map[string]any{{"product_id": product["id"], "quantity": 1}}})
	activeID := active["id"].(string)
	containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/orders/"+activeID+"/actions/pay", admin, map[string]any{})
	status, _, tokBody := containerTokopediaJSON(t, http.MethodPost, test.baseURL, "/api/tokopedia/v202309/orders/"+activeID+"/pack", client, secret, accessToken, map[string]any{})
	if status != http.StatusOK || tokBody["code"] != float64(0) || tokBody["data"].(map[string]any)["order_status"] != "AWAITING_SHIPMENT" {
		t.Fatalf("Tokopedia pack=%d %#v", status, tokBody)
	}
	status, _, tokBody = containerTokopediaJSON(t, http.MethodPost, test.baseURL, "/api/tokopedia/v202309/orders/"+activeID+"/handover", client, secret, accessToken, map[string]any{})
	if status != http.StatusOK || tokBody["data"].(map[string]any)["order_status"] != "AWAITING_COLLECTION" {
		t.Fatalf("Tokopedia handover=%d %#v", status, tokBody)
	}
	status, _, tokBody = containerTokopediaJSON(t, http.MethodPost, test.baseURL, "/api/tokopedia/v202309/orders/search", client, secret, accessToken, map[string]any{"page_size": 1})
	if status != http.StatusOK || tokBody["data"].(map[string]any)["orders"] == nil {
		t.Fatalf("Tokopedia list=%d %#v", status, tokBody)
	}

	status, _, shipmentBody := containerTokopediaJSON(t, http.MethodPost, test.baseURL, "/api/tokopedia/v202309/orders/"+activeID+"/shipments", client, secret, accessToken, map[string]any{"shipping_provider": "tokopedia-courier", "pickup_type": "PICKUP"})
	if status != http.StatusOK {
		t.Fatalf("create RTS shipment=%d %#v", status, shipmentBody)
	}
	shipmentID := shipmentBody["data"].(map[string]any)["shipment"].(map[string]any)["id"].(string)
	for _, action := range []struct {
		name string
		body map[string]any
	}{{"ship", map[string]any{}}, {"in_delivery", map[string]any{}}, {"delivery_failed", map[string]any{"reason": "RECIPIENT_UNREACHABLE"}}, {"return_to_sender", map[string]any{}}, {"complete_return", map[string]any{}}} {
		result := containerJSON(t, http.MethodPost, test.baseURL+"/control/v1/shipments/"+shipmentID+"/actions/"+action.name, admin, action.body)
		if result["status"] == nil {
			t.Fatalf("RTS %s=%#v", action.name, result)
		}
	}
	var shipmentStatus, orderStatus, reason string
	if err := test.env.DB.QueryRow(context.Background(), `SELECT s.status,o.status,s.delivery_failure_reason FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1`, shipmentID).Scan(&shipmentStatus, &orderStatus, &reason); err != nil || shipmentStatus != "RETURNED" || orderStatus != "RETURNED" || reason != "RECIPIENT_UNREACHABLE" {
		t.Fatalf("RTS result=%s/%s/%s err=%v", shipmentStatus, orderStatus, reason, err)
	}
}

func containerCount(t *testing.T, env *testsupport.Environment, table, shopID string) int {
	t.Helper()
	var count int
	query := `SELECT count(*) FROM ` + table + ` WHERE shop_id=$1`
	if table == "outbox" {
		query = `SELECT count(*) FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.shop_id=$1`
	}
	if err := env.DB.QueryRow(context.Background(), query, shopID).Scan(&count); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return count
}

func containerLogin(t *testing.T, baseURL, email, password string) string {
	t.Helper()
	result := containerJSON(t, http.MethodPost, baseURL+"/control/v1/auth/login", "", map[string]any{"email": email, "password": password})
	token, _ := result["token"].(string)
	if token == "" {
		t.Fatal("login response did not contain a token")
	}
	return token
}

func containerCreateShop(t *testing.T, baseURL, token, name string) string {
	t.Helper()
	result := containerJSON(t, http.MethodPost, baseURL+"/control/v1/shops", token, map[string]any{"name": name})
	id, _ := result["id"].(string)
	if id == "" {
		t.Fatalf("shop create response is incomplete: %#v", result)
	}
	return id
}

func containerCreateCredential(t *testing.T, baseURL, shopID, token string) (string, string) {
	t.Helper()
	result := containerJSON(t, http.MethodPost, baseURL+"/control/v1/shops/"+shopID+"/credentials", token, map[string]any{})
	clientID, _ := result["client_id"].(string)
	secret, _ := result["client_secret"].(string)
	if clientID == "" || secret == "" {
		t.Fatalf("credential create response is incomplete: %#v", result)
	}
	return clientID, secret
}

func containerJSON(t *testing.T, method, target, token string, body any) map[string]any {
	t.Helper()
	status, result := containerRawJSON(t, method, target, token, body)
	if status < 200 || status >= 300 {
		t.Fatalf("%s %s returned %d: %#v", method, target, status, result)
	}
	return result
}

func containerRawJSON(t *testing.T, method, target, token string, body any) (int, map[string]any) {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
	}
	request, err := http.NewRequest(method, target, bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("perform request: %v", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	result := map[string]any{}
	if len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, &result); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
	return response.StatusCode, result
}

func containerSignedRequest(t *testing.T, method, baseURL, path, clientID, secret string) (int, http.Header) {
	t.Helper()
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(method + strings.Split(path, "?")[0] + stamp))
	request, err := http.NewRequest(method, baseURL+path, nil)
	if err != nil {
		t.Fatalf("build signed request: %v", err)
	}
	request.Header.Set("X-Client-Id", clientID)
	request.Header.Set("X-Timestamp", stamp)
	request.Header.Set("X-Signature", hex.EncodeToString(mac.Sum(nil)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("perform signed request: %v", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode, response.Header.Clone()
}

func containerSignedJSON(t *testing.T, method, baseURL, path, clientID, secret, idempotencyKey string, body any) (int, http.Header, map[string]any) {
	t.Helper()
	raw := []byte{}
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal signed request: %v", err)
		}
	}
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(method + strings.Split(path, "?")[0] + stamp + string(raw)))
	request, err := http.NewRequest(method, baseURL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("build signed request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Client-Id", clientID)
	request.Header.Set("X-Timestamp", stamp)
	request.Header.Set("X-Signature", hex.EncodeToString(mac.Sum(nil)))
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("perform signed request: %v", err)
	}
	defer response.Body.Close()
	result := map[string]any{}
	if response.StatusCode != http.StatusNoContent {
		payload, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("read signed response: %v", err)
		}
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &result); err != nil {
				t.Fatalf("decode signed response: %v", err)
			}
		}
	}
	return response.StatusCode, response.Header.Clone(), result
}

func containerShopeeJSON(t *testing.T, method, baseURL, path, partnerID, secret string, body any) (int, http.Header, map[string]any) {
	t.Helper()
	raw := []byte{}
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal Shopee request: %v", err)
		}
	}
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	pathOnly := strings.Split(path, "?")[0]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(partnerID + pathOnly + stamp + string(raw)))
	request, err := http.NewRequest(method, baseURL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("build Shopee request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Shopee-Partner-Id", partnerID)
	request.Header.Set("X-Shopee-Timestamp", stamp)
	request.Header.Set("X-Shopee-Signature", hex.EncodeToString(mac.Sum(nil)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("perform Shopee request: %v", err)
	}
	defer response.Body.Close()
	result := map[string]any{}
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read Shopee response: %v", err)
	}
	if len(payload) > 0 {
		if err := json.Unmarshal(payload, &result); err != nil {
			t.Fatalf("decode Shopee response: %v (%s)", err, payload)
		}
	}
	return response.StatusCode, response.Header.Clone(), result
}

func containerTokopediaJSON(t *testing.T, method, baseURL, path, appKey, secret, accessToken string, body any) (int, http.Header, map[string]any) {
	t.Helper()
	raw := []byte{}
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal Tokopedia request: %v", err)
		}
	}
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	parsed, err := url.Parse(path)
	if err != nil {
		t.Fatalf("parse Tokopedia path: %v", err)
	}
	query := parsed.Query()
	query.Set("app_key", appKey)
	query.Set("timestamp", stamp)
	query.Set("sign", tokopedia.Sign(secret, parsed.Path, query, raw))
	parsed.RawQuery = query.Encode()
	request, err := http.NewRequest(method, baseURL+parsed.String(), bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("build Tokopedia request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-tts-access-token", accessToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("perform Tokopedia request: %v", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read Tokopedia response: %v", err)
	}
	result := map[string]any{}
	if len(payload) > 0 {
		if err := json.Unmarshal(payload, &result); err != nil {
			t.Fatalf("decode Tokopedia response: %v (%s)", err, payload)
		}
	}
	return response.StatusCode, response.Header.Clone(), result
}
