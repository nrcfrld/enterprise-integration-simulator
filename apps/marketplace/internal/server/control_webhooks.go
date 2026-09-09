package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooktarget"
)

func (s *Server) controlWebhooks(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	s.webhookListResponse(c, shop)
}

func (s *Server) createControlWebhook(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	in, err := s.parseWebhookInput(c)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", err.Error()))
		return
	}
	generated := in.Secret == ""
	if generated {
		in.Secret = platform.NewID("whsec")
	}
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, in.Secret)
	if err != nil {
		c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect webhook secret"))
		return
	}
	events, err := json.Marshal(in.SubscribedEvents)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode subscribed events"))
		return
	}
	id := platform.NewID("wh")
	if _, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, shop, in.URL, cipher, events); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create webhook"))
		return
	}
	out := gin.H{"id": id, "shop_id": shop, "url": in.URL, "enabled": true, "subscribed_events": in.SubscribedEvents}
	if generated {
		out["secret"] = in.Secret
	}
	c.JSON(201, out)
}

// updateControlWebhook changes a registration without exposing its stored secret.
func (s *Server) updateControlWebhook(c *gin.Context) {
	shop, id := c.Param("id"), c.Param("webhookID")
	if !s.mustAccessShop(c, shop) {
		return
	}
	in, err := s.parseWebhookInput(c)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", err.Error()))
		return
	}
	cipher := ""
	if in.Secret != "" {
		cipher, err = platform.Encrypt(s.cfg.EncryptionKey, in.Secret)
		if err != nil {
			c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect webhook secret"))
			return
		}
	}
	events, err := json.Marshal(in.SubscribedEvents)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode subscribed events"))
		return
	}
	command, err := s.db.Exec(c, `UPDATE webhooks SET url=$1,subscribed_events=$2,enabled=$3,secret_ciphertext=CASE WHEN $4='' THEN secret_ciphertext ELSE $4 END WHERE id=$5 AND shop_id=$6 AND deleted_at IS NULL`, in.URL, events, in.Enabled, cipher, id, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update webhook"))
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(404, errorBody("NOT_FOUND", "webhook not found"))
		return
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "url": in.URL, "enabled": in.Enabled, "subscribed_events": in.SubscribedEvents})
}

func (s *Server) deleteControlWebhook(c *gin.Context) {
	shop, id := c.Param("id"), c.Param("webhookID")
	if !s.mustAccessShop(c, shop) {
		return
	}
	s.deleteWebhookResponse(c, id, shop)
}

type webhookInput struct {
	URL              string   `json:"url"`
	Secret           string   `json:"secret"`
	SubscribedEvents []string `json:"subscribed_events"`
	Enabled          bool     `json:"enabled"`
}

func (s *Server) parseWebhookInput(c *gin.Context) (webhookInput, error) {
	var input webhookInput
	if err := c.ShouldBindJSON(&input); err != nil {
		return webhookInput{}, fmt.Errorf("invalid webhook request")
	}
	if input.URL == "" || len(input.SubscribedEvents) == 0 {
		return webhookInput{}, fmt.Errorf("url and subscribed_events are required")
	}
	if err := webhooktarget.ValidateURL(input.URL, s.cfg.AllowPrivateWebhooks); err != nil {
		return webhookInput{}, err
	}
	for _, eventType := range input.SubscribedEvents {
		if !webhooks.SupportsEvent(eventType) {
			return webhookInput{}, fmt.Errorf("unsupported webhook event %q", eventType)
		}
	}
	return input, nil
}

func (s *Server) controlDeliveries(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT d.id,d.webhook_id,d.event_id,d.status,d.attempt_count,d.created_at,d.delivered_at,d.next_attempt_at,e.event_type,w.url,CASE WHEN last_attempt.status='FAILURE' THEN COALESCE(last_attempt.failure_reason,last_attempt.response_body,'') ELSE '' END,w.deleted_at IS NOT NULL FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id JOIN domain_events e ON e.id=d.event_id LEFT JOIN LATERAL (SELECT status,failure_reason,response_body FROM webhook_delivery_attempts WHERE delivery_id=d.id ORDER BY attempt DESC LIMIT 1) last_attempt ON true WHERE w.shop_id=$1 ORDER BY d.created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list deliveries"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, webhookID, event, status, eventType, endpoint, failureReason string
		var deleted bool
		var attempts int
		var created time.Time
		var delivered, nextAttempt *time.Time
		if err := rows.Scan(&id, &webhookID, &event, &status, &attempts, &created, &delivered, &nextAttempt, &eventType, &endpoint, &failureReason, &deleted); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read delivery"))
			return
		}
		data = append(data, gin.H{"id": id, "webhook_id": webhookID, "event_id": event, "event_type": eventType, "endpoint": endpoint, "status": status, "attempt_count": attempts, "next_attempt_at": nextAttempt, "failure_reason": failureReason, "webhook_deleted": deleted, "created_at": created, "delivered_at": delivered})
	}
	s.controlSearchResponse(c, data, "id", "event_id", "webhook_id", "event_type", "endpoint")
}

