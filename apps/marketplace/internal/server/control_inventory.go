package server

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
)

func (s *Server) shopProducts(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.store.ListProductsForShop(c, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list products"))
		return
	}
	data := []gin.H{}
	for _, row := range rows {
		data = append(data, gin.H{"id": row.ID, "sku": row.Sku, "name": row.Name, "category": row.Category, "description": row.Description, "price": row.Price, "stock": row.Stock, "status": row.Status, "created_at": row.CreatedAt.Time, "updated_at": row.UpdatedAt.Time})
	}
	s.controlListResponse(c, data)
}

// shopWarehouses lists fulfillment origins and their aggregate available stock.
func (s *Server) shopWarehouses(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT w.id,w.code,w.name,w.status,w.address,w.priority,w.created_at,w.updated_at,COUNT(i.product_id),COALESCE(SUM(i.on_hand_quantity-i.reserved_quantity),0) FROM warehouses w LEFT JOIN warehouse_inventory i ON i.warehouse_id=w.id WHERE w.shop_id=$1 GROUP BY w.id ORDER BY w.priority DESC,w.code ASC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list warehouses"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, code, name, status string
		var address []byte
		var priority, products, available int
		var created, updated time.Time
		if err := rows.Scan(&id, &code, &name, &status, &address, &priority, &created, &updated, &products, &available); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouse"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": shop, "code": code, "name": name, "status": status, "address": json.RawMessage(address), "priority": priority, "product_count": products, "available_quantity": available, "created_at": created, "updated_at": updated})
	}
	s.controlListResponse(c, data)
}

