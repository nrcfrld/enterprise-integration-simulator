package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/inventory"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
	store "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/store/sqlc"
	dummygenerator "github.com/enrico/enterprise-integration-simulator/packages/dummy-generator"
)

func (s *Server) dashboard(c *gin.Context) {
	a := currentActor(c)
	where, args := "", []any{}
	if a.Role != "ADMIN" {
		where = " WHERE owner_user_id=$1"
		args = append(args, a.ID)
	}
	var shops int
	_ = s.db.QueryRow(c, `SELECT count(*) FROM shops`+where, args...).Scan(&shops)
	query := `SELECT count(*) FROM orders WHERE shop_id IN (SELECT id FROM shops` + where + `)`
	var orders int
	_ = s.db.QueryRow(c, query, args...).Scan(&orders)
	query = `SELECT count(*) FROM webhook_deliveries WHERE status='FAILED' AND webhook_id IN (SELECT id FROM webhooks WHERE shop_id IN (SELECT id FROM shops` + where + `))`
	var failed int
	_ = s.db.QueryRow(c, query, args...).Scan(&failed)
	setup := gin.H{"ready": false, "seeded": false, "credential_active": false, "webhook_configured": false, "webhook_enabled": false}
	if shopID := c.Query("shop_id"); shopID != "" && s.canAccessShop(c, shopID) {
		var products, activeCredentials, webhooks, enabledWebhooks int
		_ = s.db.QueryRow(c, `SELECT count(*) FROM products WHERE shop_id=$1`, shopID).Scan(&products)
		_ = s.db.QueryRow(c, `SELECT count(*) FROM credentials WHERE shop_id=$1 AND status='ACTIVE'`, shopID).Scan(&activeCredentials)
		_ = s.db.QueryRow(c, `SELECT count(*), count(*) FILTER (WHERE enabled) FROM webhooks WHERE shop_id=$1`, shopID).Scan(&webhooks, &enabledWebhooks)
		setup = gin.H{"shop_id": shopID, "seeded": products >= 100, "products": products, "credential_active": activeCredentials > 0, "webhook_configured": webhooks > 0, "webhook_enabled": enabledWebhooks > 0, "ready": products > 0 && activeCredentials > 0 && enabledWebhooks > 0}
	}
	c.JSON(http.StatusOK, gin.H{"shops": shops, "orders": orders, "failed_deliveries": failed, "role": a.Role, "setup": setup})
}

func (s *Server) listShops(c *gin.Context) {
	a := currentActor(c)
	result := make([]gin.H, 0)
	if a.Role == "ADMIN" {
		rows, err := s.store.ListAllShops(c)
		if err != nil {
			c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not list shops"))
			return
		}
		for _, row := range rows {
			result = append(result, gin.H{"id": row.ID, "owner_user_id": row.OwnerUserID, "name": row.Name, "provider_profile": row.ProviderProfile, "status": row.Status, "created_at": row.CreatedAt.Time, "updated_at": row.UpdatedAt.Time})
		}
	} else {
		rows, err := s.store.ListShopsForOwner(c, a.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not list shops"))
			return
		}
		for _, row := range rows {
			result = append(result, gin.H{"id": row.ID, "owner_user_id": row.OwnerUserID, "name": row.Name, "provider_profile": row.ProviderProfile, "status": row.Status, "created_at": row.CreatedAt.Time, "updated_at": row.UpdatedAt.Time})
		}
	}
	s.controlListResponse(c, result)
}

