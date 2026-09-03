package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
)

func (s *Server) shopeeListOrders(c *gin.Context) {
	client := currentClient(c)
	pageNo, pageSize := 1, 20
	var err error
	if raw := c.Query("page_no"); raw != "" {
		pageNo, err = strconv.Atoi(raw)
		if err != nil || pageNo < 1 {
			s.shopeeError(c, 400, "error_param", "page_no must be a positive integer")
			return
		}
	}
	if raw := c.Query("page_size"); raw != "" {
		pageSize, err = strconv.Atoi(raw)
		if err != nil || pageSize < 1 || pageSize > 100 {
			s.shopeeError(c, 400, "error_param", "page_size must be between 1 and 100")
			return
		}
	}
	args := []any{client.ShopID}
	where := "shop_id=$1"
	if status := c.Query("order_status"); status != "" {
		args = append(args, strings.ToUpper(status))
		where += fmt.Sprintf(" AND status=$%d", len(args))
	}
	if raw := c.Query("time_from"); raw != "" {
		value, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			s.shopeeError(c, 400, "error_param", "time_from must be Unix seconds")
			return
		}
		args = append(args, time.Unix(value, 0))
		where += fmt.Sprintf(" AND created_at >= $%d", len(args))
	}
	if raw := c.Query("time_to"); raw != "" {
		value, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			s.shopeeError(c, 400, "error_param", "time_to must be Unix seconds")
			return
		}
		args = append(args, time.Unix(value, 0))
		where += fmt.Sprintf(" AND created_at <= $%d", len(args))
	}
	var total int
	if err := s.db.QueryRow(c, fmt.Sprintf("SELECT count(*) FROM orders WHERE %s", where), args...).Scan(&total); err != nil {
		s.shopeeError(c, 500, "error_system", "could not list orders")
		return
	}
	args = append(args, pageSize, (pageNo-1)*pageSize)
	rows, err := s.db.Query(c, fmt.Sprintf("SELECT id,order_number,total_amount,status,created_at,updated_at FROM orders WHERE %s ORDER BY created_at DESC,id DESC LIMIT $%d OFFSET $%d", where, len(args)-1, len(args)), args...)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "could not list orders")
		return
	}
	defer rows.Close()
	list := []gin.H{}
	for rows.Next() {
		var id, orderSN, status string
		var totalAmount int64
		var created, updated time.Time
		if err := rows.Scan(&id, &orderSN, &totalAmount, &status, &created, &updated); err != nil {
			s.shopeeError(c, 500, "error_system", "could not read orders")
			return
		}
		list = append(list, gin.H{"order_id": id, "order_sn": orderSN, "total_amount": totalAmount, "order_status": status, "create_time": created.Unix(), "update_time": updated.Unix()})
	}
	s.shopeeSuccess(c, gin.H{"order_list": list, "more": pageNo*pageSize < total, "page_no": pageNo, "page_size": pageSize, "total_count": total})
}

func (s *Server) shopeeGetOrder(c *gin.Context) {
	client := currentClient(c)
	var id, number, status string
	var total int64
	var customer, address []byte
	var created, updated time.Time
	err := s.db.QueryRow(c, `SELECT id,order_number,customer_data,shipping_address,total_amount,status,created_at,updated_at FROM orders WHERE id=$1 AND shop_id=$2`, c.Param("id"), client.ShopID).Scan(&id, &number, &customer, &address, &total, &status, &created, &updated)
	if err != nil {
		s.shopeeError(c, 404, "error_not_found", "order not found")
		return
	}
	var customerData, recipientAddress any
	_ = json.Unmarshal(customer, &customerData)
	_ = json.Unmarshal(address, &recipientAddress)
	s.shopeeSuccess(c, gin.H{"order_id": id, "order_sn": number, "order_status": status, "total_amount": total, "buyer": customerData, "recipient_address": recipientAddress, "create_time": created.Unix(), "update_time": updated.Unix(), "item_list": s.items(c, id), "package_list": s.packagesForOrder(c, id), "shipment_list": s.shipmentsForOrder(c, id)})
}