func (s *Server) createControlWarehouse(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	input, ok := bindControlWarehouse(c)
	if !ok {
		return
	}
	address, err := json.Marshal(input.Address)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "address must be serializable"))
		return
	}
	id := platform.NewID("wh")
	if _, err := s.db.Exec(c, `INSERT INTO warehouses(id,shop_id,code,name,status,address,priority) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, shop, strings.TrimSpace(input.Code), strings.TrimSpace(input.Name), input.Status, address, input.Priority); err != nil {
		c.JSON(409, errorBody("DUPLICATE_WAREHOUSE_CODE", "warehouse code already exists for this shop"))
		return
	}
	c.JSON(201, gin.H{"id": id, "shop_id": shop, "code": strings.TrimSpace(input.Code), "name": strings.TrimSpace(input.Name), "status": input.Status, "address": input.Address, "priority": input.Priority})
}

type controlWarehouseInput struct {
	Code     string         `json:"code"`
	Name     string         `json:"name"`
	Status   string         `json:"status"`
	Address  map[string]any `json:"address"`
	Priority int            `json:"priority"`
}

func bindControlWarehouse(c *gin.Context) (controlWarehouseInput, bool) {
	var input controlWarehouseInput
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Code) == "" || strings.TrimSpace(input.Name) == "" {
		c.JSON(400, errorBody("INVALID_REQUEST", "code and name are required"))
		return controlWarehouseInput{}, false
	}
	if input.Status == "" {
		input.Status = "ACTIVE"
	}
	if input.Status != "ACTIVE" && input.Status != "INACTIVE" {
		c.JSON(400, errorBody("INVALID_REQUEST", "status must be ACTIVE or INACTIVE"))
		return controlWarehouseInput{}, false
	}
	if input.Address == nil {
		input.Address = map[string]any{}
	}
	return input, true
}

func (s *Server) updateControlWarehouse(c *gin.Context) {
	warehouseID := c.Param("id")
	var shop string
	if err := s.db.QueryRow(c, `SELECT shop_id FROM warehouses WHERE id=$1`, warehouseID).Scan(&shop); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	input, ok := bindControlWarehouse(c)
	if !ok {
		return
	}
	address, err := json.Marshal(input.Address)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "address must be serializable"))
		return
	}
	var updatedAddress []byte
	var code, name, status string
	var priority int
	err = s.db.QueryRow(c, `UPDATE warehouses SET code=$1,name=$2,status=$3,address=$4,priority=$5,updated_at=now() WHERE id=$6
		RETURNING code,name,status,address,priority`, strings.TrimSpace(input.Code), strings.TrimSpace(input.Name), input.Status, address, input.Priority, warehouseID).Scan(&code, &name, &status, &updatedAddress, &priority)
	if err != nil {
		c.JSON(409, errorBody("DUPLICATE_WAREHOUSE_CODE", "warehouse code already exists for this shop"))
		return
	}
	c.JSON(200, gin.H{"id": warehouseID, "shop_id": shop, "code": code, "name": name, "status": status, "address": json.RawMessage(updatedAddress), "priority": priority})
}

func (s *Server) warehouseDetailData(ctx context.Context, warehouseID, shopID string) (gin.H, error) {
	var id, shop, code, name, status string
	var address []byte
	var priority int
	var created, updated time.Time
	if err := s.db.QueryRow(ctx, `SELECT id,shop_id,code,name,status,address,priority,created_at,updated_at FROM warehouses WHERE id=$1 AND shop_id=$2`, warehouseID, shopID).Scan(&id, &shop, &code, &name, &status, &address, &priority, &created, &updated); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT i.product_id,p.sku,p.name,i.on_hand_quantity,i.reserved_quantity,i.on_hand_quantity-i.reserved_quantity,i.updated_at FROM warehouse_inventory i JOIN products p ON p.id=i.product_id WHERE i.warehouse_id=$1 ORDER BY p.sku ASC`, warehouseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	inventoryRows := []gin.H{}
	for rows.Next() {
		var productID, sku, productName string
		var onHand, reserved, available int
		var inventoryUpdated time.Time
		if err := rows.Scan(&productID, &sku, &productName, &onHand, &reserved, &available, &inventoryUpdated); err != nil {
			return nil, err
		}
		inventoryRows = append(inventoryRows, gin.H{"product_id": productID, "sku": sku, "product_name": productName, "on_hand_quantity": onHand, "reserved_quantity": reserved, "available_quantity": available, "updated_at": inventoryUpdated})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return gin.H{"id": id, "shop_id": shop, "code": code, "name": name, "status": status, "address": json.RawMessage(address), "priority": priority, "created_at": created, "updated_at": updated, "inventory": inventoryRows}, nil
}

func (s *Server) warehouseDetail(c *gin.Context) {
	var shop string
	if err := s.db.QueryRow(c, `SELECT shop_id FROM warehouses WHERE id=$1`, c.Param("id")).Scan(&shop); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	data, err := s.warehouseDetailData(c, c.Param("id"), shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouse"))
		return
	}
	c.JSON(200, data)
}

func (s *Server) updateWarehouseInventory(c *gin.Context) {
	warehouseID, productID := c.Param("id"), c.Param("productID")
	var input struct {
		OnHandQuantity int `json:"on_hand_quantity"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.OnHandQuantity < 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "on_hand_quantity must be non-negative"))
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start inventory update"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	var shop, inventoryShop string
	if err = tx.QueryRow(c, `SELECT w.shop_id,p.shop_id FROM warehouses w JOIN products p ON p.id=$2 WHERE w.id=$1`, warehouseID, productID).Scan(&shop, &inventoryShop); err != nil || shop != inventoryShop {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse or product not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	var previousOnHand, reserved int
	err = tx.QueryRow(c, `SELECT on_hand_quantity,reserved_quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE`, warehouseID, productID).Scan(&previousOnHand, &reserved)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not lock warehouse inventory"))
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		previousOnHand, reserved = 0, 0
	}
	if input.OnHandQuantity < reserved {
		c.JSON(400, errorBody("INVALID_REQUEST", "on_hand_quantity cannot be lower than reserved_quantity"))
		return
	}
	if _, err = tx.Exec(c, `INSERT INTO warehouse_inventory(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES($1,$2,$3,0) ON CONFLICT (warehouse_id,product_id) DO UPDATE SET on_hand_quantity=EXCLUDED.on_hand_quantity,updated_at=now()`, warehouseID, productID, input.OnHandQuantity); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update warehouse inventory"))
		return
	}
	if _, err = tx.Exec(c, `UPDATE products SET stock=stock+$1,updated_at=now() WHERE id=$2`, input.OnHandQuantity-previousOnHand, productID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update aggregate product stock"))
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit warehouse inventory"))
		return
	}
	c.JSON(200, gin.H{"warehouse_id": warehouseID, "product_id": productID, "on_hand_quantity": input.OnHandQuantity, "reserved_quantity": reserved, "available_quantity": input.OnHandQuantity - reserved})
}

func (s *Server) createControlProduct(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var in controlProductInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "sku, name, non-negative price, and stock are required"))
		return
	}
	product, err := s.catalog.Create(c, shop, in.draft())
	if errors.Is(err, products.ErrInvalidProductInput) {
		c.JSON(400, errorBody("INVALID_REQUEST", "sku, name, non-negative price, and stock are required"))
		return
	}
	if errors.Is(err, products.ErrDuplicateSKU) {
		c.JSON(409, errorBody("DUPLICATE_SKU", "sku already exists"))
		return
	}
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create product"))
		return
	}
	c.JSON(201, gin.H{"id": product.ID, "shop_id": product.ShopID, "sku": product.SKU, "name": product.Name, "category": product.Category, "description": product.Description, "price": product.Price, "stock": product.Stock, "status": product.Status})
}
