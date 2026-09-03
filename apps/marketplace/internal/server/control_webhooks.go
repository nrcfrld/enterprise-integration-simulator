package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

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
	command, err := s.db.Exec(c, `UPDATE webhooks SET url=$1,subscribed_events=$2,enabled=$3,secret_ciphertext=CASE WHEN $4='' THEN secret_ciphertext ELSE $4 END WHERE id=$5 AND shop_id=$6`, in.URL, events, in.Enabled, cipher, id, shop)
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
	command, err := s.db.Exec(c, `DELETE FROM webhooks WHERE id=$1 AND shop_id=$2`, id, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not delete webhook"))
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(404, errorBody("NOT_FOUND", "webhook not found"))
		return
	}
	c.Status(http.StatusNoContent)
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
	rows, err := s.db.Query(c, `SELECT d.id,d.event_id,d.status,d.attempt_count,d.created_at,d.delivered_at,d.next_attempt_at,e.event_type,w.url,COALESCE(last_attempt.response_body,'') FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id JOIN domain_events e ON e.id=d.event_id LEFT JOIN LATERAL (SELECT response_body FROM webhook_delivery_attempts WHERE delivery_id=d.id AND status='FAILURE' ORDER BY attempt DESC LIMIT 1) last_attempt ON true WHERE w.shop_id=$1 ORDER BY d.created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list deliveries"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, event, status, eventType, endpoint, failureReason string
		var attempts int
		var created time.Time
		var delivered, nextAttempt *time.Time
		if err := rows.Scan(&id, &event, &status, &attempts, &created, &delivered, &nextAttempt, &eventType, &endpoint, &failureReason); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read delivery"))
			return
		}
		data = append(data, gin.H{"id": id, "event_id": event, "event_type": eventType, "endpoint": endpoint, "status": status, "attempt_count": attempts, "next_attempt_at": nextAttempt, "failure_reason": failureReason, "created_at": created, "delivered_at": delivered})
	}
	s.controlListResponse(c, data)
}

func (s *Server) deliveryDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, eventID, status string
	var attempts int
	err := s.db.QueryRow(c, `SELECT w.shop_id,d.event_id,d.status,d.attempt_count FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=$1`, id).Scan(&shop, &eventID, &status, &attempts)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "delivery not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT id,attempt,response_status,response_body,duration_ms,status,created_at FROM webhook_delivery_attempts WHERE delivery_id=$1 ORDER BY attempt`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load delivery attempts"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var attemptID, body, attemptStatus string
		var attempt, duration int
		var responseStatus *int
		var created time.Time
		if err := rows.Scan(&attemptID, &attempt, &responseStatus, &body, &duration, &attemptStatus, &created); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read delivery attempt"))
			return
		}
		data = append(data, gin.H{"id": attemptID, "attempt": attempt, "response_status": responseStatus, "response_body": body, "duration_ms": duration, "status": attemptStatus, "created_at": created})
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "event_id": eventID, "status": status, "attempt_count": attempts, "attempts": data})
}
