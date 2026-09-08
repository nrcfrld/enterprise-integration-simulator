package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	orderrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooktarget"
)

const deliveryTask = "webhook:deliver"

type worker struct {
	db     *pgxpool.Pool
	cfg    platform.Config
	client *asynq.Client
	logger *slog.Logger
	http   *http.Client
	orders deadlineOrderService
}
type deliveryPayload struct {
	DeliveryID string `json:"delivery_id"`
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := platform.LoadConfig()
	if err != nil {
		logger.Error("configuration failed", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := platform.RunMigrations(ctx, db, "migrations"); err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	redisOpt, err := asynq.ParseRedisURI(cfg.RedisURL)
	if err != nil {
		logger.Error("invalid Redis URL", "error", err)
		os.Exit(1)
	}
	w := &worker{db: db, cfg: cfg, client: asynq.NewClient(redisOpt), logger: logger, http: webhooktarget.Client(10*time.Second, cfg.AllowPrivateWebhooks), orders: orders.NewService(orderrepo.NewPostgreSQLLifecycleRepository(db))}
	defer func() {
		if err := w.client.Close(); err != nil {
			logger.Warn("asynq client close failed", "error", err)
		}
	}()
	mux := asynq.NewServeMux()
	mux.HandleFunc(deliveryTask, w.handleDelivery)
	srv := asynq.NewServer(redisOpt, asynq.Config{Concurrency: 10, Queues: map[string]int{"webhooks": 10}})
	go w.publishLoop(ctx)
	go w.scheduleLoop(ctx)
	go w.deadlineLoop(ctx)
	go func() {
		if err := srv.Run(mux); err != nil {
			logger.Error("asynq server stopped", "error", err)
		}
	}()
	<-ctx.Done()
	srv.Shutdown()
}

func (w *worker) publishLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.publishOutbox(ctx); err != nil {
				w.logger.Error("outbox publish failed", "error", err)
			}
		}
	}
}
func (w *worker) scheduleLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.scheduleDeliveries(ctx); err != nil {
				w.logger.Error("delivery schedule failed", "error", err)
			}
		}
	}
}

