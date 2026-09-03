package server

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooktarget"
)

func (s *Server) tokopediaListOrders(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		PageSize    int    `json:"page_size"`
		PageToken   string `json:"page_token"`
		OrderStatus string `json:"order_status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		s.tokopediaError(c, 400, "invalid request body")
		return
	}
	if input.PageSize == 0 {
		input.PageSize = 20
	}
	if input.PageSize < 1 || input.PageSize > 100 {
		s.tokopediaError(c, 400, "page_size must be between 1 and 100")
		return
	}
	offset := 0
	if input.PageToken != "" {
		raw, err := base64.RawURLEncoding.DecodeString(input.PageToken)
		if err != nil {
			s.tokopediaError(c, 400, "invalid page_token")
			return
		}
		offset, err = strconv.Atoi(string(raw))
		if err != nil || offset < 0 {
			s.tokopediaError(c, 400, "invalid page_token")
			return
		}
	}
	query := `SELECT id,order_number,status,total_amount,created_at,updated_at FROM orders WHERE shop_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`
	args := []any{client.ShopID, input.PageSize + 1, offset}
	if input.OrderStatus != "" {
		statuses, valid := tokopedia.CanonicalOrderStatuses(input.OrderStatus)
		if !valid {
			s.tokopediaError(c, 400, "unsupported order_status")
			return
		}
		query = `SELECT id,order_number,status,total_amount,created_at,updated_at FROM orders WHERE shop_id=$1 AND status=ANY($2) ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`
		args = []any{client.ShopID, statuses, input.PageSize + 1, offset}
	}
	rows, err := s.db.Query(c, query, args...)
	if err != nil {
		s.tokopediaError(c, 500, "could not list orders")
		return
	}
	defer rows.Close()
	ordersData := []gin.H{}
	for rows.Next() {
		var id, number, status string
		var total int64
		var created, updated time.Time
		if err := rows.Scan(&id, &number, &status, &total, &created, &updated); err != nil {
			s.tokopediaError(c, 500, "could not read order")
			return
		}
		ordersData = append(ordersData, gin.H{"order_id": id, "order_number": number, "order_status": tokopedia.OrderStatus(status), "payment_status": paymentStatusForTokopedia(status), "total_amount": total, "create_time": created.Unix(), "update_time": updated.Unix()})
	}
	more := len(ordersData) > input.PageSize
	if more {
		ordersData = ordersData[:input.PageSize]
	}
	next := ""
	if more {
		next = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + input.PageSize)))
	}
	s.tokopediaSuccess(c, gin.H{"orders": ordersData, "next_page_token": next, "has_more": more})
}

func paymentStatusForTokopedia(status string) string {
	if status == orders.Unpaid {
		return "UNPAID"
	}
	if status == orders.Cancelled {
		return "CANCELLED"
	}
	return "PAID"
}

func (s *Server) tokopediaGetOrder(c *gin.Context) {
	client := currentClient(c)
	var id, number, status string
	var total int64
	var created, updated time.Time
	err := s.db.QueryRow(c, `SELECT id,order_number,status,total_amount,created_at,updated_at FROM orders WHERE id=$1 AND shop_id=$2`, c.Param("id"), client.ShopID).Scan(&id, &number, &status, &total, &created, &updated)
	if err != nil {
		s.tokopediaError(c, 400, "order not found")
		return
	}
	s.tokopediaSuccess(c, gin.H{"order_id": id, "order_number": number, "order_status": tokopedia.OrderStatus(status), "payment_status": paymentStatusForTokopedia(status), "total_amount": total, "create_time": created.Unix(), "update_time": updated.Unix(), "line_items": s.items(c, id), "package_list": s.packagesForOrder(c, id), "shipment_list": s.shipmentsForOrder(c, id)})
}

func (s *Server) tokopediaPackOrder(c *gin.Context)     { s.tokopediaTransition(c, orders.Processing) }
func (s *Server) tokopediaHandoverOrder(c *gin.Context) { s.tokopediaTransition(c, orders.ReadyToShip) }

func (s *Server) tokopediaTransition(c *gin.Context, target string) {
	client := currentClient(c)
	if err := s.transition(c, client.ShopID, c.Param("id"), target, ""); err != nil {
		s.tokopediaError(c, 400, err.Error())
		return
	}
	s.tokopediaSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": tokopedia.OrderStatus(target)})
}

func (s *Server) tokopediaConfigureWebhooks(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		CallbackURL string   `json:"callback_url"`
		EventTypes  []string `json:"event_types"`
		Secret      string   `json:"secret"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.CallbackURL == "" || len(input.EventTypes) == 0 {
		s.tokopediaError(c, 400, "callback_url and event_types are required")
		return
	}
	if err := webhooktarget.ValidateURL(input.CallbackURL, s.cfg.AllowPrivateWebhooks); err != nil {
		s.tokopediaError(c, 400, err.Error())
		return
	}
	canonical := []string{}
	for _, topic := range input.EventTypes {
		switch topic {
		case "ORDER_STATUS_CHANGE":
			canonical = append(canonical, "order.created", "order.paid", "order.processing", "order.ready_to_ship", "order.completed", "order.cancelled")
		case "PACKAGE_UPDATE":
			canonical = append(canonical, "order.shipped", "order.in_delivery", "order.delivered", "shipment.delivery_failed", "shipment.returning", "shipment.returned")
		case "PRODUCT_INFORMATION_CHANGE":
			canonical = append(canonical, "product.created", "product.updated", "product.deleted")
		default:
			s.tokopediaError(c, 400, "unsupported event_type "+topic)
			return
		}
	}
	if input.Secret == "" {
		input.Secret = platform.NewID("whsec")
	}
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, input.Secret)
	if err != nil {
		s.tokopediaError(c, 500, "could not protect webhook secret")
		return
	}
	raw, _ := json.Marshal(canonical)
	id := platform.NewID("wh")
	if _, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, client.ShopID, input.CallbackURL, cipher, raw); err != nil {
		s.tokopediaError(c, 500, "could not create webhook")
		return
	}
	s.tokopediaSuccess(c, gin.H{"webhook_id": id, "event_types": input.EventTypes, "secret": input.Secret})
}