func (s *Server) shopeeProcessOrder(c *gin.Context)     { s.shopeeTransition(c, orders.Processing) }
func (s *Server) shopeeReadyToShipOrder(c *gin.Context) { s.shopeeTransition(c, orders.ReadyToShip) }

func (s *Server) shopeeTransition(c *gin.Context, target string) {
	client := currentClient(c)
	if err := s.transition(c, client.ShopID, c.Param("id"), target, ""); err != nil {
		s.shopeeError(c, 400, shopeeErrorCode("INVALID_TRANSITION"), err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": target})
}

func (s *Server) shopeeCancelOrder(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		CancelReason string `json:"cancel_reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		s.shopeeError(c, 400, "error_param", "invalid cancellation request")
		return
	}
	reason := strings.ToUpper(strings.TrimSpace(input.CancelReason))
	if !orders.ValidCancellationReason(orders.Customer, reason) {
		s.shopeeError(c, 400, "error_param", "invalid customer cancellation reason")
		return
	}
	if err := s.cancelOrderForActor(c, client.ShopID, c.Param("id"), orders.Customer, reason); err != nil {
		if errors.Is(err, orders.ErrOrderNotFound) {
			s.shopeeError(c, 404, "error_not_found", "order not found")
			return
		}
		s.shopeeError(c, 400, "error_invalid_state", err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": orders.Cancelled, "cancel_reason": reason})
}

func (s *Server) tokopediaCancelOrder(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		s.tokopediaError(c, 400, "invalid cancellation request")
		return
	}
	reason := strings.ToUpper(strings.TrimSpace(input.Reason))
	if !orders.ValidCancellationReason(orders.Customer, reason) {
		s.tokopediaError(c, 400, "invalid customer cancellation reason")
		return
	}
	if err := s.cancelOrderForActor(c, client.ShopID, c.Param("id"), orders.Customer, reason); err != nil {
		s.tokopediaError(c, 36000003, err.Error())
		return
	}
	s.tokopediaSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": tokopedia.OrderStatus(orders.Cancelled), "cancel_reason": reason})
}

func (s *Server) shopeeSuccess(c *gin.Context, response gin.H) {
	c.JSON(http.StatusOK, gin.H{"error": "", "message": "success", "request_id": "req_" + platform.NewID(""), "response": response})
}

func (s *Server) cancelResponse(c *gin.Context, shop, orderID, actor, reason string) {
	if !orders.ValidCancellationReason(actor, reason) {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid cancellation reason for actor"))
		return
	}
	if err := s.cancelOrderForActor(c, shop, orderID, actor, reason); err != nil {
		if errors.Is(err, orders.ErrOrderNotFound) {
			c.JSON(404, errorBody("NOT_FOUND", "order not found"))
			return
		}
		c.JSON(400, errorBody("INVALID_TRANSITION", err.Error()))
		return
	}
	c.JSON(200, gin.H{"id": orderID, "status": orders.Cancelled, "cancellation_actor": actor, "cancellation_reason": reason})
}

// cancelOrderForActor performs the canonical state, inventory, and event update
// behind the provider-specific HTTP contracts and control-plane simulation.
func (s *Server) cancelOrderForActor(ctx context.Context, shop, orderID, actor, reason string) error {
	return s.orders.Cancel(ctx, shop, orderID, actor, reason)
}

type shipmentInput struct {
	ShippingProvider string `json:"shipping_provider"`
	PickupType       string `json:"pickup_type"`
	PackageID        string `json:"package_id"`
}

type packageInput struct {
	OrderItemIDs []string `json:"order_item_ids"`
	Items        []struct {
		OrderItemID string `json:"order_item_id"`
		Quantity    int    `json:"quantity"`
	} `json:"items"`
}

// createPackageForOrder is canonical package allocation used by provider
// adapters. It intentionally has no Generic HTTP surface.
func (s *Server) createPackageForOrder(c *gin.Context, shop, orderID string, input packageInput) (gin.H, error) {
	if len(input.OrderItemIDs) == 0 && len(input.Items) == 0 {
		return nil, fmt.Errorf("items or order_item_ids is required")
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		return nil, fmt.Errorf("start package: %w", err)
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, warehouseID string
	if err = tx.QueryRow(c, `SELECT status,COALESCE(fulfillment_warehouse_id,'') FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &warehouseID); err != nil {
		return nil, fmt.Errorf("order not found: %w", err)
	}
	if status != orders.ReadyToShip {
		return nil, fmt.Errorf("packages can only be allocated for %s orders", orders.ReadyToShip)
	}
	if warehouseID == "" {
		return nil, fmt.Errorf("order does not have a fulfillment warehouse")
	}
	packageID := platform.NewID("pkg")
	if _, err = tx.Exec(c, `INSERT INTO packages(id,order_id,warehouse_id) VALUES($1,$2,$3)`, packageID, orderID, warehouseID); err != nil {
		return nil, fmt.Errorf("create package: %w", err)
	}
	allocations := input.Items
	for _, itemID := range input.OrderItemIDs {
		allocations = append(allocations, struct {
			OrderItemID string `json:"order_item_id"`
			Quantity    int    `json:"quantity"`
		}{OrderItemID: itemID, Quantity: 0})
	}
	for _, allocation := range allocations {
		var quantity int
		if err = tx.QueryRow(c, `SELECT oi.quantity-COALESCE((SELECT sum(quantity) FROM package_items WHERE order_item_id=oi.id),0) FROM order_items oi WHERE oi.id=$1 AND oi.order_id=$2`, allocation.OrderItemID, orderID).Scan(&quantity); err != nil || quantity <= 0 {
			return nil, fmt.Errorf("items must belong to this order and have remaining quantity")
		}
		if allocation.Quantity > 0 {
			quantity = allocation.Quantity
		}
		if quantity <= 0 {
			return nil, fmt.Errorf("package quantity must be positive")
		}
		var available int
		if err = tx.QueryRow(c, `SELECT oi.quantity-COALESCE((SELECT sum(quantity) FROM package_items WHERE order_item_id=oi.id),0) FROM order_items oi WHERE oi.id=$1`, allocation.OrderItemID).Scan(&available); err != nil || quantity > available {
			return nil, fmt.Errorf("package quantity exceeds remaining item quantity")
		}
		if _, err = tx.Exec(c, `INSERT INTO package_items(package_id,order_item_id,quantity) VALUES($1,$2,$3)`, packageID, allocation.OrderItemID, quantity); err != nil {
			return nil, fmt.Errorf("allocate package item: %w", err)
		}
	}
	if err = tx.Commit(c); err != nil {
		return nil, fmt.Errorf("commit package: %w", err)
	}
	return gin.H{"id": packageID, "order_id": orderID, "warehouse_id": warehouseID, "status": "READY_TO_SHIP", "item_count": len(allocations)}, nil
}

func (s *Server) shopeeCreatePackage(c *gin.Context) {
	client := currentClient(c)
	var input packageInput
	if err := c.ShouldBindJSON(&input); err != nil {
		s.shopeeError(c, 400, "error_param", "invalid package request")
		return
	}
	packageData, err := s.createPackageForOrder(c, client.ShopID, c.Param("id"), input)
	if err != nil {
		s.shopeeError(c, 400, shopeeErrorCode("INVALID_TRANSITION"), err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"package": packageData})
}

func (s *Server) shopeeCreateShipment(c *gin.Context) {
	client := currentClient(c)
	shipment, err := s.createShipmentForOrder(c, client.ShopID, c.Param("id"))
	if err != nil {
		s.shopeeError(c, 400, shopeeErrorCode("INVALID_TRANSITION"), err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"shipment": shipment})
}

func (s *Server) tokopediaCreateShipment(c *gin.Context) {
	client := currentClient(c)
	shipment, err := s.createShipmentForOrder(c, client.ShopID, c.Param("id"))
	if err != nil {
		s.tokopediaError(c, 36000003, err.Error())
		return
	}
	s.tokopediaSuccess(c, gin.H{"shipment": shipment})
}

func (s *Server) createShipmentForOrder(c *gin.Context, shop, orderID string) (gin.H, error) {
	var input shipmentInput
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.ShippingProvider) == "" || strings.TrimSpace(input.PickupType) == "" {
		return nil, fmt.Errorf("shipping_provider and pickup_type are required")
	}
	input.ShippingProvider = strings.TrimSpace(input.ShippingProvider)
	input.PickupType = strings.ToUpper(strings.TrimSpace(input.PickupType))
	if input.PickupType != "PICKUP" {
		return nil, fmt.Errorf("pickup_type must be PICKUP")
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		return nil, fmt.Errorf("start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, warehouseID string
	if err = tx.QueryRow(c, `SELECT status,COALESCE(fulfillment_warehouse_id,'') FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &warehouseID); err != nil {
		return nil, err
	}
	if status != orders.ReadyToShip {
		return nil, fmt.Errorf("shipment can only be created for %s orders", orders.ReadyToShip)
	}
	if warehouseID == "" {
		return nil, fmt.Errorf("order does not have a fulfillment warehouse")
	}
	id := platform.NewID("shp")
	packageID := strings.TrimSpace(input.PackageID)
	tracking := "GX" + strings.ToUpper(platform.NewID(""))[1:]
	if packageID == "" {
		packageID = platform.NewID("pkg")
		if _, err = tx.Exec(c, `INSERT INTO packages(id,order_id,warehouse_id,status) VALUES($1,$2,$3,'READY_TO_SHIP')`, packageID, orderID, warehouseID); err != nil {
			return nil, fmt.Errorf("create package: %w", err)
		}
		command, assignErr := tx.Exec(c, `
			INSERT INTO package_items(package_id,order_item_id,quantity)
			SELECT $1,oi.id,oi.quantity-COALESCE(sum(pi.quantity),0)::integer
			FROM order_items oi
			LEFT JOIN package_items pi ON pi.order_item_id=oi.id
			WHERE oi.order_id=$2
			GROUP BY oi.id,oi.quantity
			HAVING oi.quantity-COALESCE(sum(pi.quantity),0)>0`, packageID, orderID)
		if assignErr != nil {
			err = assignErr
			return nil, fmt.Errorf("assign package items: %w", err)
		}
		if command.RowsAffected() == 0 {
			return nil, fmt.Errorf("order has no remaining items to package")
		}
	} else {
		var packageStatus string
		if err = tx.QueryRow(c, `SELECT status FROM packages WHERE id=$1 AND order_id=$2 AND warehouse_id=$3 FOR UPDATE`, packageID, orderID, warehouseID).Scan(&packageStatus); err != nil {
			return nil, fmt.Errorf("package does not belong to order")
		}
		if packageStatus != "READY_TO_SHIP" {
			return nil, fmt.Errorf("package must be READY_TO_SHIP")
		}
		var itemCount int
		if err = tx.QueryRow(c, `SELECT count(*) FROM package_items WHERE package_id=$1`, packageID).Scan(&itemCount); err != nil {
			return nil, fmt.Errorf("count package items: %w", err)
		}
		if itemCount == 0 {
			return nil, fmt.Errorf("package must contain at least one item")
		}
	}
	if _, err = tx.Exec(c, `INSERT INTO shipments(id,order_id,package_id,tracking_number,shipping_provider,pickup_type,status) VALUES($1,$2,$3,$4,$5,$6,'CREATED')`, id, orderID, packageID, tracking, input.ShippingProvider, input.PickupType); err != nil {
		return nil, fmt.Errorf("create shipment: %w", err)
	}
	if err = tx.Commit(c); err != nil {
		return nil, fmt.Errorf("commit shipment: %w", err)
	}
	return gin.H{"id": id, "package_id": packageID, "warehouse_id": warehouseID, "order_id": orderID, "tracking_number": tracking, "shipping_provider": input.ShippingProvider, "pickup_type": input.PickupType, "status": "CREATED"}, nil
}