func (w *worker) publishOutbox(ctx context.Context) error {
	rows, err := w.db.Query(ctx, `SELECT o.id,e.id,e.shop_id,e.event_type FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE o.published_at IS NULL ORDER BY o.created_at LIMIT 50`)
	if err != nil {
		return fmt.Errorf("query outbox: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var outbox, eventID, shop, eventType string
		if err := rows.Scan(&outbox, &eventID, &shop, &eventType); err != nil {
			return fmt.Errorf("scan outbox: %w", err)
		}
		tx, err := w.db.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin outbox transaction: %w", err)
		}
		var published *time.Time
		err = tx.QueryRow(ctx, `SELECT published_at FROM outbox WHERE id=$1 FOR UPDATE`, outbox).Scan(&published)
		if err != nil || published != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		var duplicate, outOfOrder bool
		var delaySeconds int
		if err := tx.QueryRow(ctx, `SELECT webhook_duplicate, webhook_delay_seconds, webhook_out_of_order FROM shop_scenarios WHERE shop_id=$1`, shop).Scan(&duplicate, &delaySeconds, &outOfOrder); err != nil && err != pgx.ErrNoRows {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("load webhook scenario: %w", err)
		}
		if outOfOrder && eventType == "order.paid" && delaySeconds < 10 {
			delaySeconds = 10
		}
		hooks, err := tx.Query(ctx, `SELECT id FROM webhooks WHERE shop_id=$1 AND enabled=true AND deleted_at IS NULL AND subscribed_events ? $2 FOR SHARE`, shop, eventType)
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("query webhook subscriptions: %w", err)
		}
		webhookIDs := make([]string, 0)
		for hooks.Next() {
			var hook string
			if err := hooks.Scan(&hook); err != nil {
				hooks.Close()
				_ = tx.Rollback(ctx)
				return fmt.Errorf("read webhook subscription: %w", err)
			}
			webhookIDs = append(webhookIDs, hook)
		}
		if err := hooks.Err(); err != nil {
			hooks.Close()
			_ = tx.Rollback(ctx)
			return fmt.Errorf("iterate webhook subscriptions: %w", err)
		}
		hooks.Close()
		for _, hook := range webhookIDs {
			copies := 1
			if duplicate {
				copies = 2
			}
			for i := 0; i < copies; i++ {
				if _, err := tx.Exec(ctx, `INSERT INTO webhook_deliveries(id,webhook_id,event_id,next_attempt_at) VALUES($1,$2,$3,now()+($4 * interval '1 second'))`, platform.NewID("del"), hook, eventID, delaySeconds); err != nil {
					_ = tx.Rollback(ctx)
					return fmt.Errorf("insert delivery: %w", err)
				}
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE outbox SET published_at=now() WHERE id=$1`, outbox); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit outbox: %w", err)
		}
	}
	return rows.Err()
}

func (w *worker) scheduleDeliveries(ctx context.Context) error {
	rows, err := w.db.Query(ctx, `SELECT id FROM webhook_deliveries WHERE status='PENDING' AND (next_attempt_at IS NULL OR next_attempt_at<=now()) AND (leased_until IS NULL OR leased_until<=now()) ORDER BY created_at,id LIMIT 100`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		command, err := w.db.Exec(ctx, `UPDATE webhook_deliveries SET leased_until=now()+interval '30 seconds' WHERE id=$1 AND status='PENDING' AND (leased_until IS NULL OR leased_until<=now()) AND (next_attempt_at IS NULL OR next_attempt_at<=now())`, id)
		if err != nil {
			return fmt.Errorf("lease delivery: %w", err)
		}
		if command.RowsAffected() == 0 {
			continue
		}
		payload, err := json.Marshal(deliveryPayload{DeliveryID: id})
		if err != nil {
			return fmt.Errorf("marshal delivery task: %w", err)
		}
		task := asynq.NewTask(deliveryTask, payload, asynq.MaxRetry(0), asynq.Queue("webhooks"))
		if _, err := w.client.EnqueueContext(ctx, task); err != nil {
			_, _ = w.db.Exec(ctx, `UPDATE webhook_deliveries SET leased_until=NULL WHERE id=$1`, id)
			return fmt.Errorf("enqueue delivery: %w", err)
		}
	}
	return rows.Err()
}

func (w *worker) handleDelivery(ctx context.Context, task *asynq.Task) error {
	var input deliveryPayload
	if err := json.Unmarshal(task.Payload(), &input); err != nil {
		return asynq.SkipRetry
	}
	var urlString, cipherText, eventID, eventType, providerProfile, shopID, appKey, appSecretCipher string
	var payload []byte
	var attempts int
	var forceFailure bool
	err := w.db.QueryRow(ctx, `SELECT w.url,w.secret_ciphertext,e.id,e.event_type,e.payload,d.attempt_count,COALESCE(s.webhook_force_failure,false),shops.provider_profile,w.shop_id,COALESCE((SELECT client_id FROM credentials WHERE shop_id=w.shop_id AND status='ACTIVE' ORDER BY created_at,id LIMIT 1),''),COALESCE((SELECT secret_ciphertext FROM credentials WHERE shop_id=w.shop_id AND status='ACTIVE' ORDER BY created_at,id LIMIT 1),'') FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id JOIN domain_events e ON e.id=d.event_id JOIN shops ON shops.id=w.shop_id LEFT JOIN shop_scenarios s ON s.shop_id=w.shop_id WHERE d.id=$1 AND d.status='PENDING' AND w.deleted_at IS NULL AND d.leased_until>now()`, input.DeliveryID).Scan(&urlString, &cipherText, &eventID, &eventType, &payload, &attempts, &forceFailure, &providerProfile, &shopID, &appKey, &appSecretCipher)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load delivery: %w", err)
	}
	start := time.Now()
	payload, headers, preparationErr := w.prepareWebhook(providerProfile, eventID, eventType, shopID, appKey, appSecretCipher, cipherText, payload, start)
	status := 0
	responseHeaders := map[string]string{}
	body := ""
	failureCode := ""
	httpAttempted, truncated := false, false
	callErr := preparationErr
	if callErr != nil {
		failureCode = "SIGNING_ERROR"
	} else if forceFailure {
		callErr = fmt.Errorf("webhook failure scenario active; disable Force webhook failure in Scenarios to deliver")
		failureCode = "FORCED_FAILURE"
	} else {
		request, requestErr := http.NewRequestWithContext(ctx, http.MethodPost, urlString, bytes.NewReader(payload))
		if requestErr != nil {
			callErr, failureCode = requestErr, "REQUEST_ERROR"
		} else {
			for k, v := range headers {
				request.Header.Set(k, v)
			}
			httpAttempted = true
			response, requestErr := w.http.Do(request)
			if requestErr != nil {
				callErr, failureCode = requestErr, "NETWORK_ERROR"
				var timeout net.Error
				if errors.As(requestErr, &timeout) && timeout.Timeout() {
					failureCode = "TIMEOUT"
				}
			} else {
				status = response.StatusCode
				for k, v := range response.Header {
					responseHeaders[k] = strings.Join(v, ",")
				}
				raw, readErr := io.ReadAll(io.LimitReader(response.Body, 4097))
				closeErr := response.Body.Close()
				truncated = len(raw) > 4096
				if truncated {
					raw = raw[:4096]
				}
				body = string(raw)
				if readErr != nil {
					callErr, failureCode = readErr, "RESPONSE_READ_ERROR"
				} else if closeErr != nil {
					callErr, failureCode = closeErr, "RESPONSE_READ_ERROR"
				}
				if status < 200 || status >= 300 {
					callErr, failureCode = fmt.Errorf("webhook returned HTTP %d", status), "HTTP_STATUS"
				}
			}
		}
	}
	attempt := attempts + 1
	requestHeaders, err := json.Marshal(headers)
	if err != nil {
		return fmt.Errorf("encode request headers: %w", err)
	}
	responseHeaderJSON, err := json.Marshal(responseHeaders)
	if err != nil {
		return fmt.Errorf("encode response headers: %w", err)
	}
	attemptStatus, failureReason := "SUCCESS", ""
	if callErr != nil {
		attemptStatus, failureReason = "FAILURE", callErr.Error()
	}
	var requestBody *string
	if preparationErr == nil {
		raw := string(payload)
		requestBody = &raw
	}
	signingClientID := ""
	if providerProfile == orders.TokopediaLike {
		signingClientID = appKey
	}
	_, err = w.db.Exec(ctx, `INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt,request_headers,response_status,response_headers,response_body,duration_ms,status,request_body,request_url,provider_profile,signing_client_id,started_at,http_attempted,failure_code,failure_reason,response_body_truncated) VALUES($1,$2,$3,$4,NULLIF($5,0),$6,$7,$8,$9,$10,$11,$12,NULLIF($13,''),$14,$15,NULLIF($16,''),NULLIF($17,''),$18)`, platform.NewID("att"), input.DeliveryID, attempt, requestHeaders, status, responseHeaderJSON, body, time.Since(start).Milliseconds(), attemptStatus, requestBody, urlString, providerProfile, signingClientID, start, httpAttempted, failureCode, failureReason, truncated)
	if err != nil {
		return fmt.Errorf("record webhook attempt: %w", err)
	}
	// Cancellation can occur while HTTP is in flight; retain the recorded attempt count
	// without changing CANCELLED back into a deliverable state.
	if _, err = w.db.Exec(ctx, `UPDATE webhook_deliveries SET attempt_count=GREATEST(attempt_count,$2) WHERE id=$1 AND status='CANCELLED'`, input.DeliveryID, attempt); err != nil {
		return err
	}
	if callErr == nil {
		w.logger.Info("webhook delivery succeeded", "delivery_id", input.DeliveryID, "event_id", eventID, "event_type", eventType, "attempt", attempt, "response_status", status, "duration_ms", time.Since(start).Milliseconds())
		_, err = w.db.Exec(ctx, `UPDATE webhook_deliveries SET status='DELIVERED',attempt_count=$2,delivered_at=now(),next_attempt_at=NULL,leased_until=NULL WHERE id=$1 AND status='PENDING'`, input.DeliveryID, attempt)
		return err
	}
	if attempt >= 5 {
		w.logger.Warn("webhook delivery exhausted retries", "delivery_id", input.DeliveryID, "event_id", eventID, "event_type", eventType, "attempt", attempt, "response_status", status, "failure_reason", callErr.Error())
		_, err = w.db.Exec(ctx, `UPDATE webhook_deliveries SET status='FAILED',attempt_count=$2,next_attempt_at=NULL,leased_until=NULL WHERE id=$1 AND status='PENDING'`, input.DeliveryID, attempt)
		if err != nil {
			return err
		}
		return nil
	}
	delay := webhooks.RetryAfter(attempt)
	w.logger.Warn("webhook delivery failed; retry scheduled", "delivery_id", input.DeliveryID, "event_id", eventID, "event_type", eventType, "attempt", attempt, "response_status", status, "retry_in_seconds", int(delay.Seconds()), "failure_reason", callErr.Error())
	_, err = w.db.Exec(ctx, `UPDATE webhook_deliveries SET attempt_count=$2,next_attempt_at=now()+($3 * interval '1 second'),leased_until=NULL WHERE id=$1 AND status='PENDING'`, input.DeliveryID, attempt, int(delay.Seconds()))
	if err != nil {
		return fmt.Errorf("schedule webhook retry: %w", err)
	}
	return nil
}

// prepareWebhook returns the exact application body and signing headers used by
// this attempt. No secret is retained in diagnostics; failed signing is recorded
// as a preflight failure rather than an invented outbound request.
func (w *worker) prepareWebhook(profile, eventID, eventType, shopID, appKey, appSecretCipher, cipherText string, payload []byte, at time.Time) ([]byte, map[string]string, error) {
	timestamp := fmt.Sprintf("%d", at.Unix())
	if orders.NormaliseProvider(profile) == orders.TokopediaLike {
		if appKey == "" || appSecretCipher == "" {
			return nil, map[string]string{}, fmt.Errorf("tokopedia webhook needs an active app credential; create one in Credentials and configure the receiver with its key")
		}
		secret, err := platform.Decrypt(w.cfg.EncryptionKey, appSecretCipher)
		if err != nil {
			return nil, map[string]string{}, fmt.Errorf("decrypt Tokopedia signing key: %w", err)
		}
		payload, _ = tokopedia.WebhookBody(eventID, shopID, eventType, payload, at.Unix())
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(appKey + string(payload)))
		return payload, map[string]string{"Content-Type": "application/json", "Authorization": hex.EncodeToString(mac.Sum(nil))}, nil
	}
	secret, err := platform.Decrypt(w.cfg.EncryptionKey, cipherText)
	if err != nil {
		return nil, map[string]string{}, fmt.Errorf("decrypt webhook signing key: %w", err)
	}
	eventType, payload = webhooks.DeliveryContract(profile, eventID, eventType, payload)
	mac := hmac.New(sha256.New, []byte(secret))
	if orders.NormaliseProvider(profile) == orders.ShopeeLike {
		mac.Write([]byte(eventType + timestamp + string(payload)))
		return payload, map[string]string{"Content-Type": "application/json", "X-Shopee-Event": eventType, "X-Shopee-Event-Id": eventID, "X-Shopee-Timestamp": timestamp, "X-Shopee-Signature": hex.EncodeToString(mac.Sum(nil))}, nil
	}
	mac.Write([]byte(timestamp + "." + string(payload)))
	return payload, map[string]string{"Content-Type": "application/json", "X-Marketplace-Event": eventType, "X-Marketplace-Event-Id": eventID, "X-Marketplace-Timestamp": timestamp, "X-Marketplace-Signature": hex.EncodeToString(mac.Sum(nil))}, nil
}
