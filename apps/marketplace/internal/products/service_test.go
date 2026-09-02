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
