package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/events"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/inventory"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	dummygenerator "github.com/enrico/enterprise-integration-simulator/packages/dummy-generator"
)

func (s *Server) shopOrders(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.store.ListOrdersForShop(c, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list orders"))
		return
	}
	data := []gin.H{}
	for _, row := range rows {
		data = append(data, gin.H{"id": row.ID, "order_number": row.OrderNumber, "total_amount": row.TotalAmount, "status": row.Status, "created_at": row.CreatedAt.Time, "updated_at": row.UpdatedAt.Time})
	}
	s.controlListResponse(c, data)
}

// shopShipments lists the fulfillment records owned by one shop. Shipments are
// joined to their orders so the control plane can show the operational context
// without exposing data from another shop.
func (s *Server) shopShipments(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT s.id,s.order_id,o.order_number,s.tracking_number,s.shipping_provider,s.pickup_type,s.status,s.created_at,s.shipped_at,s.delivered_at FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.shop_id=$1 ORDER BY s.created_at DESC`, shop)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not list shipments"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, orderID, orderNumber, tracking, provider, pickupType, status string
		var created time.Time
		var shipped, delivered *time.Time
		if err := rows.Scan(&id, &orderID, &orderNumber, &tracking, &provider, &pickupType, &status, &created, &shipped, &delivered); err != nil {
			c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not read shipment"))
			return
		}
		data = append(data, shipmentControlData(id, orderID, orderNumber, tracking, provider, pickupType, status, created, shipped, delivered))
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not read shipments"))
		return
	}
	s.controlListResponse(c, data)
}

func (s *Server) shopPackages(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT p.id,p.order_id,o.order_number,p.status,p.created_at,COUNT(pi.order_item_id),COALESCE(w.code,''),COALESCE(w.name,'') FROM packages p JOIN orders o ON o.id=p.order_id LEFT JOIN package_items pi ON pi.package_id=p.id LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE o.shop_id=$1 GROUP BY p.id,o.order_number,w.code,w.name ORDER BY p.created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list packages"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, orderID, number, status, warehouseCode, warehouseName string
		var created time.Time
		var count int
		if err := rows.Scan(&id, &orderID, &number, &status, &created, &count, &warehouseCode, &warehouseName); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read package"))
			return
		}
		data = append(data, gin.H{"id": id, "order_id": orderID, "order_number": number, "status": status, "item_count": count, "warehouse_code": warehouseCode, "warehouse_name": warehouseName, "created_at": created})
	}
	s.controlListResponse(c, data)
}

func (s *Server) packageDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, orderID, status, warehouseID, warehouseCode, warehouseName string
	var created time.Time
	if err := s.db.QueryRow(c, `SELECT o.shop_id,p.order_id,p.status,p.created_at,COALESCE(w.id,''),COALESCE(w.code,''),COALESCE(w.name,'') FROM packages p JOIN orders o ON o.id=p.order_id LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE p.id=$1`, id).Scan(&shop, &orderID, &status, &created, &warehouseID, &warehouseCode, &warehouseName); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "package not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT oi.id,oi.sku,oi.product_name,pi.quantity FROM package_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE pi.package_id=$1`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read package items"))
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var itemID, sku, name string
		var quantity int
		if err := rows.Scan(&itemID, &sku, &name, &quantity); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read package item"))
			return
		}
		items = append(items, gin.H{"id": itemID, "sku": sku, "product_name": name, "quantity": quantity})
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "order_id": orderID, "status": status, "warehouse": gin.H{"warehouse_id": warehouseID, "warehouse_code": warehouseCode, "warehouse_name": warehouseName}, "created_at": created, "items": items})
}

func (s *Server) createControlPackage(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var input struct {
		OrderID string `json:"order_id"`
		Items   []struct {
			OrderItemID string `json:"order_item_id"`
			Quantity    int    `json:"quantity"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.OrderID == "" || len(input.Items) == 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "order_id and items are required"))
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start package"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, warehouseID string
	if err = tx.QueryRow(c, `SELECT status,COALESCE(fulfillment_warehouse_id,'') FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, input.OrderID, shop).Scan(&status, &warehouseID); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if status != orders.ReadyToShip {
		c.JSON(400, errorBody("INVALID_TRANSITION", "packages require READY_TO_SHIP"))
		return
	}
	if warehouseID == "" {
		c.JSON(400, errorBody("INVALID_TRANSITION", "order does not have a fulfillment warehouse"))
		return
	}
	packageID := platform.NewID("pkg")
	if _, err = tx.Exec(c, `INSERT INTO packages(id,order_id,warehouse_id) VALUES($1,$2,$3)`, packageID, input.OrderID, warehouseID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create package"))
		return
	}
	for _, item := range input.Items {
		var available int
		if err = tx.QueryRow(c, `SELECT oi.quantity-COALESCE((SELECT sum(quantity) FROM package_items WHERE order_item_id=oi.id),0) FROM order_items oi WHERE oi.id=$1 AND oi.order_id=$2`, item.OrderItemID, input.OrderID).Scan(&available); err != nil || item.Quantity < 1 || item.Quantity > available {
			c.JSON(400, errorBody("INVALID_REQUEST", "invalid package item quantity"))
			return
		}
		if _, err = tx.Exec(c, `INSERT INTO package_items(package_id,order_item_id,quantity) VALUES($1,$2,$3)`, packageID, item.OrderItemID, item.Quantity); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not allocate item"))
			return
		}
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit package"))
		return
	}
	c.JSON(201, gin.H{"id": packageID, "order_id": input.OrderID, "status": "READY_TO_SHIP", "item_count": len(input.Items)})
}

