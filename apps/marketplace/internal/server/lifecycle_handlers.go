package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/events"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/inventory"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/ratelimit"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
)

func (s *Server) setRateLimitHeaders(c *gin.Context, limit, remaining int, resetAt time.Time) {
	c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
	c.Header("X-RateLimit-Remaining", strconv.Itoa(max(remaining, 0)))
	c.Header("X-RateLimit-Reset", strconv.FormatInt(resetAt.Unix(), 10))
}

func (s *Server) allowRate(ctx context.Context, credential string, limit int) (bool, int) {
	return ratelimit.NewFixedWindow(s.redis).Allow(ctx, credential, limit)
}

func (s *Server) transition(c *gin.Context, shop, orderID, target, cancellationReason string) error {
	return s.orders.Transition(c, shop, orderID, target, cancellationReason)
}

func (s *Server) transitionTx(ctx context.Context, tx pgx.Tx, shop, orderID, target, cancellationReason string) error {
	var status, provider, paymentStatus string
	var paymentExpiry *time.Time
	err := tx.QueryRow(ctx, `SELECT o.status,s.provider_profile,o.payment_status,o.payment_expires_at FROM orders o JOIN shops s ON s.id=o.shop_id WHERE o.id=$1 AND o.shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &provider, &paymentStatus, &paymentExpiry)
	if err != nil {
		return err
	}
	if !orders.CanTransition(status, target) {
		return fmt.Errorf("cannot transition from %s to %s", status, target)
	}
	if target == orders.Paid && (paymentStatus != "PENDING" || paymentExpiry != nil && time.Now().After(*paymentExpiry)) {
		return fmt.Errorf("payment is no longer pending")
	}
	paymentReference := ""
	if target == orders.Paid {
		paymentReference = "SIM-PAY-" + strings.ToUpper(platform.NewID(""))[1:]
	}
	if _, err = tx.Exec(ctx, `UPDATE orders SET status=$1,payment_reference=CASE WHEN $1='PAID' THEN $2 ELSE payment_reference END,paid_at=CASE WHEN $1='PAID' THEN now() ELSE paid_at END,payment_status=CASE WHEN $1='PAID' THEN 'PAID' ELSE payment_status END,seller_deadline_at=CASE WHEN $1='PAID' AND $3='SHOPEE_LIKE' THEN now()+($4 * interval '1 second') ELSE seller_deadline_at END,updated_at=now() WHERE id=$5`, target, paymentReference, provider, int(s.sellerSLA().Seconds()), orderID); err != nil {
		return fmt.Errorf("update order: %w", err)
	}
	if target == orders.Paid {
		if err = inventory.Commit(ctx, tx, orderID); err != nil {
			return fmt.Errorf("commit inventory reservation: %w", err)
		}
	}
	payload := gin.H{"id": orderID, "status": target}
	if paymentReference != "" {
		payload["payment"] = gin.H{"status": "PAID", "reference": paymentReference}
	}
	if cancellationReason != "" {
		payload["cancellation_reason"] = cancellationReason
	}
	if err = events.Record(ctx, tx, shop, "order."+strings.ToLower(target), orderID, payload); err != nil {
		return err
	}
	return nil
}

func (s *Server) orderAction(c *gin.Context) {
	id := c.Param("id")
	var shop string
	err := s.db.QueryRow(c, `SELECT shop_id FROM orders WHERE id=$1`, id).Scan(&shop)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	if strings.EqualFold(c.Param("action"), "PAYMENT_FAILED") {
		s.failPayment(c, shop, id, "SIMULATED_PAYMENT_FAILURE")
		return
	}
	if strings.EqualFold(c.Param("action"), "CANCEL") {
		var input struct {
			Actor  string `json:"actor"`
			Reason string `json:"reason"`
		}
		if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
			c.JSON(400, errorBody("INVALID_REQUEST", "cancellation requires a JSON actor and reason"))
			return
		}
		// Preserve legacy empty requests; the console always submits both fields.
		if input.Actor == "" && input.Reason == "" {
			input.Actor, input.Reason = orders.Seller, "OUT_OF_STOCK"
		}
		input.Actor, input.Reason = strings.ToUpper(strings.TrimSpace(input.Actor)), strings.ToUpper(strings.TrimSpace(input.Reason))
		if input.Actor != orders.Customer && input.Actor != orders.Seller {
			c.JSON(400, errorBody("INVALID_REQUEST", "actor must be CUSTOMER or SELLER; simulate payment failure or wait for deadlines for SYSTEM cancellation"))
			return
		}
		s.cancelResponse(c, shop, id, input.Actor, input.Reason)
		return
	}
	targets := map[string]string{"PAY": orders.Paid, "PROCESS": orders.Processing, "READY_TO_SHIP": orders.ReadyToShip, "COMPLETE": orders.Completed}
	target, ok := targets[strings.ToUpper(c.Param("action"))]
	if !ok {
		c.JSON(400, errorBody("INVALID_ACTION", "unsupported order action"))
		return
	}
	if err := s.transition(c, shop, id, target, ""); err != nil {
		c.JSON(400, errorBody("INVALID_TRANSITION", err.Error()))
		return
	}
	c.JSON(200, gin.H{"id": id, "status": "updated"})
}

func (s *Server) failPayment(c *gin.Context, shop, orderID, reason string) {
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start payment failure"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, paymentStatus string
	if err = tx.QueryRow(c, `SELECT status,payment_status FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &paymentStatus); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if status != orders.Unpaid || paymentStatus != "PENDING" {
		c.JSON(400, errorBody("INVALID_TRANSITION", "payment can only fail while the order is unpaid"))
		return
	}
	if _, err = tx.Exec(c, `UPDATE orders SET status='CANCELLED',payment_status='FAILED',payment_failed_at=now(),payment_failure_reason=$1,cancellation_actor='SYSTEM',cancellation_reason='PAYMENT_FAILED',updated_at=now() WHERE id=$2`, reason, orderID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not record failed payment"))
		return
	}
	if err = inventory.Release(c, tx, orderID); err != nil {
		c.JSON(500, errorBody("INVENTORY_ERROR", "could not release reserved stock"))
		return
	}
	if err = events.Record(c, tx, shop, "order.payment_failed", orderID, gin.H{"id": orderID, "reason": reason}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not record payment failure"))
		return
	}
	if err = events.Record(c, tx, shop, "order.cancelled", orderID, gin.H{"id": orderID, "status": orders.Cancelled, "cancellation_actor": orders.System, "cancellation_reason": "PAYMENT_FAILED"}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not record cancellation"))
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit payment failure"))
		return
	}
	c.JSON(200, gin.H{"id": orderID, "status": orders.Cancelled, "payment_status": "FAILED"})
}

