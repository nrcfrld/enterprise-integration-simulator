// Package inventory owns warehouse-level reservation and physical-stock accounting.
package inventory

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/jackc/pgx/v5"
)

// ErrNoEligibleWarehouse means no active warehouse can fulfill every requested line.
var ErrNoEligibleWarehouse = errors.New("no active warehouse has sufficient inventory")

// Line is one order item that must be reserved from a single warehouse.
type Line struct {
	OrderItemID string
	ProductID   string
	Quantity    int
}

// Warehouse is the selected fulfillment origin for an order.
type Warehouse struct {
	ID       string
	Code     string
	Name     string
	Priority int
}

// EnsureDefaultWarehouse creates the compatibility warehouse used by a new shop.
func EnsureDefaultWarehouse(ctx context.Context, tx pgx.Tx, shopID string) (string, error) {
	id := "wh_default_" + shopID
	var warehouseID string
	err := tx.QueryRow(ctx, `INSERT INTO warehouses(id,shop_id,code,name,status,address,priority) VALUES($1,$2,'WH-DEFAULT','Default Warehouse','ACTIVE','{}'::jsonb,0) ON CONFLICT (shop_id,code) DO UPDATE SET updated_at=warehouses.updated_at RETURNING id`, id, shopID).Scan(&warehouseID)
	if err != nil {
		return "", fmt.Errorf("ensure default warehouse: %w", err)
	}
	return warehouseID, nil
}

// Allocate selects the highest-priority active warehouse that can fulfill every
// line, reserves its inventory, and records the order's fulfillment origin.
func Allocate(ctx context.Context, tx pgx.Tx, shopID, orderID string, lines []Line) (Warehouse, error) {
	if len(lines) == 0 {
		return Warehouse{}, ErrNoEligibleWarehouse
	}
	ordered := append([]Line(nil), lines...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ProductID < ordered[j].ProductID })
	requiredByProduct, err := aggregateRequiredQuantity(ordered)
	if err != nil {
		return Warehouse{}, err
	}
	productIDs := make([]string, 0, len(requiredByProduct))
	for productID := range requiredByProduct {
		productIDs = append(productIDs, productID)
	}
	sort.Strings(productIDs)
	rows, err := tx.Query(ctx, `SELECT id,code,name,priority FROM warehouses WHERE shop_id=$1 AND status='ACTIVE' ORDER BY priority DESC,code ASC FOR UPDATE`, shopID)
	if err != nil {
		return Warehouse{}, fmt.Errorf("lock active warehouses: %w", err)
	}
	candidates := []Warehouse{}
	for rows.Next() {
		var warehouse Warehouse
		if err := rows.Scan(&warehouse.ID, &warehouse.Code, &warehouse.Name, &warehouse.Priority); err != nil {
			rows.Close()
			return Warehouse{}, fmt.Errorf("read warehouse: %w", err)
		}
		candidates = append(candidates, warehouse)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return Warehouse{}, fmt.Errorf("list active warehouses: %w", err)
	}
	rows.Close()

	for _, warehouse := range candidates {
		eligible := true
		for _, productID := range productIDs {
			required := requiredByProduct[productID]
			var onHand, reserved int
			err := tx.QueryRow(ctx, `SELECT on_hand_quantity,reserved_quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE`, warehouse.ID, productID).Scan(&onHand, &reserved)
			if err != nil || onHand-reserved < required {
				eligible = false
				break
			}
		}
		if !eligible {
			continue
		}
		for _, line := range ordered {
			if _, err := tx.Exec(ctx, `UPDATE warehouse_inventory SET reserved_quantity=reserved_quantity+$1,updated_at=now() WHERE warehouse_id=$2 AND product_id=$3`, line.Quantity, warehouse.ID, line.ProductID); err != nil {
				return Warehouse{}, fmt.Errorf("reserve warehouse inventory: %w", err)
			}
			command, err := tx.Exec(ctx, `UPDATE products SET stock=stock-$1,updated_at=now() WHERE id=$2 AND status='ACTIVE' AND stock >= $1`, line.Quantity, line.ProductID)
			if err != nil {
				return Warehouse{}, fmt.Errorf("update available product stock: %w", err)
			}
			if command.RowsAffected() != 1 {
				return Warehouse{}, fmt.Errorf("product availability drift for %s", line.ProductID)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO inventory_reservations(id,order_id,order_item_id,product_id,warehouse_id,quantity) VALUES($1,$2,$3,$4,$5,$6)`, platform.NewID("res"), orderID, line.OrderItemID, line.ProductID, warehouse.ID, line.Quantity); err != nil {
				return Warehouse{}, fmt.Errorf("record inventory reservation: %w", err)
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET fulfillment_warehouse_id=$1,updated_at=now() WHERE id=$2`, warehouse.ID, orderID); err != nil {
			return Warehouse{}, fmt.Errorf("assign fulfillment warehouse: %w", err)
		}
		return warehouse, nil
	}
	return Warehouse{}, ErrNoEligibleWarehouse
}

