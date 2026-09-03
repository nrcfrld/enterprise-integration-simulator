-- +goose Up
-- Package allocation is checked at transaction boundaries so every package is
-- non-empty and the sum across packages never exceeds its order item quantity.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION validate_package_item_allocation() RETURNS trigger AS $$
DECLARE
  target_item TEXT;
  ordered_quantity INTEGER;
  allocated_quantity INTEGER;
BEGIN
  IF TG_OP='DELETE' THEN
    target_item := OLD.order_item_id;
  ELSE
    target_item := NEW.order_item_id;
  END IF;
  SELECT quantity INTO ordered_quantity FROM order_items WHERE id=target_item;
  SELECT COALESCE(sum(quantity),0) INTO allocated_quantity FROM package_items WHERE order_item_id=target_item;
  IF ordered_quantity IS NOT NULL AND allocated_quantity > ordered_quantity THEN
    RAISE EXCEPTION 'package allocation % exceeds order item quantity % for %', allocated_quantity, ordered_quantity, target_item
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER package_item_allocation_check
AFTER INSERT OR UPDATE OR DELETE ON package_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_package_item_allocation();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION validate_package_row_not_empty() RETURNS trigger AS $$
DECLARE
  target_package TEXT;
BEGIN
  target_package := NEW.id;
  IF EXISTS (SELECT 1 FROM packages WHERE id=target_package)
     AND NOT EXISTS (SELECT 1 FROM package_items WHERE package_id=target_package) THEN
    RAISE EXCEPTION 'package % must contain at least one item', target_package USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION validate_package_item_not_empty() RETURNS trigger AS $$
DECLARE
  target_package TEXT;
BEGIN
  IF TG_OP='DELETE' THEN
    target_package := OLD.package_id;
  ELSE
    target_package := NEW.package_id;
  END IF;
  IF EXISTS (SELECT 1 FROM packages WHERE id=target_package)
     AND NOT EXISTS (SELECT 1 FROM package_items WHERE package_id=target_package) THEN
    RAISE EXCEPTION 'package % must contain at least one item', target_package USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER package_not_empty_after_package
AFTER INSERT OR UPDATE ON packages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_package_row_not_empty();

CREATE CONSTRAINT TRIGGER package_not_empty_after_item
AFTER INSERT OR UPDATE OR DELETE ON package_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_package_item_not_empty();

-- +goose Down
DROP TRIGGER IF EXISTS package_not_empty_after_item ON package_items;
DROP TRIGGER IF EXISTS package_not_empty_after_package ON packages;
DROP TRIGGER IF EXISTS package_item_allocation_check ON package_items;
DROP FUNCTION IF EXISTS validate_package_item_not_empty();
DROP FUNCTION IF EXISTS validate_package_row_not_empty();
DROP FUNCTION IF EXISTS validate_package_item_allocation();
