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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/testsupport"
	"github.com/hibiken/asynq"
)

func TestContainerWorkerPublishesOutboxAndRetriesWebhook(t *testing.T) {
	env := testsupport.Start(t)
	if err := platform.RunMigrations(context.Background(), env.DB, "../../migrations"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	if err := env.Redis.Ping(context.Background()).Err(); err != nil {
		t.Fatalf("ping test Redis: %v", err)
	}
	var calls atomic.Int32
	receiver := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if calls.Add(1) == 1 {
			http.Error(writer, "retry", http.StatusInternalServerError)
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()

	cfg := platform.Config{EncryptionKey: []byte("01234567890123456789012345678901")}
	secret, err := platform.Encrypt(cfg.EncryptionKey, "webhook-test-secret")
	if err != nil {
		t.Fatalf("encrypt webhook secret: %v", err)
	}
	ctx := context.Background()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')`, []any{"usr_worker", "worker@test.local", "unused"}},
		{`INSERT INTO shops(id,owner_user_id,name) VALUES($1,$2,$3)`, []any{"shop_worker", "usr_worker", "Worker shop"}},
		{`INSERT INTO shop_scenarios(shop_id) VALUES($1)`, []any{"shop_worker"}},
		{`INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,enabled,subscribed_events) VALUES($1,$2,$3,$4,true,$5)`, []any{"wh_worker", "shop_worker", receiver.URL, secret, []byte(`["order.created"]`)}},
		{`INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)`, []any{"evt_worker", "shop_worker", "order.created", "ord_worker", []byte(`{"id":"ord_worker"}`)}},
		{`INSERT INTO outbox(id,event_id) VALUES($1,$2)`, []any{"out_worker", "evt_worker"}},
	} {
		if _, err := env.DB.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed worker test data: %v", err)
		}
	}

	redisOptions, err := asynq.ParseRedisURI(env.RedisURL)
	if err != nil {
		t.Fatalf("parse Testcontainers Redis URL: %v", err)
	}
	asynqClient := asynq.NewClient(redisOptions)
	t.Cleanup(func() {
		if err := asynqClient.Close(); err != nil {
			t.Errorf("close test Asynq client: %v", err)
		}
	})
	w := &worker{db: env.DB, cfg: cfg, client: asynqClient, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), http: receiver.Client()}
	if err := w.publishOutbox(ctx); err != nil {
		t.Fatalf("publish outbox: %v", err)
	}
	if err := w.scheduleDeliveries(ctx); err != nil {
		t.Fatalf("schedule initial delivery through Redis: %v", err)
	}
	var deliveryID string
	var publishedAt *time.Time
	if err := env.DB.QueryRow(ctx, `SELECT d.id,o.published_at FROM webhook_deliveries d JOIN outbox o ON o.event_id=d.event_id WHERE d.event_id='evt_worker'`).Scan(&deliveryID, &publishedAt); err != nil {
		t.Fatalf("read published delivery: %v", err)
	}
	if publishedAt == nil {
		t.Fatal("outbox was not marked as published")
	}
	payload, _ := json.Marshal(deliveryPayload{DeliveryID: deliveryID})
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
		t.Fatalf("first webhook attempt: %v", err)
	}
	var status string
	var attempts int
	var retryAt time.Time
	if err := env.DB.QueryRow(ctx, `SELECT status,attempt_count,next_attempt_at FROM webhook_deliveries WHERE id=$1`, deliveryID).Scan(&status, &attempts, &retryAt); err != nil {
		t.Fatalf("read failed delivery: %v", err)
	}
	if status != "PENDING" || attempts != 1 || retryAt.Before(time.Now().Add(25*time.Second)) {
		t.Fatalf("retry was not scheduled correctly: status=%s attempts=%d retry_at=%s", status, attempts, retryAt)
	}

	if _, err := env.DB.Exec(ctx, `UPDATE webhook_deliveries SET next_attempt_at=now(),leased_until=NULL WHERE id=$1`, deliveryID); err != nil {
		t.Fatalf("make retry eligible: %v", err)
	}
	if err := w.scheduleDeliveries(ctx); err != nil {
		t.Fatalf("schedule retry through Redis: %v", err)
	}
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
		t.Fatalf("retry webhook attempt: %v", err)
	}
	if err := env.DB.QueryRow(ctx, `SELECT status,attempt_count FROM webhook_deliveries WHERE id=$1`, deliveryID).Scan(&status, &attempts); err != nil {
		t.Fatalf("read successful delivery: %v", err)
	}
	if status != "DELIVERED" || attempts != 2 || calls.Load() != 2 {
		t.Fatalf("delivery retry result: status=%s attempts=%d calls=%d", status, attempts, calls.Load())
	}
	var attemptRows int
	if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM webhook_delivery_attempts WHERE delivery_id=$1`, deliveryID).Scan(&attemptRows); err != nil {
		t.Fatalf("count immutable attempts: %v", err)
	}
	if attemptRows != 2 {
		t.Fatalf("attempt rows = %d, want 2", attemptRows)
	}

	if _, err := env.DB.Exec(ctx, `UPDATE shop_scenarios SET webhook_out_of_order=true WHERE shop_id='shop_worker'`); err != nil {
		t.Fatalf("enable out-of-order scenario: %v", err)
	}
	if _, err := env.DB.Exec(ctx, `UPDATE webhooks SET subscribed_events=$1 WHERE id='wh_worker'`, []byte(`["order.created","order.paid"]`)); err != nil {
		t.Fatalf("subscribe webhook to payment event: %v", err)
	}
	if _, err := env.DB.Exec(ctx, `INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES('evt_paid','shop_worker','order.paid','ord_worker','{}')`); err != nil {
		t.Fatalf("insert payment event: %v", err)
	}
	if _, err := env.DB.Exec(ctx, `INSERT INTO outbox(id,event_id) VALUES('out_paid','evt_paid')`); err != nil {
		t.Fatalf("insert payment outbox: %v", err)
	}
	if err := w.publishOutbox(ctx); err != nil {
		t.Fatalf("publish out-of-order event: %v", err)
	}
	var delayedAt time.Time
	if err := env.DB.QueryRow(ctx, `SELECT next_attempt_at FROM webhook_deliveries WHERE event_id='evt_paid'`).Scan(&delayedAt); err != nil {
		t.Fatalf("read out-of-order delivery: %v", err)
	}
	if delayedAt.Before(time.Now().Add(9 * time.Second)) {
		t.Fatalf("out-of-order delivery was not delayed: %s", delayedAt)
	}

	if _, err := env.DB.Exec(ctx, `UPDATE shop_scenarios SET webhook_duplicate=true,webhook_delay_seconds=2,webhook_force_failure=true WHERE shop_id='shop_worker'`); err != nil {
		t.Fatalf("enable duplicate, delay, and failure scenarios: %v", err)
	}
	if _, err := env.DB.Exec(ctx, `INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES('evt_forced_failure','shop_worker','order.created','ord_worker','{}')`); err != nil {
		t.Fatalf("insert scenario event: %v", err)
	}
	if _, err := env.DB.Exec(ctx, `INSERT INTO outbox(id,event_id) VALUES('out_forced_failure','evt_forced_failure')`); err != nil {
		t.Fatalf("insert scenario outbox: %v", err)
	}
	if err := w.publishOutbox(ctx); err != nil {
		t.Fatalf("publish duplicate/delayed scenario event: %v", err)
	}
	var delayedCopies int
	if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries WHERE event_id='evt_forced_failure' AND next_attempt_at>=now()+interval '1 second'`).Scan(&delayedCopies); err != nil {
		t.Fatalf("count delayed duplicate deliveries: %v", err)
	}
	if delayedCopies != 2 {
		t.Fatalf("duplicate scenario deliveries = %d, want 2", delayedCopies)
	}
	var forcedDeliveryID string
	if err := env.DB.QueryRow(ctx, `SELECT id FROM webhook_deliveries WHERE event_id='evt_forced_failure' ORDER BY id LIMIT 1`).Scan(&forcedDeliveryID); err != nil {
		t.Fatalf("read forced-failure delivery: %v", err)
	}
	if _, err := env.DB.Exec(ctx, `UPDATE webhook_deliveries SET next_attempt_at=now(),leased_until=now()+interval '30 seconds' WHERE id=$1`, forcedDeliveryID); err != nil {
		t.Fatalf("make forced-failure delivery eligible: %v", err)
	}
	forcedPayload, _ := json.Marshal(deliveryPayload{DeliveryID: forcedDeliveryID})
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, forcedPayload)); err != nil {
		t.Fatalf("record forced webhook failure: %v", err)
	}
	var forcedStatus string
	if err := env.DB.QueryRow(ctx, `SELECT status FROM webhook_delivery_attempts WHERE delivery_id=$1 AND attempt=1`, forcedDeliveryID).Scan(&forcedStatus); err != nil {
		t.Fatalf("read forced-failure attempt: %v", err)
	}
	if forcedStatus != "FAILURE" {
		t.Fatalf("forced failure attempt status = %s, want FAILURE", forcedStatus)
	}
}