func (s *Server) createShop(c *gin.Context) {
	var input struct {
		Name            string `json:"name"`
		OwnerUserID     string `json:"owner_user_id"`
		ProviderProfile string `json:"provider_profile"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Name) == "" {
		c.JSON(400, errorBody("INVALID_REQUEST", "name is required"))
		return
	}
	a := currentActor(c)
	owner := a.ID
	provider := orders.NormaliseProvider(input.ProviderProfile)
	if !orders.SupportsProvider(provider) {
		c.JSON(400, errorBody("INVALID_REQUEST", "provider_profile must be SHOPEE_LIKE or TOKOPEDIA_LIKE"))
		return
	}
	if input.OwnerUserID != "" {
		if a.Role != "ADMIN" {
			c.JSON(403, errorBody("FORBIDDEN", "only admins can assign ownership"))
			return
		}
		owner = input.OwnerUserID
	}
	id := platform.NewID("shop")
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start shop transaction"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	if err := s.store.WithTx(tx).CreateShop(c, store.CreateShopParams{ID: id, OwnerUserID: owner, Name: strings.TrimSpace(input.Name)}); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create shop"))
		return
	}
	if _, err := tx.Exec(c, `UPDATE shops SET provider_profile=$1 WHERE id=$2`, provider, id); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not set provider profile"))
		return
	}
	if _, err := inventory.EnsureDefaultWarehouse(c, tx, id); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create default warehouse"))
		return
	}
	if err := s.store.WithTx(tx).CreateShopScenario(c, id); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create shop scenario"))
		return
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit shop"))
		return
	}
	c.JSON(201, gin.H{"id": id, "owner_user_id": owner, "name": strings.TrimSpace(input.Name), "provider_profile": provider, "status": "ACTIVE"})
}

// EnsureDevelopmentSeed creates a single baseline shop only when an empty local
// deployment explicitly enables seed-on-boot.
func (s *Server) EnsureDevelopmentSeed(ctx context.Context) error {
	if !s.cfg.SeedOnBoot {
		return nil
	}
	var shopCount int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM shops`).Scan(&shopCount); err != nil {
		return fmt.Errorf("count shops before seed: %w", err)
	}
	if shopCount > 0 {
		return nil
	}
	var adminID string
	if err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE email=$1`, s.cfg.AdminEmail).Scan(&adminID); err != nil {
		return fmt.Errorf("load bootstrap administrator: %w", err)
	}
	shopID := platform.NewID("shop")
	if _, err := s.db.Exec(ctx, `INSERT INTO shops(id,owner_user_id,name,provider_profile) VALUES($1,$2,$3,'SHOPEE_LIKE')`, shopID, adminID, "Marketplace Demo Store"); err != nil {
		return fmt.Errorf("create baseline shop: %w", err)
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO shop_scenarios(shop_id) VALUES($1)`, shopID); err != nil {
		return fmt.Errorf("create baseline scenario: %w", err)
	}
	if _, err := s.resetShopData(ctx, shopID); err != nil {
		return fmt.Errorf("seed baseline shop: %w", err)
	}
	return nil
}

func (s *Server) resetShop(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	result, err := s.resetShopData(c, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not reset shop: "+err.Error()))
		return
	}
	c.JSON(200, gin.H{
		"shop_id":            result.ShopID,
		"products_seeded":    result.ProductsSeeded,
		"orders_seeded":      result.OrdersSeeded,
		"example_webhook_id": result.ExampleWebhookID,
		"credential":         gin.H{"client_id": result.ClientID},
	})
}

