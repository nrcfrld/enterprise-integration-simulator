// Package productrepo provides PostgreSQL persistence for catalogue services.
package productrepo

import (
	"context"
	"errors"
	"fmt"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/events"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/inventory"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQLCreator persists product creation and its atomic side effects.
type PostgreSQLCreator struct{ pool *pgxpool.Pool }

var _ products.Creator = (*PostgreSQLCreator)(nil)

// NewPostgreSQLCreator constructs a product creation repository.
func NewPostgreSQLCreator(pool *pgxpool.Pool) *PostgreSQLCreator {
	return &PostgreSQLCreator{pool: pool}
}

// Create writes product, its initial warehouse inventory, and its outbox event atomically.
func (r *PostgreSQLCreator) Create(ctx context.Context, product products.Product) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin product transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	query := "INSERT INTO products(id,shop_id,sku,name,category,description,price,stock,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)"
	if _, err := tx.Exec(ctx, query, product.ID, product.ShopID, product.SKU, product.Name, product.Category, product.Description, product.Price, product.Stock, product.Status); err != nil {
		var databaseError *pgconn.PgError
		if errors.As(err, &databaseError) && databaseError.Code == "23505" {
			return fmt.Errorf("%w: %s", products.ErrDuplicateSKU, product.SKU)
		}
		return fmt.Errorf("insert product: %w", err)
	}
	allocations := product.InitialInventory
	if len(allocations) == 0 {
		warehouseID, err := inventory.EnsureDefaultWarehouse(ctx, tx, product.ShopID)
		if err != nil {
			return fmt.Errorf("ensure default warehouse: %w", err)
		}
		allocations = []products.InitialInventory{{WarehouseID: warehouseID, OnHandQuantity: product.Stock}}
	}
	for _, allocation := range allocations {
		command, err := tx.Exec(ctx, `INSERT INTO warehouse_inventory(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
			SELECT $1,$2,$3,0 WHERE EXISTS (SELECT 1 FROM warehouses WHERE id=$1 AND shop_id=$4)`, allocation.WarehouseID, product.ID, allocation.OnHandQuantity, product.ShopID)
		if err != nil {
			return fmt.Errorf("insert warehouse inventory: %w", err)
		}
		if command.RowsAffected() != 1 {
			return fmt.Errorf("%w: warehouse %s does not belong to this shop", products.ErrInvalidProductInput, allocation.WarehouseID)
		}
	}
	payload := map[string]any{"id": product.ID, "sku": product.SKU, "name": product.Name, "category": product.Category, "price": product.Price, "stock": product.Stock, "status": product.Status}
	if err := events.Record(ctx, tx, product.ShopID, "product.created", product.ID, payload); err != nil {
		return fmt.Errorf("record product event: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit product transaction: %w", err)
	}
	return nil
}
