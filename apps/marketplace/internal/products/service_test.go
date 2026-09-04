package products

import (
	"context"
	"errors"
	"testing"
)

type fakeCreator struct {
	product Product
	err     error
}

func (c *fakeCreator) Create(_ context.Context, product Product) error {
	c.product = product
	return c.err
}

func (c *fakeCreator) Get(context.Context, string, string) (Product, error) {
	return c.product, c.err
}

func (c *fakeCreator) Update(_ context.Context, _, _ string, patch Patch) (Product, error) {
	if c.err != nil {
		return Product{}, c.err
	}
	if patch.Name != nil {
		c.product.Name = *patch.Name
	}
	if patch.Category != nil {
		c.product.Category = *patch.Category
	}
	if patch.Description != nil {
		c.product.Description = *patch.Description
	}
	if patch.Price != nil {
		c.product.Price = *patch.Price
	}
	if patch.Status != nil {
		c.product.Status = *patch.Status
	}
	return c.product, nil
}

func (c *fakeCreator) Archive(context.Context, string, string) error { return c.err }

func TestServiceCreate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		draft     Draft
		creator   error
		wantErr   error
		wantStock int
	}{
		{name: "normalizes defaults", draft: Draft{SKU: " SKU-1 ", Name: " Mug ", Price: 10, Stock: 2}, wantStock: 2},
		{name: "sums initial warehouse inventory", draft: Draft{SKU: "SKU-1", Name: "Mug", Price: 10, InitialInventory: []InitialInventory{{WarehouseID: " wh_jakarta ", OnHandQuantity: 2}, {WarehouseID: "wh_surabaya", OnHandQuantity: 3}}}, wantStock: 5},
		{name: "rejects invalid status", draft: Draft{SKU: "SKU-1", Name: "Mug", Price: 10, Stock: 2, Status: "removed"}, wantErr: ErrInvalidProductInput},
		{name: "rejects negative stock", draft: Draft{SKU: "SKU-1", Name: "Mug", Price: 10, Stock: -1}, wantErr: ErrInvalidProductInput},
		{name: "rejects duplicate warehouse allocation", draft: Draft{SKU: "SKU-1", Name: "Mug", Price: 10, InitialInventory: []InitialInventory{{WarehouseID: "wh_1", OnHandQuantity: 1}, {WarehouseID: "wh_1", OnHandQuantity: 1}}}, wantErr: ErrInvalidProductInput},
		{name: "preserves duplicate sku", draft: Draft{SKU: "SKU-1", Name: "Mug", Price: 10, Stock: 2}, creator: ErrDuplicateSKU, wantErr: ErrDuplicateSKU},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			creator := &fakeCreator{err: test.creator}
			service := NewService(creator, func(string) string { return "prd_1" })
			product, err := service.Create(context.Background(), "shop_1", test.draft)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Create() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr != nil {
				return
			}
			if product.Category != "Uncategorized" || product.Status != "ACTIVE" || product.Stock != test.wantStock || creator.product.ID != "prd_1" {
				t.Fatalf("Create() product = %#v", product)
			}
		})
	}
}

func TestServiceUpdate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		patch   Patch
		wantErr error
	}{
		{name: "normalizes mutable metadata", patch: Patch{Name: stringPointer(" Updated product "), Category: stringPointer(" Drinkware "), Description: stringPointer("Updated"), Price: int64Pointer(12500), Status: stringPointer(" inactive ")}},
		{name: "rejects empty name", patch: Patch{Name: stringPointer("   ")}, wantErr: ErrInvalidProductInput},
		{name: "rejects empty category", patch: Patch{Category: stringPointer("   ")}, wantErr: ErrInvalidProductInput},
		{name: "rejects negative price", patch: Patch{Price: int64Pointer(-1)}, wantErr: ErrInvalidProductInput},
		{name: "rejects invalid status", patch: Patch{Status: stringPointer("archived")}, wantErr: ErrInvalidProductInput},
		{name: "preserves repository errors", patch: Patch{}, wantErr: ErrProductNotFound},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			repository := &fakeCreator{
				product: Product{ID: "prd_1", ShopID: "shop_1", Draft: Draft{Name: "Original", Status: "ACTIVE"}},
			}
			if errors.Is(test.wantErr, ErrProductNotFound) {
				repository.err = ErrProductNotFound
			}
			service := NewService(repository, func(string) string { return "unused" })
			product, err := service.Update(context.Background(), "shop_1", "prd_1", test.patch)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Update() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr == nil && (product.Name != "Updated product" || product.Category != "Drinkware" || product.Description != "Updated" || product.Price != 12500 || product.Status != "INACTIVE") {
				t.Fatalf("Update() product = %#v", product)
			}
		})
	}
}

func TestServiceGet(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		manager *fakeCreator
		wantErr error
	}{
		{name: "returns repository product", manager: &fakeCreator{product: Product{ID: "prd_1", ShopID: "shop_1"}}},
		{name: "wraps repository error", manager: &fakeCreator{err: ErrProductNotFound}, wantErr: ErrProductNotFound},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			product, err := NewService(test.manager, func(string) string { return "unused" }).Get(context.Background(), "shop_1", "prd_1")
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Get() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr == nil && product.ID != "prd_1" {
				t.Fatalf("Get() product = %#v", product)
			}
		})
	}
}

func TestServiceArchive(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		manager *fakeCreator
		wantErr error
	}{
		{name: "archives repository product", manager: &fakeCreator{}},
		{name: "preserves product-in-use error", manager: &fakeCreator{err: ErrProductInUse}, wantErr: ErrProductInUse},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := NewService(test.manager, func(string) string { return "unused" }).Archive(context.Background(), "shop_1", "prd_1")
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Archive() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }

func int64Pointer(value int64) *int64 { return &value }