func (s *Server) deliveryDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, eventID, status, webhookID, endpoint, eventType, aggregateID, provider string
	var eventPayload []byte
	var deleted, enabled bool
	var attempts int
	var occurred time.Time
	err := s.db.QueryRow(c, `SELECT w.shop_id,d.event_id,d.status,d.attempt_count,w.deleted_at IS NOT NULL,w.id,w.url,w.enabled,e.event_type,e.aggregate_id,e.payload,e.occurred_at,sh.provider_profile FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id JOIN domain_events e ON e.id=d.event_id JOIN shops sh ON sh.id=w.shop_id WHERE d.id=$1`, id).Scan(&shop, &eventID, &status, &attempts, &deleted, &webhookID, &endpoint, &enabled, &eventType, &aggregateID, &eventPayload, &occurred, &provider)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "delivery not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT id,attempt,response_status,COALESCE(response_body,''),duration_ms,status,created_at,request_headers,COALESCE(response_headers,'{}'),request_body,request_url,provider_profile,signing_client_id,started_at,http_attempted,failure_code,failure_reason,response_body_truncated FROM webhook_delivery_attempts WHERE delivery_id=$1 ORDER BY attempt`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load delivery attempts"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var attemptID, body, attemptStatus string
		var requestBody, requestURL, profile, clientID, failureCode, failureReason *string
		var requestHeaders, responseHeaders []byte
		var attempt, duration int
		var responseStatus *int
		var created time.Time
		var started *time.Time
		var httpAttempted, truncated *bool
		if err := rows.Scan(&attemptID, &attempt, &responseStatus, &body, &duration, &attemptStatus, &created, &requestHeaders, &responseHeaders, &requestBody, &requestURL, &profile, &clientID, &started, &httpAttempted, &failureCode, &failureReason, &truncated); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read delivery attempt"))
			return
		}
		data = append(data, gin.H{"id": attemptID, "attempt": attempt, "response_status": responseStatus, "response_body": body, "duration_ms": duration, "status": attemptStatus, "created_at": created, "request_headers": json.RawMessage(requestHeaders), "response_headers": json.RawMessage(responseHeaders), "request_body": requestBody, "request_url": requestURL, "provider_profile": profile, "signing_client_id": clientID, "started_at": started, "http_attempted": httpAttempted, "failure_code": failureCode, "failure_reason": failureReason, "response_body_truncated": truncated})
	}
	if err := rows.Err(); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read delivery attempts"))
		return
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "event_id": eventID, "status": status, "attempt_count": attempts, "attempts": data, "webhook_deleted": deleted, "webhook": gin.H{"id": webhookID, "url": endpoint, "enabled": enabled, "deleted": deleted}, "provider_profile": provider, "event": gin.H{"id": eventID, "event_type": eventType, "aggregate_id": aggregateID, "aggregate_type": strings.SplitN(eventType, ".", 2)[0], "occurred_at": occurred, "payload": json.RawMessage(eventPayload)}})
}

// Keep registrations as tombstones so delivery attempts remain inspectable.
// The row lock also serializes deletion with fanout and manual retry.
func (s *Server) retireWebhook(ctx context.Context, id, shop string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	command, err := tx.Exec(ctx, `UPDATE webhooks SET deleted_at=now(),enabled=false WHERE id=$1 AND shop_id=$2 AND deleted_at IS NULL`, id, shop)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	_, err = tx.Exec(ctx, `UPDATE webhook_deliveries SET status='CANCELLED',next_attempt_at=NULL,leased_until=NULL WHERE webhook_id=$1 AND status='PENDING'`, id)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Server) deleteWebhookResponse(c *gin.Context, id, shop string) {
	err := s.retireWebhook(c, id, shop)
	if err == pgx.ErrNoRows {
		c.JSON(404, errorBody("NOT_FOUND", "webhook not found"))
		return
	}
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not delete webhook"))
		return
	}
	c.Status(204)
}
