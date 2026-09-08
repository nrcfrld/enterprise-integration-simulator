//go:build testcontainers

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/testsupport"
	"github.com/hibiken/asynq"
)

func TestContainerAttemptDiagnostics(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	if err := platform.RunMigrations(ctx, env.DB, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	cfg := platform.Config{EncryptionKey: []byte("01234567890123456789012345678901")}
	cipher, err := platform.Encrypt(cfg.EncryptionKey, "snapshot-secret")
	if err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := env.DB.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,email,password_hash,role) VALUES('usr_snap','snap@test.local','unused','ADMIN')`)
	for _, profile := range []string{"SHOPEE_LIKE", "TOKOPEDIA_LIKE"} {
		t.Run(profile, func(t *testing.T) {
			shop, hook, event, delivery := "shop_"+profile, "wh_"+profile, "evt_"+profile, "del_"+profile
			bodies := make(chan []byte, 4)
			receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, readErr := io.ReadAll(r.Body)
				if readErr != nil {
					t.Error(readErr)
				}
				bodies <- raw
				w.Header().Set("X-Diagnostic", "receiver-evidence")
				w.WriteHeader(503)
				_, _ = w.Write([]byte(strings.Repeat("x", 5000)))
			}))
			defer receiver.Close()
			exec(`INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES($1,'usr_snap','Snapshots',$2)`, shop, profile)
			exec(`INSERT INTO credentials(id,shop_id,client_id,secret_ciphertext) VALUES($1,$2,$3,$4)`, "cred_"+profile, shop, "client_"+profile, cipher)
			exec(`INSERT INTO shop_scenarios(shop_id) VALUES($1)`, shop)
			exec(`INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,'["order.paid"]')`, hook, shop, receiver.URL, cipher)
			exec(`INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES($1,$2,'order.paid','ord_snap','{"status":"PAID","note":"évidence"}')`, event, shop)
			exec(`INSERT INTO webhook_deliveries(id,webhook_id,event_id,leased_until) VALUES($1,$2,$3,now()+interval '30 seconds')`, delivery, hook, event)
			worker := &worker{db: env.DB, cfg: cfg, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), http: receiver.Client()}
			rawTask, _ := json.Marshal(deliveryPayload{DeliveryID: delivery})
			task := asynq.NewTask(deliveryTask, rawTask)
			if err := worker.handleDelivery(ctx, task); err != nil {
				t.Fatal(err)
			}
			sent := <-bodies
			var raw, url, failure, reason, response string
			var headers, responseHeaders []byte
			var started time.Time
			var attempted, truncated bool
			var clientID *string
			if err := env.DB.QueryRow(ctx, `SELECT request_body,request_url,request_headers,signing_client_id,started_at,http_attempted,failure_code,failure_reason,response_body,response_headers,response_body_truncated FROM webhook_delivery_attempts WHERE delivery_id=$1 AND attempt=1`, delivery).Scan(&raw, &url, &headers, &clientID, &started, &attempted, &failure, &reason, &response, &responseHeaders, &truncated); err != nil {
				t.Fatal(err)
			}
			if raw != string(sent) || url != receiver.URL || !attempted || failure != "HTTP_STATUS" || !strings.Contains(reason, "503") || len(response) != 4096 || !truncated || started.IsZero() || !strings.Contains(string(responseHeaders), "receiver-evidence") {
				t.Fatalf("inaccurate snapshot: raw=%s url=%s code=%s reason=%s", raw, url, failure, reason)
			}
			var h map[string]string
			if err := json.Unmarshal(headers, &h); err != nil {
				t.Fatal(err)
			}
			input, signature := h["X-Shopee-Event"]+h["X-Shopee-Timestamp"]+raw, h["X-Shopee-Signature"]
			if profile == "TOKOPEDIA_LIKE" {
				if clientID == nil || *clientID != "client_"+profile {
					t.Fatal("missing signing identity")
				}
				input, signature = *clientID+raw, h["Authorization"]
			}
			mac := hmac.New(sha256.New, []byte("snapshot-secret"))
			mac.Write([]byte(input))
			if hex.EncodeToString(mac.Sum(nil)) != signature {
				t.Fatal("stored exact bytes cannot verify signature")
			}
			if strings.Contains(string(headers), "snapshot-secret") {
				t.Fatal("secret leaked")
			}
			// Later configuration and retry cannot rewrite the original evidence.
			exec(`UPDATE webhooks SET url='http://127.0.0.1:1/unreachable' WHERE id=$1`, hook)
			exec(`UPDATE webhook_deliveries SET leased_until=now()+interval '30 seconds' WHERE id=$1`, delivery)
			if err := worker.handleDelivery(ctx, task); err != nil {
				t.Fatal(err)
			}
			if err := env.DB.QueryRow(ctx, `SELECT failure_code,failure_reason FROM webhook_delivery_attempts WHERE delivery_id=$1 AND attempt=2`, delivery).Scan(&failure, &reason); err != nil {
				t.Fatal(err)
			}
			if failure != "NETWORK_ERROR" || reason == "" {
				t.Fatalf("network diagnosis=%s %s", failure, reason)
			}
			var original string
			if err := env.DB.QueryRow(ctx, `SELECT request_url FROM webhook_delivery_attempts WHERE delivery_id=$1 AND attempt=1`, delivery).Scan(&original); err != nil || original != receiver.URL {
				t.Fatalf("rewrote original snapshot: %s %v", original, err)
			}
			exec(`UPDATE shop_scenarios SET webhook_force_failure=true WHERE shop_id=$1`, shop)
			exec(`UPDATE webhook_deliveries SET leased_until=now()+interval '30 seconds' WHERE id=$1`, delivery)
			if err := worker.handleDelivery(ctx, task); err != nil {
				t.Fatal(err)
			}
			if err := env.DB.QueryRow(ctx, `SELECT failure_code,http_attempted FROM webhook_delivery_attempts WHERE delivery_id=$1 AND attempt=3`, delivery).Scan(&failure, &attempted); err != nil {
				t.Fatal(err)
			}
			if failure != "FORCED_FAILURE" || attempted {
				t.Fatal("forced failure pretends it sent HTTP")
			}
			if profile == "TOKOPEDIA_LIKE" {
				exec(`UPDATE credentials SET status='REVOKED' WHERE shop_id=$1`, shop)
				exec(`UPDATE webhook_deliveries SET leased_until=now()+interval '30 seconds' WHERE id=$1`, delivery)
				if err := worker.handleDelivery(ctx, task); err != nil {
					t.Fatal(err)
				}
				var snapshot *string
				if err := env.DB.QueryRow(ctx, `SELECT failure_code,http_attempted,request_body FROM webhook_delivery_attempts WHERE delivery_id=$1 AND attempt=4`, delivery).Scan(&failure, &attempted, &snapshot); err != nil {
					t.Fatal(err)
				}
				if failure != "SIGNING_ERROR" || attempted || snapshot != nil {
					t.Fatal("missing credential must record preflight failure")
				}
			}
		})
	}
}
