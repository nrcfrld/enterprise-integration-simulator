-- +goose Up
-- Serialize deferred allocation checks through the referenced order item.
-- Without this row lock, two concurrent transactions could each validate
-- against a snapshot that did not include the other package.
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
  SELECT quantity INTO ordered_quantity FROM order_items WHERE id=target_item FOR UPDATE;
  SELECT COALESCE(sum(quantity),0) INTO allocated_quantity FROM package_items WHERE order_item_id=target_item;
  IF ordered_quantity IS NOT NULL AND allocated_quantity > ordered_quantity THEN
    RAISE EXCEPTION 'package allocation % exceeds order item quantity % for %', allocated_quantity, ordered_quantity, target_item
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down
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