func (s *Server) paymentExpiry() time.Duration {
	if s.cfg.PaymentExpiry > 0 {
		return s.cfg.PaymentExpiry
	}
	return 30 * time.Minute
}
func (s *Server) sellerSLA() time.Duration {
	if s.cfg.SellerSLA > 0 {
		return s.cfg.SellerSLA
	}
	return 48 * time.Hour
}

func (s *Server) shipmentAction(c *gin.Context) {
	id := c.Param("id")
	var shop string
	if err := s.db.QueryRow(c, `SELECT o.shop_id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1`, id).Scan(&shop); err != nil {
		c.JSON(http.StatusNotFound, errorBody("NOT_FOUND", "shipment not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "invalid shipment action request"))
		return
	}
	targets := map[string]struct{ shipment, order string }{
		"SHIP": {"SHIPPED", orders.Shipped}, "IN_DELIVERY": {"IN_DELIVERY", orders.InDelivery}, "DELIVER": {"DELIVERED", orders.Delivered},
		"DELIVERY_FAILED": {"DELIVERY_FAILED", ""}, "RETURN_TO_SENDER": {"RETURNING", ""}, "COMPLETE_RETURN": {"RETURNED", orders.Returned},
	}
	target, ok := targets[strings.ToUpper(c.Param("action"))]
	if !ok {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_ACTION", "unsupported shipment action"))
		return
	}
	if target.shipment == "DELIVERY_FAILED" && strings.TrimSpace(input.Reason) == "" {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "delivery failure reason is required"))
		return
	}
	if err := s.transitionShipment(c, shop, id, target.shipment, target.order, strings.TrimSpace(input.Reason)); err != nil {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_TRANSITION", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "status": target.shipment})
}

func (s *Server) transitionShipment(c *gin.Context, shop, shipmentID, shipmentTarget, orderTarget, failureReason string) error {
	tx, err := s.db.Begin(c)
	if err != nil {
		return fmt.Errorf("start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(c) }()
	var orderID, packageID, shipmentStatus, orderStatus string
	if err = tx.QueryRow(c, `SELECT s.order_id,COALESCE(s.package_id,''),s.status,o.status FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1 AND o.shop_id=$2 FOR UPDATE`, shipmentID, shop).Scan(&orderID, &packageID, &shipmentStatus, &orderStatus); err != nil {
		return err
	}
	expected := map[string]string{"SHIPPED": "CREATED", "IN_DELIVERY": "SHIPPED", "DELIVERED": "IN_DELIVERY", "DELIVERY_FAILED": "IN_DELIVERY", "RETURNING": "DELIVERY_FAILED", "RETURNED": "RETURNING"}
	if expected[shipmentTarget] != shipmentStatus {
		return fmt.Errorf("cannot transition shipment from %s to %s", shipmentStatus, shipmentTarget)
	}
	// Failure and return-in-progress are package-level states. The linked order
	// remains IN_DELIVERY until every package has reached its final return state.
	transitionOrder := orderTarget != "" && orderStatus != orderTarget
	if shipmentTarget == "DELIVERED" || shipmentTarget == "RETURNED" {
		var outstanding int
		if err = tx.QueryRow(c, `SELECT count(*) FROM shipments WHERE order_id=$1 AND status NOT IN ('DELIVERED','RETURNED')`, orderID).Scan(&outstanding); err != nil {
			return err
		}
		transitionOrder = outstanding == 1 && orderStatus != orderTarget
	}
	expectedOrder := map[string]string{"SHIPPED": orders.ReadyToShip, "IN_DELIVERY": orders.Shipped, "DELIVERED": orders.InDelivery, "RETURNED": orders.InDelivery}[shipmentTarget]
	if transitionOrder && orderStatus != expectedOrder {
		orderRank := map[string]int{orders.ReadyToShip: 1, orders.Shipped: 2, orders.InDelivery: 3, orders.Delivered: 4}
		if orderRank[orderStatus] > orderRank[orderTarget] {
			transitionOrder = false
		} else {
			return fmt.Errorf("cannot update package while order is %s", orderStatus)
		}
	}
	if shipmentTarget == "SHIPPED" {
		if packageID == "" {
			return fmt.Errorf("shipment does not have a fulfillment package")
		}
		if err = inventory.FulfillPackage(c, tx, packageID); err != nil {
			return fmt.Errorf("fulfill package inventory: %w", err)
		}
	}
	if _, err = tx.Exec(c, `UPDATE shipments SET status=$1,delivery_failure_reason=CASE WHEN $1='DELIVERY_FAILED' THEN $2 ELSE delivery_failure_reason END,shipped_at=CASE WHEN $1='SHIPPED' THEN now() ELSE shipped_at END,delivered_at=CASE WHEN $1='DELIVERED' THEN now() ELSE delivered_at END,failed_at=CASE WHEN $1='DELIVERY_FAILED' THEN now() ELSE failed_at END,returning_at=CASE WHEN $1='RETURNING' THEN now() ELSE returning_at END,returned_at=CASE WHEN $1='RETURNED' THEN now() ELSE returned_at END WHERE id=$3`, shipmentTarget, failureReason, shipmentID); err != nil {
		return fmt.Errorf("update shipment: %w", err)
	}
	if packageID != "" {
		if _, err = tx.Exec(c, `UPDATE packages SET status=$1,updated_at=now() WHERE id=$2`, shipmentTarget, packageID); err != nil {
			return fmt.Errorf("update package: %w", err)
		}
	}
	if transitionOrder {
		if err = s.transitionTx(c, tx, shop, orderID, orderTarget, ""); err != nil {
			return err
		}
	}
	shipmentEvent := map[string]string{"DELIVERY_FAILED": "shipment.delivery_failed", "RETURNING": "shipment.returning", "RETURNED": "shipment.returned"}[shipmentTarget]
	if shipmentEvent != "" {
		payload := gin.H{"id": shipmentID, "order_id": orderID, "status": shipmentTarget}
		if failureReason != "" {
			payload["reason"] = failureReason
		}
		if err = events.Record(c, tx, shop, shipmentEvent, shipmentID, payload); err != nil {
			return err
		}
	}
	if err = tx.Commit(c); err != nil {
		return fmt.Errorf("commit shipment transition: %w", err)
	}
	return nil
}

func (s *Server) retryDelivery(c *gin.Context) {
	id := c.Param("id")
	var shop string
	if err := s.db.QueryRow(c, `SELECT w.shop_id FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=$1`, id).Scan(&shop); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "delivery not found"))
		return
	}
	// Resolve authorization before holding a transaction connection: operator
	// authorization can itself query the pool.
	if !s.mustAccessShop(c, shop) {
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not schedule retry"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	var deleted bool
	err = tx.QueryRow(c, `SELECT w.deleted_at IS NOT NULL FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=$1 AND w.shop_id=$2 FOR SHARE OF w`, id, shop).Scan(&deleted)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "delivery not found"))
		return
	}
	if deleted {
		c.JSON(409, errorBody("WEBHOOK_DELETED", "This webhook was deleted. Register a new callback and replay the event instead."))
		return
	}
	_, err = tx.Exec(c, `UPDATE webhook_deliveries SET status='PENDING',next_attempt_at=now(),leased_until=NULL WHERE id=$1`, id)
	if err == nil {
		err = tx.Commit(c)
	}
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not schedule retry"))
		return
	}
	c.Status(202)
}
func (s *Server) replayEvent(c *gin.Context) {
	id := c.Param("id")
	var shop string
	err := s.db.QueryRow(c, `SELECT shop_id FROM domain_events WHERE id=$1`, id).Scan(&shop)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "event not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	// An outbox row is unique per durable event. Resetting its publication marker lets
	// the worker fan the same event ID out again without violating that invariant.
	command, err := s.db.Exec(c, `UPDATE outbox SET published_at=NULL WHERE event_id=$1`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not replay event"))
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(500, errorBody("DATABASE_ERROR", "event is missing its outbox record"))
		return
	}
	c.Status(202)
}