func TestContainerWorkerEnforcesPaymentExpiryAndSellerSLA(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	if err := platform.RunMigrations(ctx, env.DB, "../../migrations"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users(id,email,password_hash,role) VALUES('usr_deadline','deadline@test.local','unused','ADMIN')`, nil},
		{`INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES('shop_deadline','usr_deadline','Deadline shop','SHOPEE_LIKE')`, nil},
		{`INSERT INTO warehouses(id,shop_id,code,name) VALUES('wh_deadline','shop_deadline','WH-DEFAULT','Deadline warehouse')`, nil},
		{`INSERT INTO products(id,shop_id,sku,name,category,description,price,stock,status) VALUES('prd_deadline','shop_deadline','DEADLINE-1','Deadline inventory','Test','',1,1,'ACTIVE')`, nil},
		{`INSERT INTO warehouse_inventory(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES('wh_deadline','prd_deadline',2,1)`, nil},
		{`INSERT INTO orders(id,order_number,shop_id,fulfillment_warehouse_id,customer_data,shipping_address,total_amount,status,payment_status,payment_expires_at) VALUES('ord_payment_expired','PAY-EXPIRED','shop_deadline','wh_deadline','{}','{}',1,'UNPAID','PENDING',now()-interval '1 second')`, nil},
		{`INSERT INTO order_items(id,order_id,product_id,sku,product_name,price,quantity,subtotal) VALUES('item_deadline','ord_payment_expired','prd_deadline','DEADLINE-1','Deadline inventory',1,1,1)`, nil},
		{`INSERT INTO inventory_reservations(id,order_id,order_item_id,product_id,warehouse_id,quantity) VALUES('res_deadline','ord_payment_expired','item_deadline','prd_deadline','wh_deadline',1)`, nil},
		{`INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status,seller_deadline_at) VALUES('ord_sla_expired','SLA-EXPIRED','shop_deadline','{}','{}',1,'PROCESSING','PAID',now()-interval '1 second')`, nil},
	} {
		if _, err := env.DB.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed deadline order: %v", err)
		}
	}
	w := &worker{
		db: env.DB,
		cfg: platform.Config{
			DeadlineBatchSize:   1,
			DeadlineConcurrency: 2,
			DeadlineLease:       time.Second,
		},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := w.enforceOrderDeadlines(ctx); err != nil {
		t.Fatalf("enforce deadlines: %v", err)
	}
	for _, want := range []struct{ id, payment, reason, event string }{
		{"ord_payment_expired", "EXPIRED", "PAYMENT_EXPIRED", "order.payment_expired"},
		{"ord_sla_expired", "PAID", "SELLER_SLA_EXPIRED", "order.sla_expired"},
	} {
		var status, payment, reason string
		if err := env.DB.QueryRow(ctx, `SELECT status,payment_status,cancellation_reason FROM orders WHERE id=$1`, want.id).Scan(&status, &payment, &reason); err != nil {
			t.Fatalf("read %s: %v", want.id, err)
		}
		if status != "CANCELLED" || payment != want.payment || reason != want.reason {
			t.Fatalf("deadline state for %s = %s/%s/%s", want.id, status, payment, reason)
		}
		var events int
		if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM domain_events WHERE aggregate_id=$1 AND event_type=$2`, want.id, want.event).Scan(&events); err != nil || events != 1 {
			t.Fatalf("deadline event for %s = %d err=%v", want.id, events, err)
		}
	}
	var onHand, reserved, stock int
	if err := env.DB.QueryRow(ctx, `SELECT i.on_hand_quantity,i.reserved_quantity,p.stock FROM warehouse_inventory i JOIN products p ON p.id=i.product_id WHERE i.warehouse_id='wh_deadline' AND i.product_id='prd_deadline'`).Scan(&onHand, &reserved, &stock); err != nil {
		t.Fatalf("read released deadline inventory: %v", err)
	}
	if onHand != 2 || reserved != 0 || stock != 2 {
		t.Fatalf("deadline release inventory = on_hand=%d reserved=%d stock=%d, want 2/0/2", onHand, reserved, stock)
	}
}

