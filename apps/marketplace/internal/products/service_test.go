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
	name := " Updated product "
	status := "inactive"
	negativePrice := int64(-1)
	tests := []struct {
		name    string
		patch   Patch
		wantErr error
	}{
		{name: "normalizes mutable metadata", patch: Patch{Name: &name, Status: &status}},
		{name: "rejects negative price", patch: Patch{Price: &negativePrice}, wantErr: ErrInvalidProductInput},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			repository := &fakeCreator{product: Product{ID: "prd_1", ShopID: "shop_1", Draft: Draft{Name: "Original", Status: "ACTIVE"}}}
			service := NewService(repository, func(string) string { return "unused" })
			product, err := service.Update(context.Background(), "shop_1", "prd_1", test.patch)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Update() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr == nil && (product.Name != "Updated product" || product.Status != "INACTIVE") {
				t.Fatalf("Update() product = %#v", product)
			}
		})
	}
}