func (s *Server) duplicateEvent(c *gin.Context) {
	s.createManualEventDeliveries(c, 2, 0)
}

func (s *Server) delayEvent(c *gin.Context) {
	var input struct {
		DelaySeconds int `json:"delay_seconds"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.DelaySeconds <= 0 || input.DelaySeconds > 86400 {
		c.JSON(400, errorBody("INVALID_REQUEST", "delay_seconds must be between 1 and 86400"))
		return
	}
	s.createManualEventDeliveries(c, 1, input.DelaySeconds)
}

func (s *Server) createManualEventDeliveries(c *gin.Context, copies, delaySeconds int) {
	eventID := c.Param("id")
	var shop string
	if err := s.db.QueryRow(c, `SELECT shop_id FROM domain_events WHERE id=$1`, eventID).Scan(&shop); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "event not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not begin debug delivery"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	rows, err := tx.Query(c, `SELECT id FROM webhooks WHERE shop_id=$1 AND enabled=true AND deleted_at IS NULL AND subscribed_events ? (SELECT event_type FROM domain_events WHERE id=$2) FOR SHARE`, shop, eventID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load matching webhooks"))
		return
	}
	defer rows.Close()
	webhooks := make([]string, 0)
	for rows.Next() {
		var webhookID string
		if err := rows.Scan(&webhookID); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read matching webhook"))
			return
		}
		webhooks = append(webhooks, webhookID)
	}
	if err := rows.Err(); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not iterate matching webhooks"))
		return
	}
	created := 0
	for _, webhookID := range webhooks {
		for copyNumber := 0; copyNumber < copies; copyNumber++ {
			if _, err := tx.Exec(c, `INSERT INTO webhook_deliveries(id,webhook_id,event_id,next_attempt_at) VALUES($1,$2,$3,now()+($4 * interval '1 second'))`, platform.NewID("del"), webhookID, eventID, delaySeconds); err != nil {
				c.JSON(500, errorBody("DATABASE_ERROR", "could not create debug delivery"))
				return
			}
			created++
		}
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit debug delivery"))
		return
	}
	c.JSON(202, gin.H{"event_id": eventID, "deliveries_created": created, "delay_seconds": delaySeconds})
}

func (s *Server) items(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT id,product_id,sku,product_name,price,quantity,subtotal,COALESCE((SELECT sum(pi.quantity) FROM package_items pi WHERE pi.order_item_id=oi.id),0) FROM order_items oi WHERE order_id=$1`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, sku, name string
		var product *string
		var price, sub int64
		var quantity, allocated int
		if rows.Scan(&id, &product, &sku, &name, &price, &quantity, &sub, &allocated) == nil {
			data = append(data, gin.H{"id": id, "product_id": product, "sku": sku, "product_name": name, "price": price, "quantity": quantity, "subtotal": sub, "allocated_quantity": allocated, "remaining_quantity": quantity - allocated})
		}
	}
	return data
}

