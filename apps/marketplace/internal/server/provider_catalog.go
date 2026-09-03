package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	store "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/store/sqlc"
)

func (s *Server) listWarehouses(c *gin.Context) {
	client := currentClient(c)
	rows, err := s.db.Query(c, `SELECT id,code,name,status,address,priority,created_at,updated_at FROM warehouses WHERE shop_id=$1 ORDER BY priority DESC,code ASC`, client.ShopID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list warehouses"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, code, name, status string
		var address []byte
		var priority int
		var created, updated time.Time
		if err := rows.Scan(&id, &code, &name, &status, &address, &priority, &created, &updated); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouse"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": client.ShopID, "code": code, "name": name, "status": status, "address": json.RawMessage(address), "priority": priority, "created_at": created, "updated_at": updated})
	}
	if err := rows.Err(); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouses"))
		return
	}
	c.JSON(200, gin.H{"data": data})
}

func (s *Server) getWarehouse(c *gin.Context) {
	client := currentClient(c)
	data, err := s.warehouseDetailData(c, c.Param("id"), client.ShopID)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse not found"))
		return
	}
	c.JSON(200, data)
}

// shopeeListProducts exposes the catalogue using a Shopee-like page-number
// contract and item terminology. Product persistence remains canonical per
// shop, while the public representation belongs to the provider adapter.
func (s *Server) shopeeListProducts(c *gin.Context) {
	client := currentClient(c)
	pageNo, pageSize := 1, 20
	var err error
	if raw := c.Query("page_no"); raw != "" {
		pageNo, err = strconv.Atoi(raw)
		if err != nil || pageNo < 1 {
			s.shopeeError(c, http.StatusBadRequest, "error_param", "page_no must be a positive integer")
			return
		}
	}
	if raw := c.Query("page_size"); raw != "" {
		pageSize, err = strconv.Atoi(raw)
		if err != nil || pageSize < 1 || pageSize > 100 {
			s.shopeeError(c, http.StatusBadRequest, "error_param", "page_size must be between 1 and 100")
			return
		}
	}
	args := []any{client.ShopID}
	where := "shop_id=$1 AND status <> 'DELETED'"
	if raw := strings.TrimSpace(c.Query("item_status")); raw != "" {
		args = append(args, strings.ToUpper(raw))
		where += fmt.Sprintf(" AND status=$%d", len(args))
	}
	if raw := strings.TrimSpace(c.Query("item_name")); raw != "" {
		args = append(args, "%"+raw+"%")
		where += fmt.Sprintf(" AND name ILIKE $%d", len(args))
	}
	var total int
	if err := s.db.QueryRow(c, fmt.Sprintf("SELECT count(*) FROM products WHERE %s", where), args...).Scan(&total); err != nil {
		s.shopeeError(c, http.StatusInternalServerError, "error_system", "could not list items")
		return
	}
	args = append(args, pageSize, (pageNo-1)*pageSize)
	rows, err := s.db.Query(c, fmt.Sprintf("SELECT id,sku,name,category,price,stock,status,updated_at FROM products WHERE %s ORDER BY updated_at DESC,id DESC LIMIT $%d OFFSET $%d", where, len(args)-1, len(args)), args...)
	if err != nil {
		s.shopeeError(c, http.StatusInternalServerError, "error_system", "could not list items")
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, sku, name, category, status string
		var price int64
		var stock int
		var updated time.Time
		if err := rows.Scan(&id, &sku, &name, &category, &price, &stock, &status, &updated); err != nil {
			s.shopeeError(c, http.StatusInternalServerError, "error_system", "could not read item")
			return
		}
		items = append(items, gin.H{"item_id": id, "item_sku": sku, "item_name": name, "category_name": category, "original_price": price, "current_stock": stock, "item_status": status, "update_time": updated.Unix()})
	}
	s.shopeeSuccess(c, gin.H{"item": items, "page_no": pageNo, "page_size": pageSize, "total_count": total, "has_next_page": pageNo*pageSize < total})
}