// shipmentDetail returns a control-plane view of one shipment and its linked
// order. It uses dashboard authorization rather than public API credentials.
func (s *Server) shipmentDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, orderID, orderNumber, tracking, provider, pickupType, status, orderStatus string
	var created time.Time
	var shipped, delivered, failed, returning, returned *time.Time
	var failureReason *string
	err := s.db.QueryRow(c, `SELECT o.shop_id,s.order_id,o.order_number,s.tracking_number,s.shipping_provider,s.pickup_type,s.status,s.created_at,s.shipped_at,s.delivered_at,o.status,s.delivery_failure_reason,s.failed_at,s.returning_at,s.returned_at FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1`, id).Scan(&shop, &orderID, &orderNumber, &tracking, &provider, &pickupType, &status, &created, &shipped, &delivered, &orderStatus, &failureReason, &failed, &returning, &returned)
	if err != nil {
		c.JSON(http.StatusNotFound, errorBody("NOT_FOUND", "shipment not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	out := shipmentControlData(id, orderID, orderNumber, tracking, provider, pickupType, status, created, shipped, delivered)
	out["shop_id"] = shop
	out["order_status"] = orderStatus
	out["delivery_failure_reason"] = failureReason
	out["failed_at"] = failed
	out["returning_at"] = returning
	out["returned_at"] = returned
	c.JSON(http.StatusOK, out)
}

// createSimulatedOrder is a control-plane customer-order generator. It emits a durable order.created event.
func (s *Server) createSimulatedOrder(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var input struct {
		Items []struct {
			ProductID string `json:"product_id"`
			Quantity  int    `json:"quantity"`
		} `json:"items"`
		Customer        map[string]any `json:"customer"`
		ShippingAddress map[string]any `json:"shipping_address"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid simulated order"))
		return
	}
	if len(input.Items) == 0 {
		var productID string
		if err := s.db.QueryRow(c, `SELECT id FROM products WHERE shop_id=$1 AND status='ACTIVE' AND stock>0 ORDER BY random() LIMIT 1`, shop).Scan(&productID); err != nil {
			c.JSON(400, errorBody("NO_PRODUCTS", "an active product is required"))
			return
		}
		input.Items = append(input.Items, struct {
			ProductID string `json:"product_id"`
			Quantity  int    `json:"quantity"`
		}{ProductID: productID, Quantity: 1})
	}
	if input.Customer == nil {
		dummy := dummygenerator.New(time.Now().UnixNano())
		customer := dummy.Customer()
		input.Customer = map[string]any{"name": customer.Name, "phone": customer.Phone}
	}
	if input.ShippingAddress == nil {
		dummy := dummygenerator.New(time.Now().UnixNano() + 1)
		address := dummy.IndonesianAddress()
		input.ShippingAddress = map[string]any{"address_line": address.AddressLine, "city": address.City, "postal_code": address.PostalCode}
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start order"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	orderID, total := platform.NewID("ord"), int64(0)
	customer, err := json.Marshal(input.Customer)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode customer"))
		return
	}
	address, err := json.Marshal(input.ShippingAddress)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode shipping address"))
		return
	}
	number := "SIM-" + strings.ToUpper(platform.NewID(""))[1:]
	if _, err := tx.Exec(c, `INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status,payment_expires_at) VALUES($1,$2,$3,$4,$5,0,'UNPAID','PENDING',now()+($6 * interval '1 second'))`, orderID, number, shop, customer, address, int(s.paymentExpiry().Seconds())); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create order"))
		return
	}
	reservationLines := make([]inventory.Line, 0, len(input.Items))
	for _, item := range input.Items {
		if item.Quantity <= 0 {
			c.JSON(400, errorBody("INVALID_REQUEST", "item quantity must be positive"))
			return
		}
		var sku, name string
		var price int64
		if err := tx.QueryRow(c, `SELECT sku,name,price FROM products WHERE id=$1 AND shop_id=$2 AND status='ACTIVE'`, item.ProductID, shop).Scan(&sku, &name, &price); err != nil {
			c.JSON(400, errorBody("INVALID_ITEM", "product unavailable or insufficient stock"))
			return
		}
		subtotal := price * int64(item.Quantity)
		total += subtotal
		orderItemID := platform.NewID("item")
		if _, err := tx.Exec(c, `INSERT INTO order_items(id,order_id,product_id,sku,product_name,price,quantity,subtotal) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, orderItemID, orderID, item.ProductID, sku, name, price, item.Quantity, subtotal); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not create order item"))
			return
		}
		reservationLines = append(reservationLines, inventory.Line{OrderItemID: orderItemID, ProductID: item.ProductID, Quantity: item.Quantity})
	}
	warehouse, err := inventory.Allocate(c, tx, shop, orderID, reservationLines)
	if err != nil {
		if errors.Is(err, inventory.ErrNoEligibleWarehouse) {
			c.JSON(400, errorBody("INSUFFICIENT_WAREHOUSE_INVENTORY", "no active warehouse can fulfill all order items"))
			return
		}
		c.JSON(500, errorBody("INVENTORY_ERROR", "could not reserve warehouse inventory"))
		return
	}
	if _, err := tx.Exec(c, `UPDATE orders SET total_amount=$1 WHERE id=$2`, total, orderID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not set order total"))
		return
	}
	if err := events.Record(c, tx, shop, "order.created", orderID, gin.H{"id": orderID, "order_number": number, "status": orders.Unpaid, "total_amount": total, "fulfillment_warehouse_id": warehouse.ID}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not create event"))
		return
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit order"))
		return
	}
	c.JSON(201, gin.H{"id": orderID, "order_number": number, "status": orders.Unpaid, "total_amount": total, "fulfillment": gin.H{"warehouse_id": warehouse.ID, "warehouse_code": warehouse.Code, "warehouse_name": warehouse.Name}})
}