func (s *Server) packagesForOrder(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT id,id,status,created_at,updated_at FROM packages WHERE order_id=$1 ORDER BY created_at`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, number, status string
		var created, updated time.Time
		if err := rows.Scan(&id, &number, &status, &created, &updated); err == nil {
			data = append(data, gin.H{"package_id": id, "package_number": number, "package_status": status, "create_time": created.Unix(), "update_time": updated.Unix()})
		}
	}
	return data
}

func (s *Server) shipmentsForOrder(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT id,package_id,tracking_number,shipping_provider,pickup_type,status,delivery_failure_reason,created_at,shipped_at,delivered_at,failed_at,returning_at,returned_at FROM shipments WHERE order_id=$1 ORDER BY created_at,id`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	shipments := []gin.H{}
	for rows.Next() {
		var id, packageID, tracking, provider, pickupType, status string
		var failureReason *string
		var created time.Time
		var shipped, delivered, failed, returningAt, returned *time.Time
		if err := rows.Scan(&id, &packageID, &tracking, &provider, &pickupType, &status, &failureReason, &created, &shipped, &delivered, &failed, &returningAt, &returned); err != nil {
			return []gin.H{}
		}
		shipments = append(shipments, gin.H{"id": id, "package_id": packageID, "order_id": orderID, "tracking_number": tracking, "shipping_provider": provider, "pickup_type": pickupType, "status": status, "delivery_failure_reason": failureReason, "created_at": created, "shipped_at": shipped, "delivered_at": delivered, "failed_at": failed, "returning_at": returningAt, "returned_at": returned})
	}
	return shipments
}