func (s *Server) shopeeGetProduct(c *gin.Context) {
	client := currentClient(c)
	product, err := s.productForShop(c, c.Param("id"), client.ShopID)
	if err != nil {
		s.shopeeError(c, http.StatusNotFound, "error_not_found", "item not found")
		return
	}
	s.shopeeSuccess(c, gin.H{"item_id": product.ID, "item_sku": product.SKU, "item_name": product.Name, "category_name": product.Category, "description": product.Description, "original_price": product.Price, "current_stock": product.Stock, "item_status": product.Status, "create_time": product.CreatedAt.Unix(), "update_time": product.UpdatedAt.Unix()})
}

func (s *Server) tokopediaListProducts(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		PageSize  int    `json:"page_size"`
		PageToken string `json:"page_token"`
		Keyword   string `json:"keyword"`
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
	args := []any{client.ShopID}
	where := "shop_id=$1 AND status <> 'DELETED'"
	if keyword := strings.TrimSpace(input.Keyword); keyword != "" {
		args = append(args, "%"+keyword+"%")
		where += fmt.Sprintf(" AND (name ILIKE $%d OR sku ILIKE $%d)", len(args), len(args))
	}
	args = append(args, input.PageSize+1, offset)
	rows, err := s.db.Query(c, fmt.Sprintf("SELECT id,sku,name,category,price,stock,status,updated_at FROM products WHERE %s ORDER BY updated_at DESC,id DESC LIMIT $%d OFFSET $%d", where, len(args)-1, len(args)), args...)
	if err != nil {
		s.tokopediaError(c, 500, "could not search products")
		return
	}
	defer rows.Close()
	products := []gin.H{}
	for rows.Next() {
		var id, sku, name, category, status string
		var price int64
		var stock int
		var updated time.Time
		if err := rows.Scan(&id, &sku, &name, &category, &price, &stock, &status, &updated); err != nil {
			s.tokopediaError(c, 500, "could not read product")
			return
		}
		products = append(products, gin.H{"product_id": id, "sku": sku, "name": name, "category": category, "price": price, "stock": stock, "status": status, "updated_at": updated.Unix()})
	}
	hasMore := len(products) > input.PageSize
	if hasMore {
		products = products[:input.PageSize]
	}
	next := ""
	if hasMore {
		next = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + input.PageSize)))
	}
	s.tokopediaSuccess(c, gin.H{"products": products, "next_page_token": next, "has_more": hasMore})
}

func (s *Server) tokopediaGetProduct(c *gin.Context) {
	client := currentClient(c)
	product, err := s.productForShop(c, c.Param("id"), client.ShopID)
	if err != nil {
		s.tokopediaError(c, 400, "product not found")
		return
	}
	s.tokopediaSuccess(c, gin.H{"product_id": product.ID, "sku": product.SKU, "name": product.Name, "category": product.Category, "description": product.Description, "price": product.Price, "stock": product.Stock, "status": product.Status, "created_at": product.CreatedAt.Unix(), "updated_at": product.UpdatedAt.Unix()})
}

type providerProduct struct {
	ID          string
	SKU         string
	Name        string
	Category    string
	Description string
	Price       int64
	Stock       int32
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (s *Server) productForShop(ctx context.Context, id, shopID string) (providerProduct, error) {
	row, err := s.store.GetProductForShop(ctx, store.GetProductForShopParams{ID: id, ShopID: shopID})
	if err != nil {
		return providerProduct{}, err
	}
	if row.Status == "DELETED" {
		return providerProduct{}, errors.New("product not found")
	}
	return providerProduct{ID: row.ID, SKU: row.Sku, Name: row.Name, Category: row.Category, Description: row.Description, Price: row.Price, Stock: row.Stock, Status: row.Status, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time}, nil
}

// shopeeListOrders uses page_no/page_size and Shopee-like names rather than
// exposing the Generic cursor contract. It is purposely separate so adapters
// must handle different filters and response envelopes.