func TestContainerDeadlineClaimsAreExclusiveAndRetryAfterLease(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	if err := platform.RunMigrations(ctx, env.DB, "../../migrations"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	var indexDefinition string
	if err := env.DB.QueryRow(ctx, `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='orders_payment_expiry_idx'`).Scan(&indexDefinition); err != nil {
		t.Fatalf("read payment-expiry index: %v", err)
	}
	if !strings.Contains(indexDefinition, "(payment_expires_at, id)") || !strings.Contains(indexDefinition, "payment_status = 'PENDING'") {
		t.Fatalf("payment-expiry polling index does not cover the claim query: %s", indexDefinition)
	}
	for _, query := range []string{
		`INSERT INTO users(id,email,password_hash,role) VALUES('usr_claims','claims@test.local','unused','ADMIN')`,
		`INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES('shop_claims','usr_claims','Claims shop','SHOPEE_LIKE')`,
		`INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status,payment_expires_at)
		 SELECT 'ord_claim_'||value,'CLAIM-'||value,'shop_claims','{}','{}',1,'UNPAID','PENDING',now()-interval '1 minute'
		 FROM generate_series(1,3) AS value`,
	} {
		if _, err := env.DB.Exec(ctx, query); err != nil {
			t.Fatalf("seed deadline claims: %v", err)
		}
	}

	config := platform.Config{DeadlineBatchSize: 2, DeadlineLease: 100 * time.Millisecond}
	workers := []*worker{{db: env.DB, cfg: config}, {db: env.DB, cfg: config}}
	type result struct {
		candidates []deadlineCandidate
		err        error
	}
	results := make(chan result, len(workers))
	start := make(chan struct{})
	var group sync.WaitGroup
	for _, current := range workers {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			candidates, err := current.claimDeadlineBatch(ctx, deadlineRules[0])
			results <- result{candidates: candidates, err: err}
		}()
	}
	close(start)
	group.Wait()
	close(results)

	claimed := map[string]bool{}
	for claim := range results {
		if claim.err != nil {
			t.Fatalf("claim deadline batch: %v", claim.err)
		}
		if len(claim.candidates) == 0 {
			t.Fatal("a worker replica did not receive a disjoint claim")
		}
		for _, candidate := range claim.candidates {
			if claimed[candidate.id] {
				t.Fatalf("order %s was claimed by more than one replica", candidate.id)
			}
			claimed[candidate.id] = true
		}
	}
	if len(claimed) != 3 {
		t.Fatalf("claimed %d orders, want 3", len(claimed))
	}
	if candidates, err := workers[0].claimDeadlineBatch(ctx, deadlineRules[0]); err != nil || len(candidates) != 0 {
		t.Fatalf("active lease was reclaimed: candidates=%v err=%v", candidates, err)
	}

	time.Sleep(120 * time.Millisecond)
	reclaimed, err := workers[0].claimDeadlineBatch(ctx, deadlineRules[0])
	if err != nil {
		t.Fatalf("reclaim expired deadline lease: %v", err)
	}
	if len(reclaimed) != 2 {
		t.Fatalf("reclaimed %d orders, want batch size 2", len(reclaimed))
	}
}

