package products

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ErrInvalidProductInput identifies a product draft that violates catalogue rules.
var ErrInvalidProductInput = errors.New("invalid product input")

// ErrDuplicateSKU identifies an SKU that is already used by a shop.
var ErrDuplicateSKU = errors.New("duplicate product sku")

// Draft is the product data accepted by the catalogue write use case.
type Draft struct {
	SKU              string
	Name             string
	Category         string
	Description      string
	Price            int64
	Stock            int
	Status           string
	InitialInventory []InitialInventory
}

// InitialInventory assigns an initial physical quantity to one fulfillment
// warehouse when a product is created through the control plane.
type InitialInventory struct {
	WarehouseID    string
	OnHandQuantity int
}

// Product is the normalized product persisted by a catalogue repository.
type Product struct {
	ID     string
	ShopID string
	Draft
}

// Creator is the narrow persistence dependency for product creation.
type Creator interface {
	Create(ctx context.Context, product Product) error
}

// Service owns catalogue write validation and normalization.
type Service struct {
	creator Creator
	newID   func(prefix string) string
}

// NewService constructs a catalogue service.
func NewService(creator Creator, newID func(prefix string) string) *Service {
	return &Service{creator: creator, newID: newID}
}

// Create validates and normalizes a catalogue draft before persisting it.
func (s *Service) Create(ctx context.Context, shopID string, draft Draft) (Product, error) {
	draft.SKU = strings.TrimSpace(draft.SKU)
	draft.Name = strings.TrimSpace(draft.Name)
	draft.Category = strings.TrimSpace(draft.Category)
	draft.Status = strings.TrimSpace(draft.Status)
	if draft.SKU == "" || draft.Name == "" || draft.Price < 0 || draft.Stock < 0 {
		return Product{}, fmt.Errorf("%w: sku, name, non-negative price, and stock are required", ErrInvalidProductInput)
	}
	if len(draft.InitialInventory) > 0 {
		seenWarehouses := make(map[string]struct{}, len(draft.InitialInventory))
		totalStock := 0
		for index := range draft.InitialInventory {
			allocation := &draft.InitialInventory[index]
			allocation.WarehouseID = strings.TrimSpace(allocation.WarehouseID)
			if allocation.WarehouseID == "" || allocation.OnHandQuantity < 0 {
				return Product{}, fmt.Errorf("%w: every warehouse allocation needs an id and non-negative quantity", ErrInvalidProductInput)
			}
			if _, exists := seenWarehouses[allocation.WarehouseID]; exists {
				return Product{}, fmt.Errorf("%w: a warehouse can only appear once", ErrInvalidProductInput)
			}
			seenWarehouses[allocation.WarehouseID] = struct{}{}
			totalStock += allocation.OnHandQuantity
		}
		draft.Stock = totalStock
	}
	if draft.Category == "" {
		draft.Category = "Uncategorized"
	}
	if draft.Status == "" {
		draft.Status = "ACTIVE"
	}
	if draft.Status != "ACTIVE" && draft.Status != "INACTIVE" {
		return Product{}, fmt.Errorf("%w: unsupported product status", ErrInvalidProductInput)
	}
	product := Product{ID: s.newID("prd"), ShopID: shopID, Draft: draft}
	if err := s.creator.Create(ctx, product); err != nil {
		return Product{}, fmt.Errorf("persist product: %w", err)
	}
	return product, nil
}