// fulfillmentForOrder returns the selected warehouse without exposing its full
// stock ledger in an order response.
func (s *Server) fulfillmentForOrder(ctx context.Context, orderID string) gin.H {
	var id, code, name, status string
	err := s.db.QueryRow(ctx, `SELECT w.id,w.code,w.name,w.status FROM orders o JOIN warehouses w ON w.id=o.fulfillment_warehouse_id WHERE o.id=$1`, orderID).Scan(&id, &code, &name, &status)
	if err != nil {
		return nil
	}
	return gin.H{"warehouse_id": id, "warehouse_code": code, "warehouse_name": name, "warehouse_status": status}
}

func shipmentControlData(id, orderID, orderNumber, tracking, provider, pickupType, status string, created time.Time, shipped, delivered *time.Time) gin.H {
	return gin.H{
		"id":                id,
		"order_id":          orderID,
		"order_number":      orderNumber,
		"tracking_number":   tracking,
		"shipping_provider": provider,
		"pickup_type":       pickupType,
		"status":            status,
		"created_at":        created,
		"shipped_at":        shipped,
		"delivered_at":      delivered,
	}
}

func (s *Server) orderOperations(ctx context.Context, orderID string) gin.H {
	var provider, paymentStatus, status string
	var paymentExpiry, paymentFailed, sellerDeadline *time.Time
	var paymentFailure, cancellationActor, cancellationReason *string
	err := s.db.QueryRow(ctx, `SELECT sh.provider_profile,o.payment_status,o.status,o.payment_expires_at,o.payment_failed_at,o.seller_deadline_at,o.payment_failure_reason,o.cancellation_actor,o.cancellation_reason FROM orders o JOIN shops sh ON sh.id=o.shop_id WHERE o.id=$1`, orderID).Scan(&provider, &paymentStatus, &status, &paymentExpiry, &paymentFailed, &sellerDeadline, &paymentFailure, &cancellationActor, &cancellationReason)
	if err != nil {
		return gin.H{}
	}
	actions, cancellations := orders.ConsoleActions(orders.LifecycleState{Status: status, Provider: provider, PaymentStatus: paymentStatus, PaymentExpires: paymentExpiry, SellerDeadline: sellerDeadline}, time.Now())
	providerStatus := status
	if provider == orders.TokopediaLike {
		providerStatus = tokopedia.OrderStatus(status)
	}
	return gin.H{"available_actions": actions, "cancellation_options": cancellations, "provider_status": providerStatus, "provider_profile": provider, "payment_status": paymentStatus, "payment_expires_at": paymentExpiry, "payment_failed_at": paymentFailed, "payment_failure_reason": paymentFailure, "seller_deadline_at": sellerDeadline, "cancellation_actor": cancellationActor, "cancellation_reason": cancellationReason}
}