func TestContainerDeadlineWorkerDrainsBacklogAcrossBatches(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	if err := platform.RunMigrations(ctx, env.DB, "../../migrations"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	for _, query := range []string{
		`INSERT INTO users(id,email,password_hash,role) VALUES('usr_backlog','backlog@test.local','unused','ADMIN')`,
		`INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES('shop_backlog','usr_backlog','Backlog shop','SHOPEE_LIKE')`,
		`INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status,payment_expires_at)
		 SELECT 'ord_backlog_'||value,'BACKLOG-'||value,'shop_backlog','{}','{}',1,'UNPAID','PENDING',now()-interval '1 minute'
		 FROM generate_series(1,250) AS value`,
	} {
		if _, err := env.DB.Exec(ctx, query); err != nil {
			t.Fatalf("seed deadline backlog: %v", err)
		}
	}

	w := &worker{
		db: env.DB,
		cfg: platform.Config{
			DeadlineBatchSize:   17,
			DeadlineConcurrency: 6,
			DeadlineLease:       time.Second,
		},
	}
	if err := w.enforceOrderDeadlines(ctx); err != nil {
		t.Fatalf("drain deadline backlog: %v", err)
	}

	var cancelled, expirationEvents, cancellationEvents int
	if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM orders WHERE shop_id='shop_backlog' AND status='CANCELLED' AND payment_status='EXPIRED' AND cancellation_reason='PAYMENT_EXPIRED'`).Scan(&cancelled); err != nil {
		t.Fatalf("count expired backlog orders: %v", err)
	}
	if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM domain_events WHERE shop_id='shop_backlog' AND event_type='order.payment_expired'`).Scan(&expirationEvents); err != nil {
		t.Fatalf("count expiration events: %v", err)
	}
	if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM domain_events WHERE shop_id='shop_backlog' AND event_type='order.cancelled'`).Scan(&cancellationEvents); err != nil {
		t.Fatalf("count cancellation events: %v", err)
	}
	if cancelled != 250 || expirationEvents != 250 || cancellationEvents != 250 {
		t.Fatalf("backlog result cancelled=%d expiration_events=%d cancellation_events=%d", cancelled, expirationEvents, cancellationEvents)
	}
}

func TestContainerWorkerDeliversShopeeLikeWebhookContract(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	if err := platform.RunMigrations(ctx, env.DB, "../../migrations"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	var gotHeaders http.Header
	var gotBody map[string]any
	var rawBody []byte
	var cancelInFlight atomic.Bool
	receiver := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotHeaders = request.Header.Clone()
		rawBody, _ = io.ReadAll(request.Body)
		if cancelInFlight.Load() {
			if _, err := env.DB.Exec(ctx, `UPDATE webhooks SET deleted_at=now(),enabled=false WHERE id='wh_shopee_hook'`); err != nil {
				t.Error(err)
			}
			if _, err := env.DB.Exec(ctx, `UPDATE webhook_deliveries SET status='CANCELLED',next_attempt_at=NULL,leased_until=NULL WHERE id='del_shopee_hook'`); err != nil {
				t.Error(err)
			}
		}
		if err := json.Unmarshal(rawBody, &gotBody); err != nil {
			t.Errorf("decode Shopee webhook: %v", err)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	cfg := platform.Config{EncryptionKey: []byte("01234567890123456789012345678901")}
	secret, err := platform.Encrypt(cfg.EncryptionKey, "shopee-webhook-secret")
	if err != nil {
		t.Fatalf("encrypt secret: %v", err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users(id,email,password_hash,role) VALUES('usr_shopee_hook','hook@test.local','unused','ADMIN')`, nil},
		{`INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES('shop_shopee_hook','usr_shopee_hook','Shopee hook','SHOPEE_LIKE')`, nil},
		{`INSERT INTO shop_scenarios(shop_id) VALUES('shop_shopee_hook')`, nil},
		{`INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,enabled,subscribed_events) VALUES('wh_shopee_hook','shop_shopee_hook',$1,$2,true,$3)`, []any{receiver.URL, secret, []byte(`["order.paid"]`)}},
		{`INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES('evt_shopee_paid','shop_shopee_hook','order.paid','ord_shopee', '{"id":"ord_shopee","status":"PAID"}')`, nil},
		{`INSERT INTO webhook_deliveries(id,webhook_id,event_id,leased_until) VALUES('del_shopee_hook','wh_shopee_hook','evt_shopee_paid',now()+interval '30 seconds')`, nil},
	} {
		if _, err := env.DB.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed Shopee webhook: %v", err)
		}
	}
	w := &worker{db: env.DB, cfg: cfg, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), http: receiver.Client()}
	payload, _ := json.Marshal(deliveryPayload{DeliveryID: "del_shopee_hook"})
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
		t.Fatalf("deliver Shopee webhook: %v", err)
	}
	if gotHeaders.Get("X-Shopee-Event") != "order_status_update" || gotHeaders.Get("X-Shopee-Signature") == "" || gotHeaders.Get("X-Marketplace-Event") != "" {
		t.Fatalf("Shopee webhook headers = %#v", gotHeaders)
	}
	if gotBody["code"] != float64(0) || gotBody["response"].(map[string]any)["event_type"] != "order_status_update" {
		t.Fatalf("Shopee webhook body = %#v", gotBody)
	}
	mac := hmac.New(sha256.New, []byte("shopee-webhook-secret"))
	mac.Write([]byte(gotHeaders.Get("X-Shopee-Event") + gotHeaders.Get("X-Shopee-Timestamp") + string(rawBody)))
	if gotHeaders.Get("X-Shopee-Signature") != hex.EncodeToString(mac.Sum(nil)) || gotHeaders.Get("X-Shopee-Event-Id") != gotBody["request_id"] {
		t.Fatal("receiver cannot verify actual Shopee bytes/identity")
	}
	// Simulate deletion while the second HTTP attempt is already in flight.
	cancelInFlight.Store(true)
	if _, err := env.DB.Exec(ctx, `UPDATE webhook_deliveries SET status='PENDING',leased_until=now()+interval '30 seconds' WHERE id='del_shopee_hook'`); err != nil {
		t.Fatal(err)
	}
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
		t.Fatal(err)
	}
	var state string
	var count int
	if err := env.DB.QueryRow(ctx, `SELECT status,attempt_count FROM webhook_deliveries WHERE id='del_shopee_hook'`).Scan(&state, &count); err != nil || state != "CANCELLED" || count != 2 {
		t.Fatalf("in-flight result resurrected delivery: %s %d %v", state, count, err)
	}
	if _, err := env.DB.Exec(ctx, `INSERT INTO outbox(id,event_id) VALUES('out_deleted','evt_shopee_paid')`); err != nil {
		t.Fatal(err)
	}
	if err := w.publishOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
		t.Fatal(err)
	}
	if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM webhook_deliveries WHERE webhook_id='wh_shopee_hook'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("fanout delivered to deleted hook: %d %v", count, err)
	}
	if err := env.DB.QueryRow(ctx, `SELECT count(*) FROM webhook_delivery_attempts WHERE delivery_id='del_shopee_hook'`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("deleted hook attempted again or lost history: %d %v", count, err)
	}

}