func (s *Server) createCredential(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	secret := platform.NewID("sec")
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, secret)
	if err != nil {
		c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect secret"))
		return
	}
	accessToken := platform.NewID("acc")
	tokenCipher, err := platform.Encrypt(s.cfg.EncryptionKey, accessToken)
	if err != nil {
		c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect access token"))
		return
	}
	id, clientID := platform.NewID("cred"), platform.NewID("client")
	_, err = s.db.Exec(c, `INSERT INTO credentials(id,shop_id,client_id,secret_ciphertext,access_token_ciphertext) VALUES($1,$2,$3,$4,$5)`, id, shop, clientID, cipher, tokenCipher)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create credential"))
		return
	}
	c.JSON(201, gin.H{"id": id, "shop_id": shop, "client_id": clientID, "client_secret": secret, "access_token": accessToken, "status": "ACTIVE"})
}

func (s *Server) listCredentials(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT id,client_id,status,created_at,revoked_at FROM credentials WHERE shop_id=$1 ORDER BY created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list credentials"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, clientID, status string
		var created time.Time
		var revoked *time.Time
		if err := rows.Scan(&id, &clientID, &status, &created, &revoked); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read credential"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": shop, "client_id": clientID, "status": status, "created_at": created, "revoked_at": revoked})
	}
	s.controlListResponse(c, data)
}

func (s *Server) revokeCredential(c *gin.Context) {
	id := c.Param("id")
	shop, err := s.store.GetCredentialShop(c, id)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "credential not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	_, err = s.store.RevokeCredential(c, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not revoke credential"))
		return
	}
	c.Status(204)
}

func (s *Server) orderDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, num, status string
	var total int64
	var customer, address []byte
	var paymentReference *string
	var paidAt *time.Time
	var created, updated time.Time
	err := s.db.QueryRow(c, `SELECT shop_id,order_number,customer_data,shipping_address,total_amount,status,payment_reference,paid_at,created_at,updated_at FROM orders WHERE id=$1`, id).Scan(&shop, &num, &customer, &address, &total, &status, &paymentReference, &paidAt, &created, &updated)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	shipments := s.shipmentsForOrder(c, id)
	var primaryShipment gin.H
	if len(shipments) > 0 {
		primaryShipment = shipments[0]
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "order_number": num, "customer_data": json.RawMessage(customer), "shipping_address": json.RawMessage(address), "total_amount": total, "status": status, "payment": paymentInfo(paymentReference, paidAt), "operations": s.orderOperations(c, id), "fulfillment": s.fulfillmentForOrder(c, id), "created_at": created, "updated_at": updated, "items": s.items(c, id), "shipment": primaryShipment, "shipments": shipments, "events": s.events(c, id), "deliveries": s.deliveriesForOrder(c, id)})
}