func paymentInfo(reference *string, paidAt *time.Time) gin.H {
	if paidAt == nil {
		return gin.H{"status": "UNPAID", "reference": nil, "paid_at": nil}
	}
	return gin.H{"status": "PAID", "reference": reference, "paid_at": paidAt}
}

func (s *Server) events(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT id,event_type,occurred_at,payload,aggregate_id,split_part(event_type,'.',1) FROM domain_events WHERE aggregate_id=$1 OR aggregate_id IN (SELECT id FROM shipments WHERE order_id=$1) ORDER BY occurred_at,id`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, typ, aggregate, resource string
		var at time.Time
		var payload []byte
		if rows.Scan(&id, &typ, &at, &payload, &aggregate, &resource) == nil {
			data = append(data, gin.H{"id": id, "event_type": typ, "occurred_at": at, "payload": json.RawMessage(payload), "aggregate_id": aggregate, "aggregate_type": resource})
		}
	}
	return data
}
func (s *Server) deliveriesForOrder(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT d.id,d.event_id,d.status,d.attempt_count FROM webhook_deliveries d JOIN domain_events e ON e.id=d.event_id WHERE e.aggregate_id=$1 OR e.aggregate_id IN (SELECT id FROM shipments WHERE order_id=$1) ORDER BY d.created_at,d.id`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, event, status string
		var attempts int
		if rows.Scan(&id, &event, &status, &attempts) == nil {
			data = append(data, gin.H{"id": id, "event_id": event, "status": status, "attempt_count": attempts})
		}
	}
	return data
}

// controlPackagesForOrder exposes allocation contents without changing provider projections.
func (s *Server) controlPackagesForOrder(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT p.id,p.status,COALESCE(p.warehouse_id,''),COALESCE((SELECT jsonb_agg(jsonb_build_object('id',oi.id,'sku',oi.sku,'product_name',oi.product_name,'quantity',pi.quantity) ORDER BY oi.id) FROM package_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE pi.package_id=p.id),'[]'::jsonb) FROM packages p WHERE p.order_id=$1 ORDER BY p.created_at,p.id`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	result := []gin.H{}
	for rows.Next() {
		var id, status, warehouse string
		var items []byte
		if err := rows.Scan(&id, &status, &warehouse, &items); err != nil {
			return []gin.H{}
		}
		result = append(result, gin.H{"id": id, "status": status, "warehouse_id": warehouse, "items": json.RawMessage(items)})
	}
	return result
}
func (s *Server) shipmentsForPackage(ctx context.Context, orderID, packageID string) []gin.H {
	result := []gin.H{}
	for _, shipment := range s.shipmentsForOrder(ctx, orderID) {
		if shipment["package_id"] == packageID {
			result = append(result, shipment)
		}
	}
	return result
}