func TestContainerWorkerDeliversTokopediaLikeWebhookContract(t *testing.T) {
	env := testsupport.Start(t)
	ctx := context.Background()
	if err := platform.RunMigrations(ctx, env.DB, "../../migrations"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	var headers http.Header
	var body map[string]any
	var rawBody []byte
	receiver := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		headers = request.Header.Clone()
		rawBody, _ = io.ReadAll(request.Body)
		if err := json.Unmarshal(rawBody, &body); err != nil {
			t.Errorf("decode Tokopedia webhook: %v", err)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	cfg := platform.Config{EncryptionKey: []byte("01234567890123456789012345678901")}
	webhookSecret, err := platform.Encrypt(cfg.EncryptionKey, "registration-secret")
	if err != nil {
		t.Fatal(err)
	}
	appSecret, err := platform.Encrypt(cfg.EncryptionKey, "tokopedia-app-secret")
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users(id,email,password_hash,role) VALUES('usr_toko_hook','toko-hook@test.local','unused','ADMIN')`, nil},
		{`INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES('shop_toko_hook','usr_toko_hook','Tokopedia hook','TOKOPEDIA_LIKE')`, nil},
		{`INSERT INTO shop_scenarios(shop_id) VALUES('shop_toko_hook')`, nil},
		{`INSERT INTO credentials(id,shop_id,client_id,secret_ciphertext,status) VALUES('cred_toko_hook','shop_toko_hook','toko-app-key',$1,'ACTIVE')`, []any{appSecret}},
		{`INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,enabled,subscribed_events) VALUES('wh_toko_hook','shop_toko_hook',$1,$2,true,$3)`, []any{receiver.URL, webhookSecret, []byte(`["order.paid"]`)}},
		{`INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES('evt_toko_paid','shop_toko_hook','order.paid','ord_toko', '{"order_id":"ord_toko","status":"PAID"}')`, nil},
		{`INSERT INTO webhook_deliveries(id,webhook_id,event_id,leased_until) VALUES('del_toko_hook','wh_toko_hook','evt_toko_paid',now()+interval '30 seconds')`, nil},
	} {
		if _, err := env.DB.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed Tokopedia webhook: %v", err)
		}
	}
	w := &worker{db: env.DB, cfg: cfg, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), http: receiver.Client()}
	payload, _ := json.Marshal(deliveryPayload{DeliveryID: "del_toko_hook"})
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
		t.Fatalf("deliver Tokopedia webhook: %v", err)
	}
	if headers.Get("Authorization") == "" || headers.Get("X-Marketplace-Event") != "" || body["type"] != float64(1) || body["tts_notification_id"] != "evt_toko_paid" {
		t.Fatalf("Tokopedia webhook=%#v %#v", headers, body)
	}
	verify := func(key, secret string) string {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(key + string(rawBody)))
		return hex.EncodeToString(mac.Sum(nil))
	}
	if headers.Get("Authorization") != verify("toko-app-key", "tokopedia-app-secret") || headers.Get("Authorization") == verify("toko-app-key", "registration-secret") {
		t.Fatal("wrong Tokopedia verification key/input")
	}
	newerSecret, err := platform.Encrypt(cfg.EncryptionKey, "newer-app-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.DB.Exec(ctx, `INSERT INTO credentials(id,shop_id,client_id,secret_ciphertext,status,created_at) VALUES('cred_newer','shop_toko_hook','newer-app-key',$1,'ACTIVE',now()+interval '1 second')`, newerSecret); err != nil {
		t.Fatal(err)
	}
	redeliver := func() {
		t.Helper()
		if _, err := env.DB.Exec(ctx, `UPDATE webhook_deliveries SET status='PENDING',leased_until=now()+interval '30 seconds' WHERE id='del_toko_hook'`); err != nil {
			t.Fatal(err)
		}
		if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
			t.Fatal(err)
		}
	}
	redeliver()
	if headers.Get("Authorization") != verify("toko-app-key", "tokopedia-app-secret") {
		t.Fatal("new credential unexpectedly rotated webhook key")
	}
	if _, err := env.DB.Exec(ctx, `UPDATE credentials SET status='REVOKED' WHERE id='cred_toko_hook'`); err != nil {
		t.Fatal(err)
	}
	redeliver()
	if headers.Get("Authorization") != verify("newer-app-key", "newer-app-secret") {
		t.Fatal("revocation did not select next active credential")
	}
	if _, err := env.DB.Exec(ctx, `UPDATE credentials SET status='REVOKED' WHERE id='cred_newer'`); err != nil {
		t.Fatal(err)
	}
	if _, err := env.DB.Exec(ctx, `UPDATE webhook_deliveries SET status='PENDING',leased_until=now()+interval '30 seconds' WHERE id='del_toko_hook'`); err != nil {
		t.Fatal(err)
	}
	if err := w.handleDelivery(ctx, asynq.NewTask(deliveryTask, payload)); err != nil {
		t.Fatalf("record missing credential: %v", err)
	}
	var code string
	var attempted bool
	if err := env.DB.QueryRow(ctx, `SELECT failure_code,http_attempted FROM webhook_delivery_attempts WHERE delivery_id='del_toko_hook' ORDER BY attempt DESC LIMIT 1`).Scan(&code, &attempted); err != nil || code != "SIGNING_ERROR" || attempted {
		t.Fatalf("missing credential diagnostic: %s %t %v", code, attempted, err)
	}

}
