package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooktarget"
)

func (s *Server) createWebhook(c *gin.Context) {
	client := currentClient(c)
	var in struct {
		URL              string   `json:"url"`
		Secret           string   `json:"secret"`
		SubscribedEvents []string `json:"subscribed_events"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.URL == "" || len(in.SubscribedEvents) == 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "url and subscribed_events are required"))
		return
	}
	if err := webhooktarget.ValidateURL(in.URL, s.cfg.AllowPrivateWebhooks); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", err.Error()))
		return
	}
	for _, eventType := range in.SubscribedEvents {
		if !webhooks.SupportsEvent(eventType) {
			c.JSON(400, errorBody("INVALID_REQUEST", "unsupported webhook event "+eventType))
			return
		}
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
	events, _ := json.Marshal(in.SubscribedEvents)
	id := platform.NewID("wh")
	_, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, client.ShopID, in.URL, cipher, events)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create webhook"))
		return
	}
	out := gin.H{"id": id, "shop_id": client.ShopID, "url": in.URL, "enabled": true, "subscribed_events": in.SubscribedEvents}
	if generated {
		out["secret"] = in.Secret
	}
	c.JSON(201, out)
}

// shopeeCreateWebhook exposes provider event names and callback_url. Stored
// subscriptions stay canonical, preserving one durable outbox for all shops.
func (s *Server) shopeeCreateWebhook(c *gin.Context) {
	client := currentClient(c)
	var in struct {
		CallbackURL string   `json:"callback_url"`
		Secret      string   `json:"secret"`
		EventTypes  []string `json:"event_types"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CallbackURL == "" || len(in.EventTypes) == 0 {
		s.shopeeError(c, 400, "error_param", "callback_url and event_types are required")
		return
	}
	if err := webhooktarget.ValidateURL(in.CallbackURL, s.cfg.AllowPrivateWebhooks); err != nil {
		s.shopeeError(c, 400, "error_param", err.Error())
		return
	}
	canonical := []string{}
	seen := map[string]bool{}
	for _, event := range in.EventTypes {
		for _, domainEvent := range shopeeSubscriptionEvents(event) {
			if !seen[domainEvent] {
				canonical, seen[domainEvent] = append(canonical, domainEvent), true
			}
		}
		if len(shopeeSubscriptionEvents(event)) == 0 {
			s.shopeeError(c, 400, "error_param", "unsupported event_type "+event)
			return
		}
	}
	generated := in.Secret == ""
	if generated {
		in.Secret = platform.NewID("whsec")
	}
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, in.Secret)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "could not protect webhook secret")
		return
	}
	raw, _ := json.Marshal(canonical)
	id := platform.NewID("wh")
	if _, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, client.ShopID, in.CallbackURL, cipher, raw); err != nil {
		s.shopeeError(c, 500, "error_system", "could not create webhook")
		return
	}
	result := gin.H{"webhook_id": id, "callback_url": in.CallbackURL, "event_types": in.EventTypes, "enabled": true}
	if generated {
		result["secret"] = in.Secret
	}
	s.shopeeSuccess(c, result)
}

func shopeeSubscriptionEvents(event string) []string {
	switch event {
	case "item_update":
		return []string{"product.created", "product.updated", "product.deleted"}
	case "order_status_update":
		return []string{"order.created", "order.paid", "order.payment_failed", "order.payment_expired", "order.processing", "order.ready_to_ship", "order.completed", "order.cancelled", "order.sla_expired"}
	case "logistics_status_update":
		return []string{"order.shipped", "order.in_delivery", "order.delivered"}
	default:
		return nil
	}
}

func (s *Server) shopeeListWebhooks(c *gin.Context) {
	client := currentClient(c)
	rows, err := s.db.Query(c, `SELECT id,url,enabled,subscribed_events FROM webhooks WHERE shop_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, client.ShopID)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "could not list webhooks")
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, callback string
		var enabled bool
		var raw []byte
		if err := rows.Scan(&id, &callback, &enabled, &raw); err != nil {
			s.shopeeError(c, 500, "error_system", "could not read webhooks")
			return
		}
		var canonical []string
		_ = json.Unmarshal(raw, &canonical)
		types := map[string]bool{}
		for _, event := range canonical {
			types[webhooks.ShopeeEvent(event)] = true
		}
		events := []string{}
		for _, event := range []string{"item_update", "order_status_update", "logistics_status_update"} {
			if types[event] {
				events = append(events, event)
			}
		}
		data = append(data, gin.H{"webhook_id": id, "callback_url": callback, "event_types": events, "enabled": enabled})
	}
	s.shopeeSuccess(c, gin.H{"webhook_list": data})
}

func (s *Server) listWebhooks(c *gin.Context) { s.webhookListResponse(c, currentClient(c).ShopID) }
func (s *Server) webhookListResponse(c *gin.Context, shop string) {
	rows, err := s.db.Query(c, `SELECT id,url,enabled,subscribed_events,created_at FROM webhooks WHERE shop_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list webhooks"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, url string
		var enabled bool
		var events []byte
		var created time.Time
		if err := rows.Scan(&id, &url, &enabled, &events, &created); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read webhook"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": shop, "url": url, "enabled": enabled, "subscribed_events": json.RawMessage(events), "created_at": created})
	}
	var provider, signingClientID string
	err = s.db.QueryRow(c, `SELECT provider_profile,COALESCE((SELECT client_id FROM credentials WHERE shop_id=$1 AND status='ACTIVE' ORDER BY created_at,id LIMIT 1),'') FROM shops WHERE id=$1`, shop).Scan(&provider, &signingClientID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read webhook delivery contract"))
		return
	}
	s.controlListResponse(c, data, gin.H{"delivery_contract": gin.H{"provider_profile": provider, "signing_client_id": signingClientID}})
}

// controlListResponse gives every control-plane collection the same page/limit
// contract. This keeps the dashboard responsive while preserving existing list
// consumers that only read the data field.
func (s *Server) controlListResponse(c *gin.Context, data []gin.H, metadata ...gin.H) {
	limit := 20
	if parsed, err := strconv.Atoi(c.DefaultQuery("limit", "20")); err == nil && parsed > 0 && parsed <= 100 {
		limit = parsed
	}
	pageNumber := 1
	if parsed, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && parsed > 0 {
		pageNumber = parsed
	}
	total := len(data)
	totalPages := max(1, (total+limit-1)/limit)
	if pageNumber > totalPages {
		pageNumber = totalPages
	}
	start := (pageNumber - 1) * limit
	end := min(start+limit, total)
	if start > total {
		start = total
	}
	out := gin.H{
		"data":       data[start:end],
		"pagination": gin.H{"page": pageNumber, "limit": limit, "total": total, "total_pages": totalPages, "has_previous": pageNumber > 1, "has_next": pageNumber < totalPages},
	}
	for _, extra := range metadata {
		for key, value := range extra {
			out[key] = value
		}
	}
	c.JSON(http.StatusOK, out)
}
func (s *Server) deleteWebhook(c *gin.Context) {
	client := currentClient(c)
	s.deleteWebhookResponse(c, c.Param("id"), client.ShopID)
}