func aggregateRequiredQuantity(lines []Line) (map[string]int, error) {
	required := make(map[string]int, len(lines))
	for _, line := range lines {
		if line.ProductID == "" || line.OrderItemID == "" || line.Quantity <= 0 {
			return nil, ErrNoEligibleWarehouse
		}
		required[line.ProductID] += line.Quantity
	}
	return required, nil
}

// Commit marks reservations as paid while keeping them physically reserved.
func Commit(ctx context.Context, tx pgx.Tx, orderID string) error {
	_, err := tx.Exec(ctx, `UPDATE inventory_reservations SET status='COMMITTED',committed_at=COALESCE(committed_at,now()) WHERE order_id=$1 AND status='ACTIVE'`, orderID)
	return err
}

// Release makes pre-fulfillment inventory sellable again exactly once.
func Release(ctx context.Context, tx pgx.Tx, orderID string) error {
	rows, err := tx.Query(ctx, `UPDATE inventory_reservations SET status='RELEASED',released_at=COALESCE(released_at,now()) WHERE order_id=$1 AND status IN ('ACTIVE','COMMITTED') RETURNING warehouse_id,product_id,quantity-fulfilled_quantity`, orderID)
	if err != nil {
		return fmt.Errorf("mark reservations released: %w", err)
	}
	type released struct {
		warehouseID string
		productID   string
		quantity    int
	}
	releasedRows := []released{}
	for rows.Next() {
		var row released
		if err := rows.Scan(&row.warehouseID, &row.productID, &row.quantity); err != nil {
			rows.Close()
			return fmt.Errorf("read released reservation: %w", err)
		}
		releasedRows = append(releasedRows, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, row := range releasedRows {
		if row.quantity == 0 {
			continue
		}
		command, err := tx.Exec(ctx, `UPDATE warehouse_inventory SET reserved_quantity=reserved_quantity-$1,updated_at=now() WHERE warehouse_id=$2 AND product_id=$3 AND reserved_quantity >= $1`, row.quantity, row.warehouseID, row.productID)
		if err != nil {
			return fmt.Errorf("release warehouse inventory: %w", err)
		}
		if command.RowsAffected() != 1 {
			return fmt.Errorf("warehouse reservation drift for %s", row.productID)
		}
		if _, err := tx.Exec(ctx, `UPDATE products SET stock=stock+$1,updated_at=now() WHERE id=$2`, row.quantity, row.productID); err != nil {
			return fmt.Errorf("restore available product stock: %w", err)
		}
	}
	return nil
}

// FulfillPackage converts each allocated reservation into physical stock usage.
// It is called only when a package's shipment is first marked SHIPPED.
func FulfillPackage(ctx context.Context, tx pgx.Tx, packageID string) error {
	rows, err := tx.Query(ctx, `SELECT r.id,r.warehouse_id,r.product_id,r.quantity,r.fulfilled_quantity,r.status,pi.quantity FROM inventory_reservations r JOIN package_items pi ON pi.order_item_id=r.order_item_id WHERE pi.package_id=$1 ORDER BY r.product_id FOR UPDATE`, packageID)
	if err != nil {
		return fmt.Errorf("lock package reservations: %w", err)
	}
	type fulfillment struct {
		id, warehouseID, productID, status   string
		quantity, fulfilled, packageQuantity int
	}
	items := []fulfillment{}
	for rows.Next() {
		var item fulfillment
		if err := rows.Scan(&item.id, &item.warehouseID, &item.productID, &item.quantity, &item.fulfilled, &item.status, &item.packageQuantity); err != nil {
			rows.Close()
			return fmt.Errorf("read package reservation: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("read package reservations: %w", err)
	}
	rows.Close()
	if len(items) == 0 {
		return fmt.Errorf("package %s has no inventory reservations", packageID)
	}
	for _, item := range items {
		if (item.status != "ACTIVE" && item.status != "COMMITTED") || item.fulfilled+item.packageQuantity > item.quantity {
			return fmt.Errorf("cannot fulfill reservation %s", item.id)
		}
		command, err := tx.Exec(ctx, `UPDATE warehouse_inventory SET on_hand_quantity=on_hand_quantity-$1,reserved_quantity=reserved_quantity-$1,updated_at=now() WHERE warehouse_id=$2 AND product_id=$3 AND on_hand_quantity >= $1 AND reserved_quantity >= $1`, item.packageQuantity, item.warehouseID, item.productID)
		if err != nil {
			return fmt.Errorf("consume warehouse inventory: %w", err)
		}
		if command.RowsAffected() != 1 {
			return fmt.Errorf("warehouse fulfillment drift for %s", item.productID)
		}
		if _, err := tx.Exec(ctx, `UPDATE inventory_reservations SET fulfilled_quantity=fulfilled_quantity+$1,status=CASE WHEN fulfilled_quantity+$1=quantity THEN 'FULFILLED' ELSE status END WHERE id=$2`, item.packageQuantity, item.id); err != nil {
			return fmt.Errorf("mark reservation fulfilled: %w", err)
		}
	}
	return nil
}
