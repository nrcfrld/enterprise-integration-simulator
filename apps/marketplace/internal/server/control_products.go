package server

import (
	"errors"
	"net/http"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
	"github.com/gin-gonic/gin"
)

type warehouseStockInput struct {
	WarehouseID    string `json:"warehouse_id"`
	OnHandQuantity int    `json:"on_hand_quantity"`
}

// controlProductInput accepts an optional initial allocation. Public product
// APIs retain their read-only provider-specific behavior.
type controlProductInput struct {
	SKU                string                `json:"sku"`
	Name               string                `json:"name"`
	Category           string                `json:"category"`
	Description        string                `json:"description"`
	Price              int64                 `json:"price"`
	Stock              int                   `json:"stock"`
	Status             string                `json:"status"`
	WarehouseInventory []warehouseStockInput `json:"warehouse_inventory"`
}

func (in controlProductInput) draft() products.Draft {
	allocations := make([]products.InitialInventory, 0, len(in.WarehouseInventory))
	for _, allocation := range in.WarehouseInventory {
		allocations = append(allocations, products.InitialInventory{WarehouseID: allocation.WarehouseID, OnHandQuantity: allocation.OnHandQuantity})
	}
	return products.Draft{SKU: in.SKU, Name: in.Name, Category: in.Category, Description: in.Description, Price: in.Price, Stock: in.Stock, Status: in.Status, InitialInventory: allocations}
}

func (s *Server) getControlProduct(c *gin.Context) {
	shopID := c.Param("id")
	if !s.mustAccessShop(c, shopID) {
		return
	}
	product, err := s.catalog.Get(c, shopID, c.Param("productID"))
	if err != nil {
		s.controlProductError(c, err)
		return
	}
	out := controlProductResponse(product)
	inventory, err := s.productInventory(c, shopID, product.ID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load product inventory"))
		return
	}
	trail, err := s.resourceEvents(c, shopID, product.ID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load product events"))
		return
	}
	out["warehouse_inventory"] = inventory
	out["events"] = trail
	c.JSON(http.StatusOK, out)
}

func (s *Server) updateControlProduct(c *gin.Context) {
	shopID := c.Param("id")
	if !s.mustAccessShop(c, shopID) {
		return
	}
	var patch products.Patch
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "invalid product update"))
		return
	}
	product, err := s.catalog.Update(c, shopID, c.Param("productID"), patch)
	if err != nil {
		s.controlProductError(c, err)
		return
	}
	c.JSON(http.StatusOK, controlProductResponse(product))
}

func (s *Server) archiveControlProduct(c *gin.Context) {
	shopID := c.Param("id")
	if !s.mustAccessShop(c, shopID) {
		return
	}
	if err := s.catalog.Archive(c, shopID, c.Param("productID")); err != nil {
		s.controlProductError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) controlProductError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, products.ErrProductNotFound):
		c.JSON(http.StatusNotFound, errorBody("NOT_FOUND", "product not found"))
	case errors.Is(err, products.ErrProductInUse):
		c.JSON(http.StatusConflict, errorBody("PRODUCT_IN_USE", "product has active or committed inventory reservations"))
	case errors.Is(err, products.ErrInvalidProductInput):
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", err.Error()))
	default:
		c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not manage product"))
	}
}

func controlProductResponse(product products.Product) gin.H {
	return gin.H{
		"id": product.ID, "shop_id": product.ShopID, "sku": product.SKU,
		"name": product.Name, "category": product.Category, "description": product.Description,
		"price": product.Price, "stock": product.Stock, "status": product.Status,
	}
}
