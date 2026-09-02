-- name: GetShopByID :one
SELECT id, owner_user_id, name, status, created_at, updated_at FROM shops WHERE id = $1;

-- name: GetShopOwner :one
SELECT owner_user_id FROM shops WHERE id = $1;

-- name: ListProductsForShop :many
SELECT id, shop_id, sku, name, category, description, price, stock, status, created_at, updated_at
FROM products WHERE shop_id = $1 AND status <> 'DELETED'
ORDER BY created_at DESC, id DESC LIMIT $2;

-- name: ListAllShops :many
SELECT id, owner_user_id, name, provider_profile, status, created_at, updated_at
FROM shops ORDER BY created_at DESC;

-- name: ListShopsForOwner :many
SELECT id, owner_user_id, name, provider_profile, status, created_at, updated_at
FROM shops WHERE owner_user_id = $1 ORDER BY created_at DESC;

-- name: ListOrdersForShop :many
SELECT id, order_number, shop_id, customer_data, shipping_address, total_amount, status, created_at, updated_at
FROM orders WHERE shop_id = $1 ORDER BY created_at DESC;

-- name: CreateShop :exec
INSERT INTO shops(id, owner_user_id, name) VALUES ($1, $2, $3);

-- name: CreateShopScenario :exec
INSERT INTO shop_scenarios(shop_id) VALUES ($1) ON CONFLICT DO NOTHING;

-- name: CreateProduct :exec
INSERT INTO products(id, shop_id, sku, name, category, description, price, stock, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: GetUserForLogin :one
SELECT id, email, role, session_version, password_hash
FROM users
WHERE email = $1;

-- name: GetSessionUser :one
SELECT id, email, role, session_version
FROM users
WHERE id = $1;

-- name: GetCredentialByClientID :one
SELECT id, shop_id, client_id, secret_ciphertext, status
FROM credentials
WHERE client_id = $1;

-- name: GetProductForShop :one
SELECT id, sku, name, category, description, price, stock, status, created_at, updated_at
FROM products
WHERE id = $1 AND shop_id = $2 AND status <> 'DELETED';

-- name: SoftDeleteProduct :execrows
UPDATE products
SET status = 'DELETED', updated_at = now()
WHERE id = $1 AND shop_id = $2 AND status <> 'DELETED';

-- name: GetCredentialShop :one
SELECT shop_id FROM credentials WHERE id = $1;

-- name: RevokeCredential :execrows
UPDATE credentials SET status = 'REVOKED', revoked_at = now() WHERE id = $1;
