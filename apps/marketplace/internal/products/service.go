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

// ErrProductNotFound identifies a missing or archived product.
var ErrProductNotFound = errors.New("product not found")

// ErrProductInUse prevents archiving inventory that still has reservations.
var ErrProductInUse = errors.New("product has active inventory reservations")

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

// Patch contains mutable catalogue metadata. Physical stock is deliberately
// managed through warehouse inventory rather than this aggregate view.
type Patch struct {
	Name        *string `json:"name"`
	Category    *string `json:"category"`
	Description *string `json:"description"`
	Price       *int64  `json:"price"`
	Status      *string `json:"status"`
}

// Creator is the narrow persistence dependency for product creation.
type Creator interface {
	Create(ctx context.Context, product Product) error
}

// Manager persists the complete control-plane catalogue lifecycle.
type Manager interface {
	Creator
	Get(ctx context.Context, shopID, productID string) (Product, error)
	Update(ctx context.Context, shopID, productID string, patch Patch) (Product, error)
	Archive(ctx context.Context, shopID, productID string) error
}

// Service owns catalogue write validation and normalization.
type Service struct {
	manager Manager
	newID   func(prefix string) string
}

// NewService constructs a catalogue service.
func NewService(manager Manager, newID func(prefix string) string) *Service {
	return &Service{manager: manager, newID: newID}
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
	if err := s.manager.Create(ctx, product); err != nil {
		return Product{}, fmt.Errorf("persist product: %w", err)
	}
	return product, nil
}

// Get returns one active control-plane catalogue product.
func (s *Service) Get(ctx context.Context, shopID, productID string) (Product, error) {
	product, err := s.manager.Get(ctx, shopID, productID)
	if err != nil {
		return Product{}, fmt.Errorf("get product: %w", err)
	}
	return product, nil
}

// Update validates and persists mutable catalogue metadata.
func (s *Service) Update(ctx context.Context, shopID, productID string, patch Patch) (Product, error) {
	if patch.Name != nil {
		*patch.Name = strings.TrimSpace(*patch.Name)
		if *patch.Name == "" {
			return Product{}, fmt.Errorf("%w: name cannot be empty", ErrInvalidProductInput)
		}
	}
	if patch.Category != nil {
		*patch.Category = strings.TrimSpace(*patch.Category)
		if *patch.Category == "" {
			return Product{}, fmt.Errorf("%w: category cannot be empty", ErrInvalidProductInput)
		}
	}
	if patch.Price != nil && *patch.Price < 0 {
		return Product{}, fmt.Errorf("%w: price must be non-negative", ErrInvalidProductInput)
	}
	if patch.Status != nil {
		*patch.Status = strings.ToUpper(strings.TrimSpace(*patch.Status))
		if *patch.Status != "ACTIVE" && *patch.Status != "INACTIVE" {
			return Product{}, fmt.Errorf("%w: status must be ACTIVE or INACTIVE", ErrInvalidProductInput)
		}
	}
	product, err := s.manager.Update(ctx, shopID, productID, patch)
	if err != nil {
		return Product{}, fmt.Errorf("update product: %w", err)
	}
	return product, nil
}

// Archive removes a product from provider catalogues while preserving history.
func (s *Service) Archive(ctx context.Context, shopID, productID string) error {
	if err := s.manager.Archive(ctx, shopID, productID); err != nil {
		return fmt.Errorf("archive product: %w", err)
	}
	return nil
}
