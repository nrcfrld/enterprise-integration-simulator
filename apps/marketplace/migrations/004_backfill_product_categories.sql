-- +goose Up
-- Existing simulator catalogues stored the generated category as the leading
-- segment of the description. Preserve that useful metadata during upgrade.
UPDATE products
SET category = split_part(description, ' · ', 1)
WHERE category = 'Uncategorized'
  AND description LIKE '% · %';

-- +goose Down
-- The original description remains intact, so category backfill is reversible
-- through the schema migration that removes the column.