func (s *Server) resetShopData(ctx context.Context, shop string) (seedResult, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return seedResult{}, fmt.Errorf("begin reset: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, statement := range []string{
		`DELETE FROM webhooks WHERE shop_id=$1`,
		`DELETE FROM credentials WHERE shop_id=$1`,
		`DELETE FROM outbox WHERE event_id IN (SELECT id FROM domain_events WHERE shop_id=$1)`,
		`DELETE FROM domain_events WHERE shop_id=$1`,
		`DELETE FROM orders WHERE shop_id=$1`,
		`DELETE FROM products WHERE shop_id=$1`,
	} {
		if _, err := tx.Exec(ctx, statement, shop); err != nil {
			return seedResult{}, fmt.Errorf("clear shop data: %w", err)
		}
	}
	defaultWarehouse, err := inventory.EnsureDefaultWarehouse(ctx, tx, shop)
	if err != nil {
		return seedResult{}, fmt.Errorf("ensure seed warehouse: %w", err)
	}

	dummy := dummygenerator.New(products.CatalogSeed)
	seededProducts := make([]seededProduct, 0, 100)
	for i := 1; i <= 100; i++ {
		seed := products.SeedCatalogProduct(dummy, i)
		product := seededProduct{SKU: seed.SKU, Name: seed.Name, Category: seed.Category, Description: seed.Description, Price: seed.Price, Stock: seed.Stock}
		product.ID = platform.NewID("prd")
		if _, err := tx.Exec(ctx, `INSERT INTO products(id,shop_id,sku,name,category,description,price,stock,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')`, product.ID, shop, product.SKU, product.Name, product.Category, product.Description, product.Price, product.Stock); err != nil {
			return seedResult{}, fmt.Errorf("seed product: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO warehouse_inventory(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES($1,$2,$3,0)`, defaultWarehouse, product.ID, product.Stock); err != nil {
			return seedResult{}, fmt.Errorf("seed warehouse inventory: %w", err)
		}
		seededProducts = append(seededProducts, product)
	}
	for i := 1; i <= 50; i++ {
		customerData := dummy.Customer()
		customer, err := json.Marshal(gin.H{"name": customerData.Name, "phone": customerData.Phone})
		if err != nil {
			return seedResult{}, fmt.Errorf("marshal seeded customer: %w", err)
		}
		addressData := dummy.IndonesianAddress()
		address, err := json.Marshal(gin.H{"address_line": addressData.AddressLine, "city": addressData.City, "postal_code": addressData.PostalCode})
		if err != nil {
			return seedResult{}, fmt.Errorf("marshal seeded address: %w", err)
		}
		product := seededProducts[(i-1)%len(seededProducts)]
		orderID := platform.NewID("ord")
		orderNumber := fmt.Sprintf("SIM-ORDER-%s-%03d", shop[len(shop)-6:], i)
		if _, err := tx.Exec(ctx, `INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_reference,paid_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'COMPLETED',$8,now()-($7 * interval '1 hour'),now()-($7 * interval '1 hour'),now()-($7 * interval '1 hour'))`, orderID, orderNumber, shop, customer, address, product.Price, i, "seed_"+orderID); err != nil {
			return seedResult{}, fmt.Errorf("seed order: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_items(id,order_id,product_id,sku,product_name,price,quantity,subtotal) VALUES($1,$2,$3,$4,$5,$6,1,$6)`, platform.NewID("item"), orderID, product.ID, product.SKU, product.Name, product.Price); err != nil {
			return seedResult{}, fmt.Errorf("seed order item: %w", err)
		}
	}

	secret := platform.NewID("sec")
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, secret)
	if err != nil {
		return seedResult{}, fmt.Errorf("protect seeded credential: %w", err)
	}
	clientID := platform.NewID("client")
	accessTokenCipher, err := platform.Encrypt(s.cfg.EncryptionKey, platform.NewID("acc"))
	if err != nil {
		return seedResult{}, fmt.Errorf("protect seeded access token: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO credentials(id,shop_id,client_id,secret_ciphertext,access_token_ciphertext) VALUES($1,$2,$3,$4,$5)`, platform.NewID("cred"), shop, clientID, cipher, accessTokenCipher); err != nil {
		return seedResult{}, fmt.Errorf("seed credential: %w", err)
	}
	webhookSecret := platform.NewID("whsec")
	webhookCipher, err := platform.Encrypt(s.cfg.EncryptionKey, webhookSecret)
	if err != nil {
		return seedResult{}, fmt.Errorf("protect example webhook: %w", err)
	}
	events, err := json.Marshal([]string{"order.created", "order.paid", "order.processing", "order.ready_to_ship", "order.shipped", "order.in_delivery", "order.delivered", "order.completed", "order.cancelled"})
	if err != nil {
		return seedResult{}, fmt.Errorf("marshal example webhook events: %w", err)
	}
	webhookID := platform.NewID("wh")
	if _, err := tx.Exec(ctx, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,enabled,subscribed_events) VALUES($1,$2,$3,$4,false,$5)`, webhookID, shop, "https://example.test/webhooks/marketplace", webhookCipher, events); err != nil {
		return seedResult{}, fmt.Errorf("seed example webhook: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return seedResult{}, fmt.Errorf("commit reset: %w", err)
	}
	return seedResult{ShopID: shop, ProductsSeeded: len(seededProducts), OrdersSeeded: 50, ClientID: clientID, ExampleWebhookID: webhookID}, nil
}
