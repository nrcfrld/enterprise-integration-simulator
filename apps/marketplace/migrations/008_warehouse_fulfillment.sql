-- +goose Up
-- Warehouses are shop-owned fulfillment origins. The default warehouse keeps
-- existing shops and product APIs operational while allowing additional origins.
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shop_id, code)
);
CREATE INDEX IF NOT EXISTS warehouses_shop_priority_idx ON warehouses(shop_id, status, priority DESC, code ASC);

-- Every existing shop gets a deterministic default origin. This also becomes
-- the fulfillment origin for legacy orders, packages, and reservations.
INSERT INTO warehouses(id,shop_id,code,name,status,address,priority)
SELECT 'wh_default_' || s.id,s.id,'WH-DEFAULT','Default Warehouse','ACTIVE','{}'::jsonb,0
FROM shops s
ON CONFLICT (shop_id, code) DO NOTHING;

CREATE TABLE IF NOT EXISTS warehouse_inventory (
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  on_hand_quantity INTEGER NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0 AND reserved_quantity <= on_hand_quantity),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(warehouse_id, product_id)
);
CREATE INDEX IF NOT EXISTS warehouse_inventory_product_idx ON warehouse_inventory(product_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_warehouse_id TEXT REFERENCES warehouses(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES warehouses(id);
ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES warehouses(id);
ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS fulfilled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity);
ALTER TABLE inventory_reservations DROP CONSTRAINT IF EXISTS inventory_reservations_status_check;
ALTER TABLE inventory_reservations ADD CONSTRAINT inventory_reservations_status_check CHECK (status IN ('ACTIVE','COMMITTED','RELEASED','FULFILLED'));

UPDATE orders o SET fulfillment_warehouse_id='wh_default_' || o.shop_id WHERE fulfillment_warehouse_id IS NULL;
UPDATE packages p SET warehouse_id=o.fulfillment_warehouse_id FROM orders o WHERE o.id=p.order_id AND p.warehouse_id IS NULL;
UPDATE inventory_reservations r SET warehouse_id=o.fulfillment_warehouse_id FROM orders o WHERE o.id=r.order_id AND r.warehouse_id IS NULL;

-- product.stock historically represented already-available stock. Add every
-- outstanding reservation back into physical on-hand, then track it as reserved
-- in the default warehouse so available stock stays unchanged after migration.
INSERT INTO warehouse_inventory(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
SELECT 'wh_default_' || p.shop_id,p.id,
  p.stock + COALESCE(SUM(r.quantity) FILTER (WHERE r.status IN ('ACTIVE','COMMITTED')),0),
  COALESCE(SUM(r.quantity) FILTER (WHERE r.status IN ('ACTIVE','COMMITTED')),0)
FROM products p
LEFT JOIN inventory_reservations r ON r.product_id=p.id
GROUP BY p.id,p.shop_id,p.stock
ON CONFLICT (warehouse_id,product_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS orders_fulfillment_warehouse_idx ON orders(fulfillment_warehouse_id);
CREATE INDEX IF NOT EXISTS packages_warehouse_idx ON packages(warehouse_id);
CREATE INDEX IF NOT EXISTS inventory_reservations_warehouse_idx ON inventory_reservations(warehouse_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS shipments_package_unique_idx ON shipments(package_id) WHERE package_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS inventory_reservations_warehouse_idx;
DROP INDEX IF EXISTS shipments_package_unique_idx;
DROP INDEX IF EXISTS packages_warehouse_idx;
DROP INDEX IF EXISTS orders_fulfillment_warehouse_idx;
ALTER TABLE inventory_reservations DROP CONSTRAINT IF EXISTS inventory_reservations_status_check;
ALTER TABLE inventory_reservations ADD CONSTRAINT inventory_reservations_status_check CHECK (status IN ('ACTIVE','COMMITTED','RELEASED'));
ALTER TABLE inventory_reservations DROP COLUMN IF EXISTS fulfilled_quantity;
ALTER TABLE inventory_reservations DROP COLUMN IF EXISTS warehouse_id;
ALTER TABLE packages DROP COLUMN IF EXISTS warehouse_id;
ALTER TABLE orders DROP COLUMN IF EXISTS fulfillment_warehouse_id;
DROP INDEX IF EXISTS warehouse_inventory_product_idx;
DROP TABLE IF EXISTS warehouse_inventory;
DROP INDEX IF EXISTS warehouses_shop_priority_idx;
DROP TABLE IF EXISTS warehouses;
