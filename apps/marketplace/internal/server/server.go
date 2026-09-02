// Package server exposes the control-plane and public integration HTTP APIs.
package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"golang.org/x/crypto/bcrypt"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/auth"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/events"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/inventory"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/observability"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/ratelimit"
	authrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/auth"
	orderrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/orders"
	productrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/products"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/scenarios"
	store "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/store/sqlc"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
	dummygenerator "github.com/enrico/enterprise-integration-simulator/packages/dummy-generator"
)

const timestampWindow = 5 * time.Minute

type seededProduct struct {
	ID          string
	SKU         string
	Name        string
	Category    string
	Description string
	Price       int64
	Stock       int
}

type seedResult struct {
	ShopID           string
	ProductsSeeded   int
	OrdersSeeded     int
	ClientID         string
	ExampleWebhookID string
}

// Server owns the HTTP dependencies used by all request handlers.
type Server struct {
	db      *pgxpool.Pool
	redis   *redis.Client
	cfg     platform.Config
	logger  *slog.Logger
	store   *store.Queries
	auth    *auth.Service
	orders  *orders.Service
	catalog *products.Service
	metrics *observability.HTTPMetrics
}

type responseRecorder struct {
	gin.ResponseWriter
	body bytes.Buffer
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	_, _ = r.body.Write(data)
	return r.ResponseWriter.Write(data)
}
func (r *responseRecorder) WriteString(value string) (int, error) {
	_, _ = r.body.WriteString(value)
	return r.ResponseWriter.WriteString(value)
}

// New constructs the HTTP application service.
func New(db *pgxpool.Pool, redisClient *redis.Client, cfg platform.Config, logger *slog.Logger) *Server {
	queries := store.New(db)
	server := &Server{
		db:      db,
		redis:   redisClient,
		cfg:     cfg,
		logger:  logger,
		store:   queries,
		auth:    auth.NewService(authrepo.NewPostgreSQLRepository(queries), cfg.SessionSecret),
		catalog: products.NewService(productrepo.NewPostgreSQLCreator(db), platform.NewID),
		metrics: observability.NewHTTPMetrics(),
	}
	server.orders = orders.NewService(
		orderrepo.NewPostgreSQLLifecycleRepository(db),
		orders.WithIDGenerator(platform.NewID),
		orders.WithSellerSLA(server.sellerSLA()),
	)
	return server
}

// Router returns the complete public and control-plane router.
func (s *Server) Router() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(s.metrics.Middleware(s.logger), observability.Recovery(s.logger), cors())
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.GET("/ready", s.ready)
	r.GET("/metrics", s.metrics.Handler)
	r.GET("/openapi.yaml", func(c *gin.Context) { c.File("openapi/openapi.yaml") })
	r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler, ginSwagger.URL("/openapi.yaml"), ginSwagger.DocExpansion("list")))

	control := r.Group("/control/v1")
	control.POST("/auth/login", s.login)
	secured := control.Group("")
	secured.Use(s.controlAuth)
	secured.GET("/dashboard", s.dashboard)
	secured.GET("/shops", s.listShops)
	secured.POST("/shops", s.createShop)
	secured.POST("/shops/:id/reset", s.requireRole("ADMIN"), s.resetShop)
	secured.GET("/shops/:id/products", s.shopProducts)
	secured.POST("/shops/:id/products", s.createControlProduct)
	secured.GET("/shops/:id/warehouses", s.shopWarehouses)
	secured.POST("/shops/:id/warehouses", s.createControlWarehouse)
	secured.GET("/shops/:id/orders", s.shopOrders)
	secured.POST("/shops/:id/orders", s.createSimulatedOrder)
	secured.GET("/shops/:id/shipments", s.shopShipments)
	secured.GET("/shops/:id/packages", s.shopPackages)
	secured.POST("/shops/:id/packages", s.createControlPackage)
	secured.GET("/orders/:id", s.orderDetail)
	secured.POST("/orders/:id/actions/:action", s.orderAction)
	secured.GET("/shipments/:id", s.shipmentDetail)
	secured.GET("/packages/:id", s.packageDetail)
	secured.GET("/warehouses/:id", s.warehouseDetail)
	secured.PATCH("/warehouses/:id", s.updateControlWarehouse)
	secured.PUT("/warehouses/:id/inventory/:productID", s.updateWarehouseInventory)
	secured.POST("/shipments/:id/actions/:action", s.shipmentAction)
	secured.POST("/shops/:id/credentials", s.createCredential)
	secured.GET("/shops/:id/credentials", s.listCredentials)
	secured.POST("/credentials/:id/revoke", s.revokeCredential)
	secured.GET("/shops/:id/webhooks", s.controlWebhooks)
	secured.POST("/shops/:id/webhooks", s.createControlWebhook)
	secured.PATCH("/shops/:shopID/webhooks/:id", s.updateControlWebhook)
	secured.DELETE("/shops/:shopID/webhooks/:id", s.deleteControlWebhook)
	secured.GET("/shops/:id/deliveries", s.controlDeliveries)
	secured.GET("/deliveries/:id", s.deliveryDetail)
	secured.POST("/deliveries/:id/retry", s.retryDelivery)
	secured.POST("/events/:id/replay", s.replayEvent)
	secured.POST("/events/:id/duplicate", s.duplicateEvent)
	secured.POST("/events/:id/delay", s.delayEvent)
	secured.GET("/shops/:id/scenario", s.getScenario)
	secured.PUT("/shops/:id/scenario", s.putScenario)
	secured.GET("/maintenance", s.requireRole("ADMIN"), s.getMaintenance)
	secured.PUT("/maintenance", s.requireRole("ADMIN"), s.maintenance)
	secured.GET("/users", s.requireRole("ADMIN"), s.listUsers)
	secured.POST("/users", s.requireRole("ADMIN"), s.createUser)

	api := r.Group("/api/v1")
	api.Use(s.integrationAuth, s.applyScenario)
	api.POST("/webhooks", s.idempotent("webhooks.create"), s.createWebhook)
	api.GET("/webhooks", s.listWebhooks)
	api.DELETE("/webhooks/:id", s.idempotent("webhooks.delete"), s.deleteWebhook)
	api.GET("/warehouses", s.listWarehouses)
	api.GET("/warehouses/:id", s.getWarehouse)

	// SHOPEE_LIKE has a provider-owned order boundary. It shares canonical
	// persistence with TOKOPEDIA_LIKE but not its wire contract or signing.
	shopee := r.Group("/api/shopee/v1")
	shopee.Use(s.shopeeIntegrationAuth, s.applyScenario)
	shopee.GET("/products", s.shopeeListProducts)
	shopee.GET("/products/:id", s.shopeeGetProduct)
	shopee.GET("/orders", s.shopeeListOrders)
	shopee.GET("/orders/:id", s.shopeeGetOrder)
	shopee.POST("/orders/:id/cancel", s.shopeeCancelOrder)
	shopee.POST("/orders/:id/ship-order", s.shopeeProcessOrder)
	shopee.POST("/orders/:id/ready-to-ship", s.shopeeReadyToShipOrder)
	shopee.POST("/orders/:id/packages", s.shopeeCreatePackage)
	shopee.POST("/orders/:id/shipments", s.shopeeCreateShipment)
	shopee.POST("/webhooks", s.shopeeCreateWebhook)
	shopee.GET("/webhooks", s.shopeeListWebhooks)

	// TOKOPEDIA_LIKE models the current Tokopedia & Shop Partner Center shape:
	// versioned path, query parameters, bearer token, and app-key signature.
	tokopediaAPI := r.Group("/api/tokopedia/v202309")
	tokopediaAPI.Use(s.tokopediaIntegrationAuth, s.applyScenario)
	tokopediaAPI.POST("/products/search", s.tokopediaListProducts)
	tokopediaAPI.GET("/products/:id", s.tokopediaGetProduct)
	tokopediaAPI.POST("/orders/search", s.tokopediaListOrders)
	tokopediaAPI.GET("/orders/:id", s.tokopediaGetOrder)
	tokopediaAPI.POST("/orders/:id/pack", s.tokopediaPackOrder)
	tokopediaAPI.POST("/orders/:id/handover", s.tokopediaHandoverOrder)
	tokopediaAPI.POST("/orders/:id/cancel", s.tokopediaCancelOrder)
	tokopediaAPI.POST("/orders/:id/shipments", s.tokopediaCreateShipment)
	tokopediaAPI.PUT("/webhooks", s.tokopediaConfigureWebhooks)
	return r
}

func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "http://localhost:5173" || origin == "http://127.0.0.1:5173" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Client-Id, X-Timestamp, X-Signature")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.Status(http.StatusNoContent)
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, errorBody("NOT_READY", "postgres unavailable"))
		return
	}
	if err := s.redis.Ping(ctx).Err(); err != nil {
		c.JSON(http.StatusServiceUnavailable, errorBody("NOT_READY", "redis unavailable"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}

func errorBody(code, message string) gin.H {
	return gin.H{"error": gin.H{"code": code, "message": message}}
}

type actor struct {
	ID             string
	Email          string
	Role           string
	SessionVersion int
}
type integrationClient struct{ CredentialID, ShopID, ClientID string }

func (s *Server) login(c *gin.Context) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "email and password are required"))
		return
	}
	claims, token, err := s.auth.Login(c, input.Email, input.Password)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		c.JSON(http.StatusUnauthorized, errorBody("INVALID_LOGIN", "invalid email or password"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("TOKEN_ERROR", "could not create session"))
		return
	}
	a := actor{ID: claims.ID, Email: claims.Email, Role: claims.Role, SessionVersion: claims.SessionVersion}
	c.JSON(http.StatusOK, gin.H{"token": token, "user": a})
}

func (s *Server) controlAuth(c *gin.Context) {
	parts := strings.Fields(c.GetHeader("Authorization"))
	if len(parts) != 2 || parts[0] != "Bearer" {
		c.JSON(http.StatusUnauthorized, errorBody("UNAUTHORIZED", "bearer token required"))
		c.Abort()
		return
	}
	claims, err := s.auth.AuthenticateSession(c, parts[1])
	if errors.Is(err, auth.ErrInvalidSession) {
		c.JSON(http.StatusUnauthorized, errorBody("UNAUTHORIZED", "expired token"))
		c.Abort()
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("AUTH_ERROR", "could not validate session"))
		c.Abort()
		return
	}
	current := actor{ID: claims.ID, Email: claims.Email, Role: claims.Role, SessionVersion: claims.SessionVersion}
	if current.ID == "" {
		c.JSON(http.StatusUnauthorized, errorBody("UNAUTHORIZED", "session is no longer valid"))
		c.Abort()
		return
	}
	c.Set("actor", current)
	c.Next()
}

func (s *Server) requireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		a := c.MustGet("actor").(actor)
		if a.Role != role {
			c.JSON(http.StatusForbidden, errorBody("FORBIDDEN", "administrator access required"))
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) integrationAuth(c *gin.Context) {
	if s.isMaintenance(c) {
		c.JSON(http.StatusServiceUnavailable, errorBody("MARKETPLACE_MAINTENANCE", "marketplace is under maintenance"))
		c.Abort()
		return
	}
	clientID, stamp, signature := c.GetHeader("X-Client-Id"), c.GetHeader("X-Timestamp"), c.GetHeader("X-Signature")
	if clientID == "" || stamp == "" || signature == "" {
		c.JSON(http.StatusUnauthorized, errorBody("INVALID_CLIENT", "signed headers are required"))
		c.Abort()
		return
	}
	unix, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || time.Since(time.Unix(unix, 0)).Abs() > timestampWindow {
		c.JSON(http.StatusUnauthorized, errorBody("REQUEST_EXPIRED", "timestamp is outside the allowed window"))
		c.Abort()
		return
	}
	credential, err := s.store.GetCredentialByClientID(c, clientID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusUnauthorized, errorBody("INVALID_CLIENT", "unknown client"))
		c.Abort()
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("AUTH_ERROR", "credential lookup failed"))
		c.Abort()
		return
	}
	if credential.Status == "REVOKED" {
		c.JSON(http.StatusForbidden, errorBody("CREDENTIAL_REVOKED", "credential was revoked"))
		c.Abort()
		return
	}
	// Check quota before decrypting the credential secret or reading the request
	// body. This keeps abuse protection ahead of the expensive signing path.
	client := integrationClient{CredentialID: credential.ID, ShopID: credential.ShopID, ClientID: credential.ClientID}
	scenario, err := s.loadScenario(c, client.ShopID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("SCENARIO_ERROR", "could not load scenario"))
		c.Abort()
		return
	}
	limit := s.cfg.RateLimitPerMinute
	resetAt := time.Now().Truncate(time.Minute).Add(time.Minute)
	if scenario.ForceRateLimit {
		s.setRateLimitHeaders(c, limit, 0, resetAt)
		c.JSON(http.StatusTooManyRequests, errorBody("RATE_LIMIT_EXCEEDED", "rate limit exceeded"))
		c.Abort()
		return
	}
	allowed, remaining := s.allowRate(c, client.CredentialID, limit)
	s.setRateLimitHeaders(c, limit, remaining, resetAt)
	if !allowed {
		c.JSON(http.StatusTooManyRequests, errorBody("RATE_LIMIT_EXCEEDED", "rate limit exceeded"))
		c.Abort()
		return
	}
	c.Set("scenario", scenario)
	secret, err := platform.Decrypt(s.cfg.EncryptionKey, credential.SecretCiphertext)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("AUTH_ERROR", "credential unavailable"))
		c.Abort()
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "could not read body"))
		c.Abort()
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	canonical := c.Request.Method + c.Request.URL.Path + stamp + string(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	expected := hex.EncodeToString(mac.Sum(nil))
	provided, err := hex.DecodeString(signature)
	expectedBytes, _ := hex.DecodeString(expected)
	if err != nil || subtle.ConstantTimeCompare(expectedBytes, provided) != 1 {
		c.JSON(http.StatusUnauthorized, errorBody("INVALID_SIGNATURE", "signature did not match"))
		c.Abort()
		return
	}
	c.Set("client", client)
	c.Next()
}

func (s *Server) isMaintenance(ctx context.Context) bool {
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT value FROM system_settings WHERE key='maintenance'`).Scan(&raw)
	return err == nil && string(raw) == "true"
}

func currentActor(c *gin.Context) actor              { return c.MustGet("actor").(actor) }
func currentClient(c *gin.Context) integrationClient { return c.MustGet("client").(integrationClient) }

func (s *Server) canAccessShop(c *gin.Context, shopID string) bool {
	a := currentActor(c)
	if a.Role == "ADMIN" {
		return true
	}
	owner, err := s.store.GetShopOwner(c, shopID)
	return err == nil && owner == a.ID
}

func (s *Server) mustAccessShop(c *gin.Context, shopID string) bool {
	if !s.canAccessShop(c, shopID) {
		c.JSON(http.StatusForbidden, errorBody("FORBIDDEN", "shop is not assigned to this operator"))
		return false
	}
	return true
}

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

func (s *Server) shopProducts(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.store.ListProductsForShop(c, store.ListProductsForShopParams{ShopID: shop, Limit: 1000})
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list products"))
		return
	}
	data := []gin.H{}
	for _, row := range rows {
		data = append(data, gin.H{"id": row.ID, "sku": row.Sku, "name": row.Name, "category": row.Category, "description": row.Description, "price": row.Price, "stock": row.Stock, "status": row.Status, "created_at": row.CreatedAt.Time, "updated_at": row.UpdatedAt.Time})
	}
	s.controlListResponse(c, data)
}

// shopWarehouses lists fulfillment origins and their aggregate available stock.
func (s *Server) shopWarehouses(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT w.id,w.code,w.name,w.status,w.address,w.priority,w.created_at,w.updated_at,COUNT(i.product_id),COALESCE(SUM(i.on_hand_quantity-i.reserved_quantity),0) FROM warehouses w LEFT JOIN warehouse_inventory i ON i.warehouse_id=w.id WHERE w.shop_id=$1 GROUP BY w.id ORDER BY w.priority DESC,w.code ASC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list warehouses"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, code, name, status string
		var address []byte
		var priority, products, available int
		var created, updated time.Time
		if err := rows.Scan(&id, &code, &name, &status, &address, &priority, &created, &updated, &products, &available); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouse"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": shop, "code": code, "name": name, "status": status, "address": json.RawMessage(address), "priority": priority, "product_count": products, "available_quantity": available, "created_at": created, "updated_at": updated})
	}
	s.controlListResponse(c, data)
}

func (s *Server) createControlWarehouse(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	input, ok := bindControlWarehouse(c)
	if !ok {
		return
	}
	address, err := json.Marshal(input.Address)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "address must be serializable"))
		return
	}
	id := platform.NewID("wh")
	if _, err := s.db.Exec(c, `INSERT INTO warehouses(id,shop_id,code,name,status,address,priority) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, shop, strings.TrimSpace(input.Code), strings.TrimSpace(input.Name), input.Status, address, input.Priority); err != nil {
		c.JSON(409, errorBody("DUPLICATE_WAREHOUSE_CODE", "warehouse code already exists for this shop"))
		return
	}
	c.JSON(201, gin.H{"id": id, "shop_id": shop, "code": strings.TrimSpace(input.Code), "name": strings.TrimSpace(input.Name), "status": input.Status, "address": input.Address, "priority": input.Priority})
}

type controlWarehouseInput struct {
	Code     string         `json:"code"`
	Name     string         `json:"name"`
	Status   string         `json:"status"`
	Address  map[string]any `json:"address"`
	Priority int            `json:"priority"`
}

func bindControlWarehouse(c *gin.Context) (controlWarehouseInput, bool) {
	var input controlWarehouseInput
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Code) == "" || strings.TrimSpace(input.Name) == "" {
		c.JSON(400, errorBody("INVALID_REQUEST", "code and name are required"))
		return controlWarehouseInput{}, false
	}
	if input.Status == "" {
		input.Status = "ACTIVE"
	}
	if input.Status != "ACTIVE" && input.Status != "INACTIVE" {
		c.JSON(400, errorBody("INVALID_REQUEST", "status must be ACTIVE or INACTIVE"))
		return controlWarehouseInput{}, false
	}
	if input.Address == nil {
		input.Address = map[string]any{}
	}
	return input, true
}

func (s *Server) updateControlWarehouse(c *gin.Context) {
	warehouseID := c.Param("id")
	var shop string
	if err := s.db.QueryRow(c, `SELECT shop_id FROM warehouses WHERE id=$1`, warehouseID).Scan(&shop); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	input, ok := bindControlWarehouse(c)
	if !ok {
		return
	}
	address, err := json.Marshal(input.Address)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "address must be serializable"))
		return
	}
	var updatedAddress []byte
	var code, name, status string
	var priority int
	err = s.db.QueryRow(c, `UPDATE warehouses SET code=$1,name=$2,status=$3,address=$4,priority=$5,updated_at=now() WHERE id=$6
		RETURNING code,name,status,address,priority`, strings.TrimSpace(input.Code), strings.TrimSpace(input.Name), input.Status, address, input.Priority, warehouseID).Scan(&code, &name, &status, &updatedAddress, &priority)
	if err != nil {
		c.JSON(409, errorBody("DUPLICATE_WAREHOUSE_CODE", "warehouse code already exists for this shop"))
		return
	}
	c.JSON(200, gin.H{"id": warehouseID, "shop_id": shop, "code": code, "name": name, "status": status, "address": json.RawMessage(updatedAddress), "priority": priority})
}

func (s *Server) warehouseDetailData(ctx context.Context, warehouseID, shopID string) (gin.H, error) {
	var id, shop, code, name, status string
	var address []byte
	var priority int
	var created, updated time.Time
	if err := s.db.QueryRow(ctx, `SELECT id,shop_id,code,name,status,address,priority,created_at,updated_at FROM warehouses WHERE id=$1 AND shop_id=$2`, warehouseID, shopID).Scan(&id, &shop, &code, &name, &status, &address, &priority, &created, &updated); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT i.product_id,p.sku,p.name,i.on_hand_quantity,i.reserved_quantity,i.on_hand_quantity-i.reserved_quantity,i.updated_at FROM warehouse_inventory i JOIN products p ON p.id=i.product_id WHERE i.warehouse_id=$1 ORDER BY p.sku ASC`, warehouseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	inventoryRows := []gin.H{}
	for rows.Next() {
		var productID, sku, productName string
		var onHand, reserved, available int
		var inventoryUpdated time.Time
		if err := rows.Scan(&productID, &sku, &productName, &onHand, &reserved, &available, &inventoryUpdated); err != nil {
			return nil, err
		}
		inventoryRows = append(inventoryRows, gin.H{"product_id": productID, "sku": sku, "product_name": productName, "on_hand_quantity": onHand, "reserved_quantity": reserved, "available_quantity": available, "updated_at": inventoryUpdated})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return gin.H{"id": id, "shop_id": shop, "code": code, "name": name, "status": status, "address": json.RawMessage(address), "priority": priority, "created_at": created, "updated_at": updated, "inventory": inventoryRows}, nil
}

func (s *Server) warehouseDetail(c *gin.Context) {
	var shop string
	if err := s.db.QueryRow(c, `SELECT shop_id FROM warehouses WHERE id=$1`, c.Param("id")).Scan(&shop); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	data, err := s.warehouseDetailData(c, c.Param("id"), shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouse"))
		return
	}
	c.JSON(200, data)
}

func (s *Server) updateWarehouseInventory(c *gin.Context) {
	warehouseID, productID := c.Param("id"), c.Param("productID")
	var input struct {
		OnHandQuantity int `json:"on_hand_quantity"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.OnHandQuantity < 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "on_hand_quantity must be non-negative"))
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start inventory update"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	var shop, inventoryShop string
	if err = tx.QueryRow(c, `SELECT w.shop_id,p.shop_id FROM warehouses w JOIN products p ON p.id=$2 WHERE w.id=$1`, warehouseID, productID).Scan(&shop, &inventoryShop); err != nil || shop != inventoryShop {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse or product not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	var previousOnHand, reserved int
	err = tx.QueryRow(c, `SELECT on_hand_quantity,reserved_quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE`, warehouseID, productID).Scan(&previousOnHand, &reserved)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not lock warehouse inventory"))
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		previousOnHand, reserved = 0, 0
	}
	if input.OnHandQuantity < reserved {
		c.JSON(400, errorBody("INVALID_REQUEST", "on_hand_quantity cannot be lower than reserved_quantity"))
		return
	}
	if _, err = tx.Exec(c, `INSERT INTO warehouse_inventory(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES($1,$2,$3,0) ON CONFLICT (warehouse_id,product_id) DO UPDATE SET on_hand_quantity=EXCLUDED.on_hand_quantity,updated_at=now()`, warehouseID, productID, input.OnHandQuantity); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update warehouse inventory"))
		return
	}
	if _, err = tx.Exec(c, `UPDATE products SET stock=stock+$1,updated_at=now() WHERE id=$2`, input.OnHandQuantity-previousOnHand, productID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update aggregate product stock"))
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit warehouse inventory"))
		return
	}
	c.JSON(200, gin.H{"warehouse_id": warehouseID, "product_id": productID, "on_hand_quantity": input.OnHandQuantity, "reserved_quantity": reserved, "available_quantity": input.OnHandQuantity - reserved})
}

func (s *Server) createControlProduct(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var in controlProductInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "sku, name, non-negative price, and stock are required"))
		return
	}
	product, err := s.catalog.Create(c, shop, in.draft())
	if errors.Is(err, products.ErrInvalidProductInput) {
		c.JSON(400, errorBody("INVALID_REQUEST", "sku, name, non-negative price, and stock are required"))
		return
	}
	if errors.Is(err, products.ErrDuplicateSKU) {
		c.JSON(409, errorBody("DUPLICATE_SKU", "sku already exists"))
		return
	}
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create product"))
		return
	}
	c.JSON(201, gin.H{"id": product.ID, "shop_id": product.ShopID, "sku": product.SKU, "name": product.Name, "category": product.Category, "description": product.Description, "price": product.Price, "stock": product.Stock, "status": product.Status})
}

func (s *Server) shopOrders(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.store.ListOrdersForShop(c, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list orders"))
		return
	}
	data := []gin.H{}
	for _, row := range rows {
		data = append(data, gin.H{"id": row.ID, "order_number": row.OrderNumber, "total_amount": row.TotalAmount, "status": row.Status, "created_at": row.CreatedAt.Time, "updated_at": row.UpdatedAt.Time})
	}
	s.controlListResponse(c, data)
}

// shopShipments lists the fulfillment records owned by one shop. Shipments are
// joined to their orders so the control plane can show the operational context
// without exposing data from another shop.
func (s *Server) shopShipments(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT s.id,s.order_id,o.order_number,s.tracking_number,s.shipping_provider,s.pickup_type,s.status,s.created_at,s.shipped_at,s.delivered_at FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.shop_id=$1 ORDER BY s.created_at DESC`, shop)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not list shipments"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, orderID, orderNumber, tracking, provider, pickupType, status string
		var created time.Time
		var shipped, delivered *time.Time
		if err := rows.Scan(&id, &orderID, &orderNumber, &tracking, &provider, &pickupType, &status, &created, &shipped, &delivered); err != nil {
			c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not read shipment"))
			return
		}
		data = append(data, shipmentControlData(id, orderID, orderNumber, tracking, provider, pickupType, status, created, shipped, delivered))
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("DATABASE_ERROR", "could not read shipments"))
		return
	}
	s.controlListResponse(c, data)
}

func (s *Server) shopPackages(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT p.id,p.order_id,o.order_number,p.status,p.created_at,COUNT(pi.order_item_id),COALESCE(w.code,''),COALESCE(w.name,'') FROM packages p JOIN orders o ON o.id=p.order_id LEFT JOIN package_items pi ON pi.package_id=p.id LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE o.shop_id=$1 GROUP BY p.id,o.order_number,w.code,w.name ORDER BY p.created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list packages"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, orderID, number, status, warehouseCode, warehouseName string
		var created time.Time
		var count int
		if err := rows.Scan(&id, &orderID, &number, &status, &created, &count, &warehouseCode, &warehouseName); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read package"))
			return
		}
		data = append(data, gin.H{"id": id, "order_id": orderID, "order_number": number, "status": status, "item_count": count, "warehouse_code": warehouseCode, "warehouse_name": warehouseName, "created_at": created})
	}
	s.controlListResponse(c, data)
}

func (s *Server) packageDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, orderID, status, warehouseID, warehouseCode, warehouseName string
	var created time.Time
	if err := s.db.QueryRow(c, `SELECT o.shop_id,p.order_id,p.status,p.created_at,COALESCE(w.id,''),COALESCE(w.code,''),COALESCE(w.name,'') FROM packages p JOIN orders o ON o.id=p.order_id LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE p.id=$1`, id).Scan(&shop, &orderID, &status, &created, &warehouseID, &warehouseCode, &warehouseName); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "package not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT oi.id,oi.sku,oi.product_name,pi.quantity FROM package_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE pi.package_id=$1`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read package items"))
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var itemID, sku, name string
		var quantity int
		if err := rows.Scan(&itemID, &sku, &name, &quantity); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read package item"))
			return
		}
		items = append(items, gin.H{"id": itemID, "sku": sku, "product_name": name, "quantity": quantity})
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "order_id": orderID, "status": status, "warehouse": gin.H{"warehouse_id": warehouseID, "warehouse_code": warehouseCode, "warehouse_name": warehouseName}, "created_at": created, "items": items})
}

func (s *Server) createControlPackage(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var input struct {
		OrderID string `json:"order_id"`
		Items   []struct {
			OrderItemID string `json:"order_item_id"`
			Quantity    int    `json:"quantity"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.OrderID == "" || len(input.Items) == 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "order_id and items are required"))
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start package"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, warehouseID string
	if err = tx.QueryRow(c, `SELECT status,COALESCE(fulfillment_warehouse_id,'') FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, input.OrderID, shop).Scan(&status, &warehouseID); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if status != orders.ReadyToShip {
		c.JSON(400, errorBody("INVALID_TRANSITION", "packages require READY_TO_SHIP"))
		return
	}
	if warehouseID == "" {
		c.JSON(400, errorBody("INVALID_TRANSITION", "order does not have a fulfillment warehouse"))
		return
	}
	packageID := platform.NewID("pkg")
	if _, err = tx.Exec(c, `INSERT INTO packages(id,order_id,warehouse_id) VALUES($1,$2,$3)`, packageID, input.OrderID, warehouseID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create package"))
		return
	}
	for _, item := range input.Items {
		var available int
		if err = tx.QueryRow(c, `SELECT oi.quantity-COALESCE((SELECT sum(quantity) FROM package_items WHERE order_item_id=oi.id),0) FROM order_items oi WHERE oi.id=$1 AND oi.order_id=$2`, item.OrderItemID, input.OrderID).Scan(&available); err != nil || item.Quantity < 1 || item.Quantity > available {
			c.JSON(400, errorBody("INVALID_REQUEST", "invalid package item quantity"))
			return
		}
		if _, err = tx.Exec(c, `INSERT INTO package_items(package_id,order_item_id,quantity) VALUES($1,$2,$3)`, packageID, item.OrderItemID, item.Quantity); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not allocate item"))
			return
		}
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit package"))
		return
	}
	c.JSON(201, gin.H{"id": packageID, "order_id": input.OrderID, "status": "READY_TO_SHIP", "item_count": len(input.Items)})
}

// shipmentDetail returns a control-plane view of one shipment and its linked
// order. It uses dashboard authorization rather than public API credentials.
func (s *Server) shipmentDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, orderID, orderNumber, tracking, provider, pickupType, status, orderStatus string
	var created time.Time
	var shipped, delivered, failed, returning, returned *time.Time
	var failureReason *string
	err := s.db.QueryRow(c, `SELECT o.shop_id,s.order_id,o.order_number,s.tracking_number,s.shipping_provider,s.pickup_type,s.status,s.created_at,s.shipped_at,s.delivered_at,o.status,s.delivery_failure_reason,s.failed_at,s.returning_at,s.returned_at FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1`, id).Scan(&shop, &orderID, &orderNumber, &tracking, &provider, &pickupType, &status, &created, &shipped, &delivered, &orderStatus, &failureReason, &failed, &returning, &returned)
	if err != nil {
		c.JSON(http.StatusNotFound, errorBody("NOT_FOUND", "shipment not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	out := shipmentControlData(id, orderID, orderNumber, tracking, provider, pickupType, status, created, shipped, delivered)
	out["shop_id"] = shop
	out["order_status"] = orderStatus
	out["delivery_failure_reason"] = failureReason
	out["failed_at"] = failed
	out["returning_at"] = returning
	out["returned_at"] = returned
	c.JSON(http.StatusOK, out)
}

// createSimulatedOrder is a control-plane customer-order generator. It emits a durable order.created event.
func (s *Server) createSimulatedOrder(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var input struct {
		Items []struct {
			ProductID string `json:"product_id"`
			Quantity  int    `json:"quantity"`
		} `json:"items"`
		Customer        map[string]any `json:"customer"`
		ShippingAddress map[string]any `json:"shipping_address"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid simulated order"))
		return
	}
	if len(input.Items) == 0 {
		var productID string
		if err := s.db.QueryRow(c, `SELECT id FROM products WHERE shop_id=$1 AND status='ACTIVE' AND stock>0 ORDER BY random() LIMIT 1`, shop).Scan(&productID); err != nil {
			c.JSON(400, errorBody("NO_PRODUCTS", "an active product is required"))
			return
		}
		input.Items = append(input.Items, struct {
			ProductID string `json:"product_id"`
			Quantity  int    `json:"quantity"`
		}{ProductID: productID, Quantity: 1})
	}
	if input.Customer == nil {
		dummy := dummygenerator.New(time.Now().UnixNano())
		customer := dummy.Customer()
		input.Customer = map[string]any{"name": customer.Name, "phone": customer.Phone}
	}
	if input.ShippingAddress == nil {
		dummy := dummygenerator.New(time.Now().UnixNano() + 1)
		address := dummy.IndonesianAddress()
		input.ShippingAddress = map[string]any{"address_line": address.AddressLine, "city": address.City, "postal_code": address.PostalCode}
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start order"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	orderID, total := platform.NewID("ord"), int64(0)
	customer, err := json.Marshal(input.Customer)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode customer"))
		return
	}
	address, err := json.Marshal(input.ShippingAddress)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode shipping address"))
		return
	}
	number := "SIM-" + strings.ToUpper(platform.NewID(""))[1:]
	if _, err := tx.Exec(c, `INSERT INTO orders(id,order_number,shop_id,customer_data,shipping_address,total_amount,status,payment_status,payment_expires_at) VALUES($1,$2,$3,$4,$5,0,'UNPAID','PENDING',now()+($6 * interval '1 second'))`, orderID, number, shop, customer, address, int(s.paymentExpiry().Seconds())); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create order"))
		return
	}
	reservationLines := make([]inventory.Line, 0, len(input.Items))
	for _, item := range input.Items {
		if item.Quantity <= 0 {
			c.JSON(400, errorBody("INVALID_REQUEST", "item quantity must be positive"))
			return
		}
		var sku, name string
		var price int64
		if err := tx.QueryRow(c, `SELECT sku,name,price FROM products WHERE id=$1 AND shop_id=$2 AND status='ACTIVE'`, item.ProductID, shop).Scan(&sku, &name, &price); err != nil {
			c.JSON(400, errorBody("INVALID_ITEM", "product unavailable or insufficient stock"))
			return
		}
		subtotal := price * int64(item.Quantity)
		total += subtotal
		orderItemID := platform.NewID("item")
		if _, err := tx.Exec(c, `INSERT INTO order_items(id,order_id,product_id,sku,product_name,price,quantity,subtotal) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, orderItemID, orderID, item.ProductID, sku, name, price, item.Quantity, subtotal); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not create order item"))
			return
		}
		reservationLines = append(reservationLines, inventory.Line{OrderItemID: orderItemID, ProductID: item.ProductID, Quantity: item.Quantity})
	}
	warehouse, err := inventory.Allocate(c, tx, shop, orderID, reservationLines)
	if err != nil {
		if errors.Is(err, inventory.ErrNoEligibleWarehouse) {
			c.JSON(400, errorBody("INSUFFICIENT_WAREHOUSE_INVENTORY", "no active warehouse can fulfill all order items"))
			return
		}
		c.JSON(500, errorBody("INVENTORY_ERROR", "could not reserve warehouse inventory"))
		return
	}
	if _, err := tx.Exec(c, `UPDATE orders SET total_amount=$1 WHERE id=$2`, total, orderID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not set order total"))
		return
	}
	if err := events.Record(c, tx, shop, "order.created", orderID, gin.H{"id": orderID, "order_number": number, "status": orders.Unpaid, "total_amount": total, "fulfillment_warehouse_id": warehouse.ID}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not create event"))
		return
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit order"))
		return
	}
	c.JSON(201, gin.H{"id": orderID, "order_number": number, "status": orders.Unpaid, "total_amount": total, "fulfillment": gin.H{"warehouse_id": warehouse.ID, "warehouse_code": warehouse.Code, "warehouse_name": warehouse.Name}})
}

func (s *Server) createCredential(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	secret := platform.NewID("sec")
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, secret)
	if err != nil {
		c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect secret"))
		return
	}
	accessToken := platform.NewID("acc")
	tokenCipher, err := platform.Encrypt(s.cfg.EncryptionKey, accessToken)
	if err != nil {
		c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect access token"))
		return
	}
	id, clientID := platform.NewID("cred"), platform.NewID("client")
	_, err = s.db.Exec(c, `INSERT INTO credentials(id,shop_id,client_id,secret_ciphertext,access_token_ciphertext) VALUES($1,$2,$3,$4,$5)`, id, shop, clientID, cipher, tokenCipher)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create credential"))
		return
	}
	c.JSON(201, gin.H{"id": id, "shop_id": shop, "client_id": clientID, "client_secret": secret, "access_token": accessToken, "status": "ACTIVE"})
}

func (s *Server) listCredentials(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT id,client_id,status,created_at,revoked_at FROM credentials WHERE shop_id=$1 ORDER BY created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list credentials"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, clientID, status string
		var created time.Time
		var revoked *time.Time
		if err := rows.Scan(&id, &clientID, &status, &created, &revoked); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read credential"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": shop, "client_id": clientID, "status": status, "created_at": created, "revoked_at": revoked})
	}
	s.controlListResponse(c, data)
}

func (s *Server) revokeCredential(c *gin.Context) {
	id := c.Param("id")
	shop, err := s.store.GetCredentialShop(c, id)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "credential not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	_, err = s.store.RevokeCredential(c, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not revoke credential"))
		return
	}
	c.Status(204)
}

func (s *Server) orderDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, num, status string
	var total int64
	var customer, address []byte
	var paymentReference *string
	var paidAt *time.Time
	var created, updated time.Time
	err := s.db.QueryRow(c, `SELECT shop_id,order_number,customer_data,shipping_address,total_amount,status,payment_reference,paid_at,created_at,updated_at FROM orders WHERE id=$1`, id).Scan(&shop, &num, &customer, &address, &total, &status, &paymentReference, &paidAt, &created, &updated)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	shipment := s.shipmentForOrder(c, id)
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "order_number": num, "customer_data": json.RawMessage(customer), "shipping_address": json.RawMessage(address), "total_amount": total, "status": status, "payment": paymentInfo(paymentReference, paidAt), "operations": s.orderOperations(c, id), "fulfillment": s.fulfillmentForOrder(c, id), "created_at": created, "updated_at": updated, "items": s.items(c, id), "shipment": shipment, "shipments": shipmentList(shipment), "events": s.events(c, id), "deliveries": s.deliveriesForOrder(c, id)})
}

func (s *Server) controlWebhooks(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	s.webhookListResponse(c, shop)
}

func (s *Server) createControlWebhook(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	in, err := parseWebhookInput(c)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", err.Error()))
		return
	}
	generated := in.Secret == ""
	if generated {
		in.Secret = platform.NewID("whsec")
	}
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, in.Secret)
	if err != nil {
		c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect webhook secret"))
		return
	}
	events, err := json.Marshal(in.SubscribedEvents)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode subscribed events"))
		return
	}
	id := platform.NewID("wh")
	if _, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, shop, in.URL, cipher, events); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create webhook"))
		return
	}
	out := gin.H{"id": id, "shop_id": shop, "url": in.URL, "enabled": true, "subscribed_events": in.SubscribedEvents}
	if generated {
		out["secret"] = in.Secret
	}
	c.JSON(201, out)
}

// updateControlWebhook changes a registration without exposing its stored secret.
func (s *Server) updateControlWebhook(c *gin.Context) {
	shop, id := c.Param("shopID"), c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	in, err := parseWebhookInput(c)
	if err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", err.Error()))
		return
	}
	cipher := ""
	if in.Secret != "" {
		cipher, err = platform.Encrypt(s.cfg.EncryptionKey, in.Secret)
		if err != nil {
			c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect webhook secret"))
			return
		}
	}
	events, err := json.Marshal(in.SubscribedEvents)
	if err != nil {
		c.JSON(500, errorBody("SERIALIZATION_ERROR", "could not encode subscribed events"))
		return
	}
	command, err := s.db.Exec(c, `UPDATE webhooks SET url=$1,subscribed_events=$2,enabled=$3,secret_ciphertext=CASE WHEN $4='' THEN secret_ciphertext ELSE $4 END WHERE id=$5 AND shop_id=$6`, in.URL, events, in.Enabled, cipher, id, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update webhook"))
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(404, errorBody("NOT_FOUND", "webhook not found"))
		return
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "url": in.URL, "enabled": in.Enabled, "subscribed_events": in.SubscribedEvents})
}

func (s *Server) deleteControlWebhook(c *gin.Context) {
	shop, id := c.Param("shopID"), c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	command, err := s.db.Exec(c, `DELETE FROM webhooks WHERE id=$1 AND shop_id=$2`, id, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not delete webhook"))
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(404, errorBody("NOT_FOUND", "webhook not found"))
		return
	}
	c.Status(http.StatusNoContent)
}

type webhookInput struct {
	URL              string   `json:"url"`
	Secret           string   `json:"secret"`
	SubscribedEvents []string `json:"subscribed_events"`
	Enabled          bool     `json:"enabled"`
}

func parseWebhookInput(c *gin.Context) (webhookInput, error) {
	var input webhookInput
	if err := c.ShouldBindJSON(&input); err != nil {
		return webhookInput{}, fmt.Errorf("invalid webhook request")
	}
	if input.URL == "" || len(input.SubscribedEvents) == 0 {
		return webhookInput{}, fmt.Errorf("url and subscribed_events are required")
	}
	parsed, err := url.ParseRequestURI(input.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return webhookInput{}, fmt.Errorf("webhook URL must be http or https")
	}
	for _, eventType := range input.SubscribedEvents {
		if !webhooks.SupportsEvent(eventType) {
			return webhookInput{}, fmt.Errorf("unsupported webhook event %q", eventType)
		}
	}
	return input, nil
}

func (s *Server) controlDeliveries(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT d.id,d.event_id,d.status,d.attempt_count,d.created_at,d.delivered_at,d.next_attempt_at,e.event_type,w.url,COALESCE(last_attempt.response_body,'') FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id JOIN domain_events e ON e.id=d.event_id LEFT JOIN LATERAL (SELECT response_body FROM webhook_delivery_attempts WHERE delivery_id=d.id AND status='FAILURE' ORDER BY attempt DESC LIMIT 1) last_attempt ON true WHERE w.shop_id=$1 ORDER BY d.created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list deliveries"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, event, status, eventType, endpoint, failureReason string
		var attempts int
		var created time.Time
		var delivered, nextAttempt *time.Time
		if err := rows.Scan(&id, &event, &status, &attempts, &created, &delivered, &nextAttempt, &eventType, &endpoint, &failureReason); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read delivery"))
			return
		}
		data = append(data, gin.H{"id": id, "event_id": event, "event_type": eventType, "endpoint": endpoint, "status": status, "attempt_count": attempts, "next_attempt_at": nextAttempt, "failure_reason": failureReason, "created_at": created, "delivered_at": delivered})
	}
	s.controlListResponse(c, data)
}

func (s *Server) deliveryDetail(c *gin.Context) {
	id := c.Param("id")
	var shop, eventID, status string
	var attempts int
	err := s.db.QueryRow(c, `SELECT w.shop_id,d.event_id,d.status,d.attempt_count FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=$1`, id).Scan(&shop, &eventID, &status, &attempts)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "delivery not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	rows, err := s.db.Query(c, `SELECT id,attempt,response_status,response_body,duration_ms,status,created_at FROM webhook_delivery_attempts WHERE delivery_id=$1 ORDER BY attempt`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load delivery attempts"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var attemptID, body, attemptStatus string
		var attempt, duration int
		var responseStatus *int
		var created time.Time
		if err := rows.Scan(&attemptID, &attempt, &responseStatus, &body, &duration, &attemptStatus, &created); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read delivery attempt"))
			return
		}
		data = append(data, gin.H{"id": attemptID, "attempt": attempt, "response_status": responseStatus, "response_body": body, "duration_ms": duration, "status": attemptStatus, "created_at": created})
	}
	c.JSON(200, gin.H{"id": id, "shop_id": shop, "event_id": eventID, "status": status, "attempt_count": attempts, "attempts": data})
}

func (s *Server) getScenario(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	s.scenarioResponse(c, shop)
}
func (s *Server) putScenario(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var v scenarios.Config
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid scenario configuration"))
		return
	}
	if err := v.Validate(); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid scenario values"))
		return
	}
	_, err := s.db.Exec(c, `INSERT INTO shop_scenarios(shop_id,api_slow_ms,api_slow_probability,api_random_500_probability,api_timeout_probability,force_rate_limit,webhook_duplicate,webhook_delay_seconds,webhook_out_of_order,webhook_force_failure) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(shop_id) DO UPDATE SET api_slow_ms=EXCLUDED.api_slow_ms,api_slow_probability=EXCLUDED.api_slow_probability,api_random_500_probability=EXCLUDED.api_random_500_probability,api_timeout_probability=EXCLUDED.api_timeout_probability,force_rate_limit=EXCLUDED.force_rate_limit,webhook_duplicate=EXCLUDED.webhook_duplicate,webhook_delay_seconds=EXCLUDED.webhook_delay_seconds,webhook_out_of_order=EXCLUDED.webhook_out_of_order,webhook_force_failure=EXCLUDED.webhook_force_failure,updated_at=now()`, shop, v.APISlowMS, v.APISlowProbability, v.APIRandom500Probability, v.APITimeoutProbability, v.ForceRateLimit, v.WebhookDuplicate, v.WebhookDelaySeconds, v.WebhookOutOfOrder, v.WebhookForceFailure)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not save scenario"))
		return
	}
	s.scenarioResponse(c, shop)
}

func (s *Server) scenarioResponse(c *gin.Context, shop string) {
	v, err := s.loadScenario(c, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load scenario"))
		return
	}
	c.JSON(200, v)
}

func (s *Server) maintenance(c *gin.Context) {
	var v struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "enabled is required"))
		return
	}
	raw, _ := json.Marshal(v.Enabled)
	_, err := s.db.Exec(c, `INSERT INTO system_settings(key,value) VALUES('maintenance',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, raw)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update maintenance"))
		return
	}
	c.JSON(200, gin.H{"enabled": v.Enabled})
}

func (s *Server) getMaintenance(c *gin.Context) {
	var raw []byte
	err := s.db.QueryRow(c, `SELECT value FROM system_settings WHERE key='maintenance'`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(200, gin.H{"enabled": false})
		return
	}
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load maintenance mode"))
		return
	}
	var enabled bool
	if err := json.Unmarshal(raw, &enabled); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "maintenance setting is malformed"))
		return
	}
	c.JSON(200, gin.H{"enabled": enabled})
}

func (s *Server) listUsers(c *gin.Context) {
	rows, err := s.db.Query(c, `SELECT id,email,role,created_at FROM users ORDER BY created_at`)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list users"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, email, role string
		var created time.Time
		if err := rows.Scan(&id, &email, &role, &created); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read user"))
			return
		}
		data = append(data, gin.H{"id": id, "email": email, "role": role, "created_at": created})
	}
	s.controlListResponse(c, data)
}

func (s *Server) createUser(c *gin.Context) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Email == "" || len(in.Password) < 8 || (in.Role != "ADMIN" && in.Role != "OPERATOR") {
		c.JSON(400, errorBody("INVALID_REQUEST", "email, 8+ character password, and valid role are required"))
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(500, errorBody("PASSWORD_ERROR", "could not secure password"))
		return
	}
	id := platform.NewID("usr")
	_, err = s.db.Exec(c, `INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)`, id, strings.ToLower(in.Email), string(hash), in.Role)
	if err != nil {
		c.JSON(409, errorBody("EMAIL_EXISTS", "email already exists"))
		return
	}
	c.JSON(201, gin.H{"id": id, "email": strings.ToLower(in.Email), "role": in.Role})
}

type productInput struct {
	SKU         string `json:"sku"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Price       int64  `json:"price"`
	Stock       int    `json:"stock"`
	Status      string `json:"status"`
}

type warehouseStockInput struct {
	WarehouseID    string `json:"warehouse_id"`
	OnHandQuantity int    `json:"on_hand_quantity"`
}

// controlProductInput accepts an optional initial allocation. Public product
// APIs retain their legacy single-stock input and default-warehouse behavior.
type controlProductInput struct {
	SKU                string                `json:"sku"`
	Name               string                `json:"name"`
	Category           string                `json:"category"`
	Description        string                `json:"description"`
	Price              int64                 `json:"price"`
	Stock              int                   `json:"stock"`
	Status             string                `json:"status"`
	WarehouseInventory []warehouseStockInput `json:"warehouse_inventory"`
}

func (in controlProductInput) draft() products.Draft {
	allocations := make([]products.InitialInventory, 0, len(in.WarehouseInventory))
	for _, allocation := range in.WarehouseInventory {
		allocations = append(allocations, products.InitialInventory{WarehouseID: allocation.WarehouseID, OnHandQuantity: allocation.OnHandQuantity})
	}
	return products.Draft{SKU: in.SKU, Name: in.Name, Category: in.Category, Description: in.Description, Price: in.Price, Stock: in.Stock, Status: in.Status, InitialInventory: allocations}
}

// productPatchInput deliberately uses pointers. A zero price or stock is a
// valid explicit update, while an omitted property must leave the stored value
// unchanged.
type productPatchInput struct {
	Name        *string `json:"name"`
	Category    *string `json:"category"`
	Description *string `json:"description"`
	Price       *int64  `json:"price"`
	Stock       *int    `json:"stock"`
	Status      *string `json:"status"`
}

func (s *Server) createProduct(c *gin.Context) {
	var in productInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "sku, name, non-negative price, and stock are required"))
		return
	}
	client := currentClient(c)
	product, err := s.catalog.Create(c, client.ShopID, products.Draft{SKU: in.SKU, Name: in.Name, Category: in.Category, Description: in.Description, Price: in.Price, Stock: in.Stock, Status: in.Status})
	if errors.Is(err, products.ErrInvalidProductInput) {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid product input"))
		return
	}
	if errors.Is(err, products.ErrDuplicateSKU) {
		c.JSON(409, errorBody("DUPLICATE_SKU", "sku already exists"))
		return
	}
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create product"))
		return
	}
	c.JSON(201, gin.H{"id": product.ID, "shop_id": product.ShopID, "sku": product.SKU, "name": product.Name, "category": product.Category, "description": product.Description, "price": product.Price, "stock": product.Stock, "status": product.Status})
}

func (s *Server) listProducts(c *gin.Context) {
	client := currentClient(c)
	limit, cursor := page(c)
	sortField := c.DefaultQuery("sort", "created_at")
	direction := strings.ToUpper(c.DefaultQuery("direction", "DESC"))
	sort, err := sortClause(c, map[string]string{"created_at": "created_at", "updated_at": "updated_at", "name": "name", "category": "category", "price": "price", "stock": "stock"}, "created_at")
	if err != nil {
		c.JSON(400, errorBody("INVALID_SORT", err.Error()))
		return
	}
	args := []any{client.ShopID}
	where := `shop_id=$1 AND status <> 'DELETED'`
	if q := strings.TrimSpace(c.Query("search")); q != "" {
		args = append(args, "%"+q+"%")
		where += fmt.Sprintf(` AND (name ILIKE $%d OR sku ILIKE $%d)`, len(args), len(args))
	}
	if status := c.Query("status"); status != "" {
		args = append(args, status)
		where += fmt.Sprintf(` AND status=$%d`, len(args))
	}
	if category := strings.TrimSpace(c.Query("category")); category != "" {
		args = append(args, category)
		where += fmt.Sprintf(` AND category=$%d`, len(args))
	}
	if err := applyCursor(&args, &where, cursor, sortField, direction, productCursorValue); err != nil {
		c.JSON(400, errorBody("INVALID_CURSOR", err.Error()))
		return
	}
	args = append(args, limit+1)
	query := fmt.Sprintf(`SELECT id,sku,name,category,description,price,stock,status,created_at,updated_at FROM products WHERE %s ORDER BY %s, id %s LIMIT $%d`, where, sort, direction, len(args))
	rows, err := s.db.Query(c, query, args...)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list products"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, sku, name, category, desc, status string
		var price int64
		var stock int
		var created, updated time.Time
		if err := rows.Scan(&id, &sku, &name, &category, &desc, &price, &stock, &status, &created, &updated); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read product"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": client.ShopID, "sku": sku, "name": name, "category": category, "description": desc, "price": price, "stock": stock, "status": status, "created_at": created, "updated_at": updated})
	}
	respondPage(c, data, limit, sortField, direction)
}

// listWarehouses exposes the authenticated shop's fulfillment origins without
// leaking inventory from any other shop.
func (s *Server) listWarehouses(c *gin.Context) {
	client := currentClient(c)
	rows, err := s.db.Query(c, `SELECT id,code,name,status,address,priority,created_at,updated_at FROM warehouses WHERE shop_id=$1 ORDER BY priority DESC,code ASC`, client.ShopID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list warehouses"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, code, name, status string
		var address []byte
		var priority int
		var created, updated time.Time
		if err := rows.Scan(&id, &code, &name, &status, &address, &priority, &created, &updated); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouse"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": client.ShopID, "code": code, "name": name, "status": status, "address": json.RawMessage(address), "priority": priority, "created_at": created, "updated_at": updated})
	}
	if err := rows.Err(); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not read warehouses"))
		return
	}
	c.JSON(200, gin.H{"data": data})
}

func (s *Server) getWarehouse(c *gin.Context) {
	client := currentClient(c)
	data, err := s.warehouseDetailData(c, c.Param("id"), client.ShopID)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "warehouse not found"))
		return
	}
	c.JSON(200, data)
}

func (s *Server) getProduct(c *gin.Context) {
	client := currentClient(c)
	product, err := s.store.GetProductForShop(c, store.GetProductForShopParams{ID: c.Param("id"), ShopID: client.ShopID})
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "product not found"))
		return
	}
	c.JSON(200, gin.H{"id": product.ID, "shop_id": client.ShopID, "sku": product.Sku, "name": product.Name, "category": product.Category, "description": product.Description, "price": product.Price, "stock": product.Stock, "status": product.Status, "created_at": product.CreatedAt.Time, "updated_at": product.UpdatedAt.Time})
}

func (s *Server) updateProduct(c *gin.Context) {
	client := currentClient(c)
	var in productPatchInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid product request"))
		return
	}
	var exists bool
	_ = s.db.QueryRow(c, `SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND shop_id=$2 AND status <> 'DELETED')`, c.Param("id"), client.ShopID).Scan(&exists)
	if !exists {
		c.JSON(404, errorBody("NOT_FOUND", "product not found"))
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start transaction"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	if in.Name != nil && strings.TrimSpace(*in.Name) == "" {
		c.JSON(400, errorBody("INVALID_REQUEST", "product name cannot be empty"))
		return
	}
	if in.Category != nil && strings.TrimSpace(*in.Category) == "" {
		c.JSON(400, errorBody("INVALID_REQUEST", "product category cannot be empty"))
		return
	}
	if in.Price != nil && *in.Price < 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "price must be non-negative"))
		return
	}
	if in.Stock != nil && *in.Stock < 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "stock must be non-negative"))
		return
	}
	if in.Status != nil && *in.Status != "ACTIVE" && *in.Status != "INACTIVE" {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid product status"))
		return
	}
	// The legacy product stock field is the aggregate available quantity. For
	// backwards-compatible PATCH requests, apply its delta to WH-DEFAULT rather
	// than leaving warehouse inventory and the aggregate out of sync. Stock that
	// belongs to other warehouses must be adjusted through their own inventory
	// endpoint.
	if in.Stock != nil {
		var currentStock int
		if err = tx.QueryRow(c, `SELECT stock FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE`, c.Param("id"), client.ShopID).Scan(&currentStock); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not lock product stock"))
			return
		}
		warehouseID, ensureErr := inventory.EnsureDefaultWarehouse(c, tx, client.ShopID)
		if ensureErr != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not load default warehouse"))
			return
		}
		var onHand, reserved int
		if err = tx.QueryRow(c, `SELECT on_hand_quantity,reserved_quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE`, warehouseID, c.Param("id")).Scan(&onHand, &reserved); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not lock default warehouse inventory"))
			return
		}
		if onHand+*in.Stock-currentStock < reserved {
			c.JSON(400, errorBody("INVALID_REQUEST", "stock cannot reduce default warehouse below its reserved quantity"))
			return
		}
		if _, err = tx.Exec(c, `UPDATE warehouse_inventory SET on_hand_quantity=on_hand_quantity+$1,updated_at=now() WHERE warehouse_id=$2 AND product_id=$3`, *in.Stock-currentStock, warehouseID, c.Param("id")); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not update default warehouse inventory"))
			return
		}
	}
	name, category, description, status := "", "", "", ""
	price, stock := int64(0), 0
	if in.Name != nil {
		name = *in.Name
	}
	if in.Category != nil {
		category = *in.Category
	}
	if in.Description != nil {
		description = *in.Description
	}
	if in.Price != nil {
		price = *in.Price
	}
	if in.Stock != nil {
		stock = *in.Stock
	}
	if in.Status != nil {
		status = *in.Status
	}
	_, err = tx.Exec(c, `UPDATE products SET name=CASE WHEN $1 THEN $2 ELSE name END,category=CASE WHEN $3 THEN $4 ELSE category END,description=CASE WHEN $5 THEN $6 ELSE description END,price=CASE WHEN $7 THEN $8 ELSE price END,stock=CASE WHEN $9 THEN $10 ELSE stock END,status=CASE WHEN $11 THEN $12 ELSE status END,updated_at=now() WHERE id=$13 AND shop_id=$14`, in.Name != nil, name, in.Category != nil, category, in.Description != nil, description, in.Price != nil, price, in.Stock != nil, stock, in.Status != nil, status, c.Param("id"), client.ShopID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update product"))
		return
	}
	if err = events.Record(c, tx, client.ShopID, "product.updated", c.Param("id"), gin.H{"id": c.Param("id")}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not create domain event"))
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update product"))
		return
	}
	s.getProduct(c)
}

// deleteProduct soft-deletes a product and atomically emits a durable event.
func (s *Server) deleteProduct(c *gin.Context) {
	client := currentClient(c)
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start transaction"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	deleted, err := s.store.WithTx(tx).SoftDeleteProduct(c, store.SoftDeleteProductParams{ID: c.Param("id"), ShopID: client.ShopID})
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not delete product"))
		return
	}
	if deleted == 0 {
		c.JSON(404, errorBody("NOT_FOUND", "product not found"))
		return
	}
	if err = events.Record(c, tx, client.ShopID, "product.deleted", c.Param("id"), gin.H{"id": c.Param("id")}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not create domain event"))
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not delete product"))
		return
	}
	c.Status(http.StatusNoContent)
}

// shopeeListProducts exposes the catalogue using a Shopee-like page-number
// contract and item terminology. Product persistence remains canonical per
// shop, while the public representation belongs to the provider adapter.
func (s *Server) shopeeListProducts(c *gin.Context) {
	client := currentClient(c)
	pageNo, pageSize := 1, 20
	var err error
	if raw := c.Query("page_no"); raw != "" {
		pageNo, err = strconv.Atoi(raw)
		if err != nil || pageNo < 1 {
			s.shopeeError(c, http.StatusBadRequest, "error_param", "page_no must be a positive integer")
			return
		}
	}
	if raw := c.Query("page_size"); raw != "" {
		pageSize, err = strconv.Atoi(raw)
		if err != nil || pageSize < 1 || pageSize > 100 {
			s.shopeeError(c, http.StatusBadRequest, "error_param", "page_size must be between 1 and 100")
			return
		}
	}
	args := []any{client.ShopID}
	where := "shop_id=$1 AND status <> 'DELETED'"
	if raw := strings.TrimSpace(c.Query("item_status")); raw != "" {
		args = append(args, strings.ToUpper(raw))
		where += fmt.Sprintf(" AND status=$%d", len(args))
	}
	if raw := strings.TrimSpace(c.Query("item_name")); raw != "" {
		args = append(args, "%"+raw+"%")
		where += fmt.Sprintf(" AND name ILIKE $%d", len(args))
	}
	var total int
	if err := s.db.QueryRow(c, fmt.Sprintf("SELECT count(*) FROM products WHERE %s", where), args...).Scan(&total); err != nil {
		s.shopeeError(c, http.StatusInternalServerError, "error_system", "could not list items")
		return
	}
	args = append(args, pageSize, (pageNo-1)*pageSize)
	rows, err := s.db.Query(c, fmt.Sprintf("SELECT id,sku,name,category,price,stock,status,updated_at FROM products WHERE %s ORDER BY updated_at DESC,id DESC LIMIT $%d OFFSET $%d", where, len(args)-1, len(args)), args...)
	if err != nil {
		s.shopeeError(c, http.StatusInternalServerError, "error_system", "could not list items")
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, sku, name, category, status string
		var price int64
		var stock int
		var updated time.Time
		if err := rows.Scan(&id, &sku, &name, &category, &price, &stock, &status, &updated); err != nil {
			s.shopeeError(c, http.StatusInternalServerError, "error_system", "could not read item")
			return
		}
		items = append(items, gin.H{"item_id": id, "item_sku": sku, "item_name": name, "category_name": category, "original_price": price, "current_stock": stock, "item_status": status, "update_time": updated.Unix()})
	}
	s.shopeeSuccess(c, gin.H{"item": items, "page_no": pageNo, "page_size": pageSize, "total_count": total, "has_next_page": pageNo*pageSize < total})
}

func (s *Server) shopeeGetProduct(c *gin.Context) {
	client := currentClient(c)
	product, err := s.productForShop(c, c.Param("id"), client.ShopID)
	if err != nil {
		s.shopeeError(c, http.StatusNotFound, "error_not_found", "item not found")
		return
	}
	s.shopeeSuccess(c, gin.H{"item_id": product.ID, "item_sku": product.SKU, "item_name": product.Name, "category_name": product.Category, "description": product.Description, "original_price": product.Price, "current_stock": product.Stock, "item_status": product.Status, "create_time": product.CreatedAt.Unix(), "update_time": product.UpdatedAt.Unix()})
}

func (s *Server) tokopediaListProducts(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		PageSize  int    `json:"page_size"`
		PageToken string `json:"page_token"`
		Keyword   string `json:"keyword"`
	}
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		s.tokopediaError(c, 400, "invalid request body")
		return
	}
	if input.PageSize == 0 {
		input.PageSize = 20
	}
	if input.PageSize < 1 || input.PageSize > 100 {
		s.tokopediaError(c, 400, "page_size must be between 1 and 100")
		return
	}
	offset := 0
	if input.PageToken != "" {
		raw, err := base64.RawURLEncoding.DecodeString(input.PageToken)
		if err != nil {
			s.tokopediaError(c, 400, "invalid page_token")
			return
		}
		offset, err = strconv.Atoi(string(raw))
		if err != nil || offset < 0 {
			s.tokopediaError(c, 400, "invalid page_token")
			return
		}
	}
	args := []any{client.ShopID}
	where := "shop_id=$1 AND status <> 'DELETED'"
	if keyword := strings.TrimSpace(input.Keyword); keyword != "" {
		args = append(args, "%"+keyword+"%")
		where += fmt.Sprintf(" AND (name ILIKE $%d OR sku ILIKE $%d)", len(args), len(args))
	}
	args = append(args, input.PageSize+1, offset)
	rows, err := s.db.Query(c, fmt.Sprintf("SELECT id,sku,name,category,price,stock,status,updated_at FROM products WHERE %s ORDER BY updated_at DESC,id DESC LIMIT $%d OFFSET $%d", where, len(args)-1, len(args)), args...)
	if err != nil {
		s.tokopediaError(c, 500, "could not search products")
		return
	}
	defer rows.Close()
	products := []gin.H{}
	for rows.Next() {
		var id, sku, name, category, status string
		var price int64
		var stock int
		var updated time.Time
		if err := rows.Scan(&id, &sku, &name, &category, &price, &stock, &status, &updated); err != nil {
			s.tokopediaError(c, 500, "could not read product")
			return
		}
		products = append(products, gin.H{"product_id": id, "sku": sku, "name": name, "category": category, "price": price, "stock": stock, "status": status, "updated_at": updated.Unix()})
	}
	hasMore := len(products) > input.PageSize
	if hasMore {
		products = products[:input.PageSize]
	}
	next := ""
	if hasMore {
		next = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + input.PageSize)))
	}
	s.tokopediaSuccess(c, gin.H{"products": products, "next_page_token": next, "has_more": hasMore})
}

func (s *Server) tokopediaGetProduct(c *gin.Context) {
	client := currentClient(c)
	product, err := s.productForShop(c, c.Param("id"), client.ShopID)
	if err != nil {
		s.tokopediaError(c, 400, "product not found")
		return
	}
	s.tokopediaSuccess(c, gin.H{"product_id": product.ID, "sku": product.SKU, "name": product.Name, "category": product.Category, "description": product.Description, "price": product.Price, "stock": product.Stock, "status": product.Status, "created_at": product.CreatedAt.Unix(), "updated_at": product.UpdatedAt.Unix()})
}

type providerProduct struct {
	ID          string
	SKU         string
	Name        string
	Category    string
	Description string
	Price       int64
	Stock       int32
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (s *Server) productForShop(ctx context.Context, id, shopID string) (providerProduct, error) {
	row, err := s.store.GetProductForShop(ctx, store.GetProductForShopParams{ID: id, ShopID: shopID})
	if err != nil {
		return providerProduct{}, err
	}
	if row.Status == "DELETED" {
		return providerProduct{}, errors.New("product not found")
	}
	return providerProduct{ID: row.ID, SKU: row.Sku, Name: row.Name, Category: row.Category, Description: row.Description, Price: row.Price, Stock: row.Stock, Status: row.Status, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time}, nil
}

// shopeeListOrders uses page_no/page_size and Shopee-like names rather than
// exposing the Generic cursor contract. It is purposely separate so adapters
// must handle different filters and response envelopes.
func (s *Server) shopeeListOrders(c *gin.Context) {
	client := currentClient(c)
	pageNo, pageSize := 1, 20
	var err error
	if raw := c.Query("page_no"); raw != "" {
		pageNo, err = strconv.Atoi(raw)
		if err != nil || pageNo < 1 {
			s.shopeeError(c, 400, "error_param", "page_no must be a positive integer")
			return
		}
	}
	if raw := c.Query("page_size"); raw != "" {
		pageSize, err = strconv.Atoi(raw)
		if err != nil || pageSize < 1 || pageSize > 100 {
			s.shopeeError(c, 400, "error_param", "page_size must be between 1 and 100")
			return
		}
	}
	args := []any{client.ShopID}
	where := "shop_id=$1"
	if status := c.Query("order_status"); status != "" {
		args = append(args, strings.ToUpper(status))
		where += fmt.Sprintf(" AND status=$%d", len(args))
	}
	if raw := c.Query("time_from"); raw != "" {
		value, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			s.shopeeError(c, 400, "error_param", "time_from must be Unix seconds")
			return
		}
		args = append(args, time.Unix(value, 0))
		where += fmt.Sprintf(" AND created_at >= $%d", len(args))
	}
	if raw := c.Query("time_to"); raw != "" {
		value, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			s.shopeeError(c, 400, "error_param", "time_to must be Unix seconds")
			return
		}
		args = append(args, time.Unix(value, 0))
		where += fmt.Sprintf(" AND created_at <= $%d", len(args))
	}
	var total int
	if err := s.db.QueryRow(c, fmt.Sprintf("SELECT count(*) FROM orders WHERE %s", where), args...).Scan(&total); err != nil {
		s.shopeeError(c, 500, "error_system", "could not list orders")
		return
	}
	args = append(args, pageSize, (pageNo-1)*pageSize)
	rows, err := s.db.Query(c, fmt.Sprintf("SELECT id,order_number,total_amount,status,created_at,updated_at FROM orders WHERE %s ORDER BY created_at DESC,id DESC LIMIT $%d OFFSET $%d", where, len(args)-1, len(args)), args...)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "could not list orders")
		return
	}
	defer rows.Close()
	list := []gin.H{}
	for rows.Next() {
		var id, orderSN, status string
		var totalAmount int64
		var created, updated time.Time
		if err := rows.Scan(&id, &orderSN, &totalAmount, &status, &created, &updated); err != nil {
			s.shopeeError(c, 500, "error_system", "could not read orders")
			return
		}
		list = append(list, gin.H{"order_id": id, "order_sn": orderSN, "total_amount": totalAmount, "order_status": status, "create_time": created.Unix(), "update_time": updated.Unix()})
	}
	s.shopeeSuccess(c, gin.H{"order_list": list, "more": pageNo*pageSize < total, "page_no": pageNo, "page_size": pageSize, "total_count": total})
}

func (s *Server) shopeeGetOrder(c *gin.Context) {
	client := currentClient(c)
	var id, number, status string
	var total int64
	var customer, address []byte
	var created, updated time.Time
	err := s.db.QueryRow(c, `SELECT id,order_number,customer_data,shipping_address,total_amount,status,created_at,updated_at FROM orders WHERE id=$1 AND shop_id=$2`, c.Param("id"), client.ShopID).Scan(&id, &number, &customer, &address, &total, &status, &created, &updated)
	if err != nil {
		s.shopeeError(c, 404, "error_not_found", "order not found")
		return
	}
	var customerData, recipientAddress any
	_ = json.Unmarshal(customer, &customerData)
	_ = json.Unmarshal(address, &recipientAddress)
	s.shopeeSuccess(c, gin.H{"order_id": id, "order_sn": number, "order_status": status, "total_amount": total, "buyer": customerData, "recipient_address": recipientAddress, "create_time": created.Unix(), "update_time": updated.Unix(), "item_list": s.items(c, id), "package_list": s.packagesForOrder(c, id), "shipment_list": shipmentList(s.shipmentForOrder(c, id))})
}

func (s *Server) shopeeProcessOrder(c *gin.Context)     { s.shopeeTransition(c, orders.Processing) }
func (s *Server) shopeeReadyToShipOrder(c *gin.Context) { s.shopeeTransition(c, orders.ReadyToShip) }

func (s *Server) shopeeTransition(c *gin.Context, target string) {
	client := currentClient(c)
	if err := s.transition(c, client.ShopID, c.Param("id"), target, ""); err != nil {
		s.shopeeError(c, 400, shopeeErrorCode("INVALID_TRANSITION"), err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": target})
}

func (s *Server) shopeeCancelOrder(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		CancelReason string `json:"cancel_reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		s.shopeeError(c, 400, "error_param", "invalid cancellation request")
		return
	}
	reason := strings.ToUpper(strings.TrimSpace(input.CancelReason))
	if !orders.ValidCancellationReason(orders.Customer, reason) {
		s.shopeeError(c, 400, "error_param", "invalid customer cancellation reason")
		return
	}
	if err := s.cancelOrderForActor(c, client.ShopID, c.Param("id"), orders.Customer, reason); err != nil {
		if errors.Is(err, orders.ErrOrderNotFound) {
			s.shopeeError(c, 404, "error_not_found", "order not found")
			return
		}
		s.shopeeError(c, 400, "error_invalid_state", err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": orders.Cancelled, "cancel_reason": reason})
}

func (s *Server) tokopediaCancelOrder(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		s.tokopediaError(c, 400, "invalid cancellation request")
		return
	}
	reason := strings.ToUpper(strings.TrimSpace(input.Reason))
	if !orders.ValidCancellationReason(orders.Customer, reason) {
		s.tokopediaError(c, 400, "invalid customer cancellation reason")
		return
	}
	if err := s.cancelOrderForActor(c, client.ShopID, c.Param("id"), orders.Customer, reason); err != nil {
		s.tokopediaError(c, 36000003, err.Error())
		return
	}
	s.tokopediaSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": tokopedia.OrderStatus(orders.Cancelled), "cancel_reason": reason})
}

func (s *Server) shopeeSuccess(c *gin.Context, response gin.H) {
	c.JSON(http.StatusOK, gin.H{"error": "", "message": "success", "request_id": "req_" + platform.NewID(""), "response": response})
}

func (s *Server) cancelResponse(c *gin.Context, shop, orderID, actor, reason string) {
	if !orders.ValidCancellationReason(actor, reason) {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid cancellation reason for actor"))
		return
	}
	if err := s.cancelOrderForActor(c, shop, orderID, actor, reason); err != nil {
		if errors.Is(err, orders.ErrOrderNotFound) {
			c.JSON(404, errorBody("NOT_FOUND", "order not found"))
			return
		}
		c.JSON(400, errorBody("INVALID_TRANSITION", err.Error()))
		return
	}
	c.JSON(200, gin.H{"id": orderID, "status": orders.Cancelled, "cancellation_actor": actor, "cancellation_reason": reason})
}

// cancelOrderForActor performs the canonical state, inventory, and event update
// behind the provider-specific HTTP contracts and control-plane simulation.
func (s *Server) cancelOrderForActor(ctx context.Context, shop, orderID, actor, reason string) error {
	return s.orders.Cancel(ctx, shop, orderID, actor, reason)
}

type shipmentInput struct {
	ShippingProvider string `json:"shipping_provider"`
	PickupType       string `json:"pickup_type"`
	PackageID        string `json:"package_id"`
}

type packageInput struct {
	OrderItemIDs []string `json:"order_item_ids"`
	Items        []struct {
		OrderItemID string `json:"order_item_id"`
		Quantity    int    `json:"quantity"`
	} `json:"items"`
}

// createPackageForOrder is canonical package allocation used by provider
// adapters. It intentionally has no Generic HTTP surface.
func (s *Server) createPackageForOrder(c *gin.Context, shop, orderID string, input packageInput) (gin.H, error) {
	if len(input.OrderItemIDs) == 0 && len(input.Items) == 0 {
		return nil, fmt.Errorf("items or order_item_ids is required")
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		return nil, fmt.Errorf("start package: %w", err)
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, warehouseID string
	if err = tx.QueryRow(c, `SELECT status,COALESCE(fulfillment_warehouse_id,'') FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &warehouseID); err != nil {
		return nil, fmt.Errorf("order not found: %w", err)
	}
	if status != orders.ReadyToShip {
		return nil, fmt.Errorf("packages can only be allocated for %s orders", orders.ReadyToShip)
	}
	if warehouseID == "" {
		return nil, fmt.Errorf("order does not have a fulfillment warehouse")
	}
	packageID := platform.NewID("pkg")
	if _, err = tx.Exec(c, `INSERT INTO packages(id,order_id,warehouse_id) VALUES($1,$2,$3)`, packageID, orderID, warehouseID); err != nil {
		return nil, fmt.Errorf("create package: %w", err)
	}
	allocations := input.Items
	for _, itemID := range input.OrderItemIDs {
		allocations = append(allocations, struct {
			OrderItemID string `json:"order_item_id"`
			Quantity    int    `json:"quantity"`
		}{OrderItemID: itemID, Quantity: 0})
	}
	for _, allocation := range allocations {
		var quantity int
		if err = tx.QueryRow(c, `SELECT oi.quantity-COALESCE((SELECT sum(quantity) FROM package_items WHERE order_item_id=oi.id),0) FROM order_items oi WHERE oi.id=$1 AND oi.order_id=$2`, allocation.OrderItemID, orderID).Scan(&quantity); err != nil || quantity <= 0 {
			return nil, fmt.Errorf("items must belong to this order and have remaining quantity")
		}
		if allocation.Quantity > 0 {
			quantity = allocation.Quantity
		}
		if quantity <= 0 {
			return nil, fmt.Errorf("package quantity must be positive")
		}
		var available int
		if err = tx.QueryRow(c, `SELECT oi.quantity-COALESCE((SELECT sum(quantity) FROM package_items WHERE order_item_id=oi.id),0) FROM order_items oi WHERE oi.id=$1`, allocation.OrderItemID).Scan(&available); err != nil || quantity > available {
			return nil, fmt.Errorf("package quantity exceeds remaining item quantity")
		}
		if _, err = tx.Exec(c, `INSERT INTO package_items(package_id,order_item_id,quantity) VALUES($1,$2,$3)`, packageID, allocation.OrderItemID, quantity); err != nil {
			return nil, fmt.Errorf("allocate package item: %w", err)
		}
	}
	if err = tx.Commit(c); err != nil {
		return nil, fmt.Errorf("commit package: %w", err)
	}
	return gin.H{"id": packageID, "order_id": orderID, "warehouse_id": warehouseID, "status": "READY_TO_SHIP", "item_count": len(allocations)}, nil
}

func (s *Server) shopeeCreatePackage(c *gin.Context) {
	client := currentClient(c)
	var input packageInput
	if err := c.ShouldBindJSON(&input); err != nil {
		s.shopeeError(c, 400, "error_param", "invalid package request")
		return
	}
	packageData, err := s.createPackageForOrder(c, client.ShopID, c.Param("id"), input)
	if err != nil {
		s.shopeeError(c, 400, shopeeErrorCode("INVALID_TRANSITION"), err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"package": packageData})
}

func (s *Server) shopeeCreateShipment(c *gin.Context) {
	client := currentClient(c)
	shipment, err := s.createShipmentForOrder(c, client.ShopID, c.Param("id"))
	if err != nil {
		s.shopeeError(c, 400, shopeeErrorCode("INVALID_TRANSITION"), err.Error())
		return
	}
	s.shopeeSuccess(c, gin.H{"shipment": shipment})
}

func (s *Server) tokopediaCreateShipment(c *gin.Context) {
	client := currentClient(c)
	shipment, err := s.createShipmentForOrder(c, client.ShopID, c.Param("id"))
	if err != nil {
		s.tokopediaError(c, 36000003, err.Error())
		return
	}
	s.tokopediaSuccess(c, gin.H{"shipment": shipment})
}

func (s *Server) createShipmentForOrder(c *gin.Context, shop, orderID string) (gin.H, error) {
	var input shipmentInput
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.ShippingProvider) == "" || strings.TrimSpace(input.PickupType) == "" {
		return nil, fmt.Errorf("shipping_provider and pickup_type are required")
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		return nil, fmt.Errorf("start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, warehouseID string
	if err = tx.QueryRow(c, `SELECT status,COALESCE(fulfillment_warehouse_id,'') FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &warehouseID); err != nil {
		return nil, err
	}
	if status != orders.ReadyToShip {
		return nil, fmt.Errorf("shipment can only be created for %s orders", orders.ReadyToShip)
	}
	if warehouseID == "" {
		return nil, fmt.Errorf("order does not have a fulfillment warehouse")
	}
	id := platform.NewID("shp")
	packageID := strings.TrimSpace(input.PackageID)
	tracking := "GX" + strings.ToUpper(platform.NewID(""))[1:]
	if packageID == "" {
		packageID = platform.NewID("pkg")
		if _, err = tx.Exec(c, `INSERT INTO packages(id,order_id,warehouse_id,status) VALUES($1,$2,$3,'READY_TO_SHIP')`, packageID, orderID, warehouseID); err != nil {
			return nil, fmt.Errorf("create package: %w", err)
		}
		if _, err = tx.Exec(c, `INSERT INTO package_items(package_id,order_item_id,quantity) SELECT $1,id,quantity FROM order_items WHERE order_id=$2 AND NOT EXISTS(SELECT 1 FROM package_items WHERE order_item_id=order_items.id)`, packageID, orderID); err != nil {
			return nil, fmt.Errorf("assign package items: %w", err)
		}
	} else {
		var exists bool
		if err = tx.QueryRow(c, `SELECT EXISTS(SELECT 1 FROM packages WHERE id=$1 AND order_id=$2 AND warehouse_id=$3)`, packageID, orderID, warehouseID).Scan(&exists); err != nil || !exists {
			return nil, fmt.Errorf("package does not belong to order")
		}
	}
	if _, err = tx.Exec(c, `INSERT INTO shipments(id,order_id,package_id,tracking_number,shipping_provider,pickup_type,status) VALUES($1,$2,$3,$4,$5,$6,'CREATED')`, id, orderID, packageID, tracking, input.ShippingProvider, input.PickupType); err != nil {
		return nil, fmt.Errorf("create shipment: %w", err)
	}
	if err = tx.Commit(c); err != nil {
		return nil, fmt.Errorf("commit shipment: %w", err)
	}
	return gin.H{"id": id, "package_id": packageID, "warehouse_id": warehouseID, "order_id": orderID, "tracking_number": tracking, "shipping_provider": input.ShippingProvider, "pickup_type": input.PickupType, "status": "CREATED"}, nil
}

func (s *Server) createWebhook(c *gin.Context) {
	client := currentClient(c)
	var in struct {
		URL              string   `json:"url"`
		Secret           string   `json:"secret"`
		SubscribedEvents []string `json:"subscribed_events"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.URL == "" || len(in.SubscribedEvents) == 0 {
		c.JSON(400, errorBody("INVALID_REQUEST", "url and subscribed_events are required"))
		return
	}
	u, err := url.ParseRequestURI(in.URL)
	if err != nil || u.Scheme != "http" && u.Scheme != "https" {
		c.JSON(400, errorBody("INVALID_REQUEST", "webhook URL must be http or https"))
		return
	}
	for _, eventType := range in.SubscribedEvents {
		if !webhooks.SupportsEvent(eventType) {
			c.JSON(400, errorBody("INVALID_REQUEST", "unsupported webhook event "+eventType))
			return
		}
	}
	generated := in.Secret == ""
	if generated {
		in.Secret = platform.NewID("whsec")
	}
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, in.Secret)
	if err != nil {
		c.JSON(500, errorBody("CRYPTO_ERROR", "could not protect webhook secret"))
		return
	}
	events, _ := json.Marshal(in.SubscribedEvents)
	id := platform.NewID("wh")
	_, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, client.ShopID, in.URL, cipher, events)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not create webhook"))
		return
	}
	out := gin.H{"id": id, "shop_id": client.ShopID, "url": in.URL, "enabled": true, "subscribed_events": in.SubscribedEvents}
	if generated {
		out["secret"] = in.Secret
	}
	c.JSON(201, out)
}

// shopeeCreateWebhook exposes provider event names and callback_url. Stored
// subscriptions stay canonical, preserving one durable outbox for all shops.
func (s *Server) shopeeCreateWebhook(c *gin.Context) {
	client := currentClient(c)
	var in struct {
		CallbackURL string   `json:"callback_url"`
		Secret      string   `json:"secret"`
		EventTypes  []string `json:"event_types"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CallbackURL == "" || len(in.EventTypes) == 0 {
		s.shopeeError(c, 400, "error_param", "callback_url and event_types are required")
		return
	}
	u, err := url.ParseRequestURI(in.CallbackURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		s.shopeeError(c, 400, "error_param", "callback_url must be http or https")
		return
	}
	canonical := []string{}
	seen := map[string]bool{}
	for _, event := range in.EventTypes {
		for _, domainEvent := range shopeeSubscriptionEvents(event) {
			if !seen[domainEvent] {
				canonical, seen[domainEvent] = append(canonical, domainEvent), true
			}
		}
		if len(shopeeSubscriptionEvents(event)) == 0 {
			s.shopeeError(c, 400, "error_param", "unsupported event_type "+event)
			return
		}
	}
	generated := in.Secret == ""
	if generated {
		in.Secret = platform.NewID("whsec")
	}
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, in.Secret)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "could not protect webhook secret")
		return
	}
	raw, _ := json.Marshal(canonical)
	id := platform.NewID("wh")
	if _, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, client.ShopID, in.CallbackURL, cipher, raw); err != nil {
		s.shopeeError(c, 500, "error_system", "could not create webhook")
		return
	}
	result := gin.H{"webhook_id": id, "callback_url": in.CallbackURL, "event_types": in.EventTypes, "enabled": true}
	if generated {
		result["secret"] = in.Secret
	}
	s.shopeeSuccess(c, result)
}

func shopeeSubscriptionEvents(event string) []string {
	switch event {
	case "item_update":
		return []string{"product.created", "product.updated", "product.deleted"}
	case "order_status_update":
		return []string{"order.created", "order.paid", "order.payment_failed", "order.payment_expired", "order.processing", "order.ready_to_ship", "order.completed", "order.cancelled", "order.sla_expired"}
	case "logistics_status_update":
		return []string{"order.shipped", "order.in_delivery", "order.delivered"}
	default:
		return nil
	}
}

func (s *Server) shopeeListWebhooks(c *gin.Context) {
	client := currentClient(c)
	rows, err := s.db.Query(c, `SELECT id,url,enabled,subscribed_events FROM webhooks WHERE shop_id=$1 ORDER BY created_at DESC`, client.ShopID)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "could not list webhooks")
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, callback string
		var enabled bool
		var raw []byte
		if err := rows.Scan(&id, &callback, &enabled, &raw); err != nil {
			s.shopeeError(c, 500, "error_system", "could not read webhooks")
			return
		}
		var canonical []string
		_ = json.Unmarshal(raw, &canonical)
		types := map[string]bool{}
		for _, event := range canonical {
			types[webhooks.ShopeeEvent(event)] = true
		}
		events := []string{}
		for _, event := range []string{"item_update", "order_status_update", "logistics_status_update"} {
			if types[event] {
				events = append(events, event)
			}
		}
		data = append(data, gin.H{"webhook_id": id, "callback_url": callback, "event_types": events, "enabled": enabled})
	}
	s.shopeeSuccess(c, gin.H{"webhook_list": data})
}

func (s *Server) listWebhooks(c *gin.Context) { s.webhookListResponse(c, currentClient(c).ShopID) }
func (s *Server) webhookListResponse(c *gin.Context, shop string) {
	rows, err := s.db.Query(c, `SELECT id,url,enabled,subscribed_events,created_at FROM webhooks WHERE shop_id=$1 ORDER BY created_at DESC`, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list webhooks"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, url string
		var enabled bool
		var events []byte
		var created time.Time
		if err := rows.Scan(&id, &url, &enabled, &events, &created); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read webhook"))
			return
		}
		data = append(data, gin.H{"id": id, "shop_id": shop, "url": url, "enabled": enabled, "subscribed_events": json.RawMessage(events), "created_at": created})
	}
	s.controlListResponse(c, data)
}

// controlListResponse gives every control-plane collection the same page/limit
// contract. This keeps the dashboard responsive while preserving existing list
// consumers that only read the data field.
func (s *Server) controlListResponse(c *gin.Context, data []gin.H) {
	limit := 20
	if parsed, err := strconv.Atoi(c.DefaultQuery("limit", "20")); err == nil && parsed > 0 && parsed <= 100 {
		limit = parsed
	}
	pageNumber := 1
	if parsed, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && parsed > 0 {
		pageNumber = parsed
	}
	total := len(data)
	totalPages := max(1, (total+limit-1)/limit)
	if pageNumber > totalPages {
		pageNumber = totalPages
	}
	start := (pageNumber - 1) * limit
	end := min(start+limit, total)
	if start > total {
		start = total
	}
	c.JSON(http.StatusOK, gin.H{
		"data":       data[start:end],
		"pagination": gin.H{"page": pageNumber, "limit": limit, "total": total, "total_pages": totalPages, "has_previous": pageNumber > 1, "has_next": pageNumber < totalPages},
	})
}
func (s *Server) deleteWebhook(c *gin.Context) {
	client := currentClient(c)
	cmd, err := s.db.Exec(c, `DELETE FROM webhooks WHERE id=$1 AND shop_id=$2`, c.Param("id"), client.ShopID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not delete webhook"))
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(404, errorBody("NOT_FOUND", "webhook not found"))
		return
	}
	c.Status(204)
}

func (s *Server) idempotent(operation string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.GetHeader("Idempotency-Key")
		if key == "" {
			c.JSON(400, errorBody("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required"))
			c.Abort()
			return
		}
		client := currentClient(c)
		var status int
		var body []byte
		err := s.db.QueryRow(c, `SELECT response_status,response_body FROM idempotency_keys WHERE credential_id=$1 AND operation=$2 AND key=$3`, client.CredentialID, operation, key).Scan(&status, &body)
		if err == nil {
			c.Header("Idempotent-Replayed", "true")
			c.Data(status, "application/json", body)
			c.Abort()
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not check idempotency"))
			c.Abort()
			return
		}
		recorder := &responseRecorder{ResponseWriter: c.Writer}
		c.Writer = recorder
		c.Next()
		if c.Writer.Status() >= 200 && c.Writer.Status() < 300 {
			body := recorder.body.Bytes()
			if len(body) == 0 {
				body = []byte(`{}`)
			}
			s.persistIdempotency(c, client, operation, key, c.Writer.Status(), json.RawMessage(body))
		}
	}
}

// persistIdempotency is used after successful mutations; its response is intentionally small and stable.
func (s *Server) persistIdempotency(ctx context.Context, client integrationClient, operation, key string, status int, body any) {
	raw, err := json.Marshal(body)
	if err != nil {
		return
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO idempotency_keys(id,credential_id,operation,key,response_status,response_body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(credential_id,operation,key) DO NOTHING`, platform.NewID("idem"), client.CredentialID, operation, key, status, raw)
}

func (s *Server) loadScenario(ctx context.Context, shop string) (scenarios.Config, error) {
	var v scenarios.Config
	err := s.db.QueryRow(ctx, `SELECT api_slow_ms,api_slow_probability,api_random_500_probability,api_timeout_probability,force_rate_limit,webhook_duplicate,webhook_delay_seconds,webhook_out_of_order,webhook_force_failure FROM shop_scenarios WHERE shop_id=$1`, shop).Scan(&v.APISlowMS, &v.APISlowProbability, &v.APIRandom500Probability, &v.APITimeoutProbability, &v.ForceRateLimit, &v.WebhookDuplicate, &v.WebhookDelaySeconds, &v.WebhookOutOfOrder, &v.WebhookForceFailure)
	if errors.Is(err, pgx.ErrNoRows) {
		return scenarios.Config{}, nil
	}
	return v, err
}
func (s *Server) applyScenario(c *gin.Context) {
	v, _ := c.MustGet("scenario").(scenarios.Config)
	if v.APIRandom500Probability > 0 && rand.IntN(100) < v.APIRandom500Probability {
		s.providerError(c, 500, "SIMULATED_FAILURE", "scenario generated HTTP 500")
		c.Abort()
		return
	}
	if v.APITimeoutProbability > 0 && rand.IntN(100) < v.APITimeoutProbability {
		select {
		case <-time.After(35 * time.Second):
		case <-c.Request.Context().Done():
		}
		c.Abort()
		return
	}
	if v.APISlowMS > 0 && rand.IntN(100) < v.APISlowProbability {
		select {
		case <-time.After(time.Duration(v.APISlowMS) * time.Millisecond):
		case <-c.Request.Context().Done():
			c.Abort()
			return
		}
	}
	c.Next()
}

// shopeeIntegrationAuth is deliberately not an alias of integrationAuth.
// Its canonical string and headers model a partner-style provider contract:
// partner_id + path + timestamp + raw_body (the HTTP method is excluded).
func (s *Server) shopeeIntegrationAuth(c *gin.Context) {
	c.Set("provider_contract", orders.ShopeeLike)
	if s.isMaintenance(c) {
		s.shopeeError(c, http.StatusServiceUnavailable, "error_system_busy", "marketplace is under maintenance")
		c.Abort()
		return
	}
	partnerID, stamp, signature := c.GetHeader("X-Shopee-Partner-Id"), c.GetHeader("X-Shopee-Timestamp"), c.GetHeader("X-Shopee-Signature")
	if partnerID == "" || stamp == "" || signature == "" {
		s.shopeeError(c, http.StatusUnauthorized, "error_auth", "Shopee-like signed headers are required")
		c.Abort()
		return
	}
	unix, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || time.Since(time.Unix(unix, 0)).Abs() > timestampWindow {
		s.shopeeError(c, http.StatusUnauthorized, "error_request_expired", "timestamp is outside the allowed window")
		c.Abort()
		return
	}
	credential, err := s.store.GetCredentialByClientID(c, partnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		s.shopeeError(c, http.StatusUnauthorized, "error_auth", "unknown partner")
		c.Abort()
		return
	}
	if err != nil {
		s.shopeeError(c, 500, "error_system", "credential lookup failed")
		c.Abort()
		return
	}
	var profile string
	if err := s.db.QueryRow(c, `SELECT provider_profile FROM shops WHERE id=$1`, credential.ShopID).Scan(&profile); err != nil || orders.NormaliseProvider(profile) != orders.ShopeeLike {
		s.shopeeError(c, http.StatusForbidden, "error_provider_profile", "credential does not belong to a SHOPEE_LIKE shop")
		c.Abort()
		return
	}
	if credential.Status == "REVOKED" {
		s.shopeeError(c, http.StatusForbidden, "error_auth", "credential was revoked")
		c.Abort()
		return
	}
	client := integrationClient{CredentialID: credential.ID, ShopID: credential.ShopID, ClientID: credential.ClientID}
	scenario, err := s.loadScenario(c, client.ShopID)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "could not load scenario")
		c.Abort()
		return
	}
	limit := s.cfg.RateLimitPerMinute
	resetAt := time.Now().Truncate(time.Minute).Add(time.Minute)
	if scenario.ForceRateLimit {
		s.setShopeeRateLimitHeaders(c, limit, 0, resetAt)
		s.shopeeError(c, http.StatusTooManyRequests, "error_too_many_requests", "rate limit exceeded")
		c.Abort()
		return
	}
	allowed, remaining := s.allowRate(c, "shopee:"+client.CredentialID, limit)
	s.setShopeeRateLimitHeaders(c, limit, remaining, resetAt)
	if !allowed {
		s.shopeeError(c, http.StatusTooManyRequests, "error_too_many_requests", "rate limit exceeded")
		c.Abort()
		return
	}
	secret, err := platform.Decrypt(s.cfg.EncryptionKey, credential.SecretCiphertext)
	if err != nil {
		s.shopeeError(c, 500, "error_system", "credential unavailable")
		c.Abort()
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		s.shopeeError(c, 400, "error_param", "could not read body")
		c.Abort()
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(partnerID + c.Request.URL.Path + stamp + string(body)))
	expected := mac.Sum(nil)
	provided, err := hex.DecodeString(signature)
	if err != nil || subtle.ConstantTimeCompare(expected, provided) != 1 {
		s.shopeeError(c, http.StatusUnauthorized, "error_auth", "signature did not match")
		c.Abort()
		return
	}
	c.Set("client", client)
	c.Set("scenario", scenario)
	c.Next()
}

func (s *Server) providerError(c *gin.Context, status int, code, message string) {
	if profile, _ := c.Get("provider_contract"); profile == orders.ShopeeLike {
		s.shopeeError(c, status, shopeeErrorCode(code), message)
		return
	}
	if profile, _ := c.Get("provider_contract"); profile == orders.TokopediaLike {
		s.tokopediaError(c, tokopediaErrorCode(status, code), message)
		return
	}
	c.JSON(status, errorBody(code, message))
}

func tokopediaErrorCode(status int, code string) int {
	if status == http.StatusTooManyRequests {
		return 429
	}
	if status == http.StatusUnauthorized {
		return 36000001
	}
	if code == "INVALID_TRANSITION" {
		return 36000003
	}
	return 400
}

func shopeeErrorCode(code string) string {
	switch code {
	case "INVALID_TRANSITION":
		return "error_invalid_state"
	case "NOT_FOUND":
		return "error_not_found"
	case "INVALID_REQUEST", "INVALID_DATE", "INVALID_SORT", "INVALID_CURSOR":
		return "error_param"
	default:
		return "error_system"
	}
}

func (s *Server) shopeeError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": code, "message": message, "request_id": "req_" + platform.NewID("")})
}

func (s *Server) setShopeeRateLimitHeaders(c *gin.Context, limit, remaining int, resetAt time.Time) {
	c.Header("X-Shopee-Api-Call-Limit", fmt.Sprintf("%d/%d", limit-max(remaining, 0), limit))
	c.Header("X-Shopee-RateLimit-Reset", strconv.FormatInt(resetAt.Unix(), 10))
}

func (s *Server) tokopediaIntegrationAuth(c *gin.Context) {
	c.Set("provider_contract", orders.TokopediaLike)
	if s.isMaintenance(c) {
		s.tokopediaError(c, 500, "system busy")
		c.Abort()
		return
	}
	query := c.Request.URL.Query()
	appKey, stamp, sign := query.Get("app_key"), query.Get("timestamp"), query.Get("sign")
	if appKey == "" || stamp == "" || sign == "" {
		s.tokopediaError(c, 36000001, "missing app_key, timestamp, or sign")
		c.Abort()
		return
	}
	unix, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || time.Since(time.Unix(unix, 0)).Abs() > timestampWindow {
		s.tokopediaError(c, 36000002, "timestamp expired")
		c.Abort()
		return
	}
	var credentialID, shopID, clientID, secretCipher, tokenCipher, credentialStatus, profile string
	err = s.db.QueryRow(c, `SELECT c.id,c.shop_id,c.client_id,c.secret_ciphertext,COALESCE(c.access_token_ciphertext,''),c.status,s.provider_profile FROM credentials c JOIN shops s ON s.id=c.shop_id WHERE c.client_id=$1`, appKey).Scan(&credentialID, &shopID, &clientID, &secretCipher, &tokenCipher, &credentialStatus, &profile)
	if err != nil || orders.NormaliseProvider(profile) != orders.TokopediaLike || credentialStatus != "ACTIVE" {
		s.tokopediaError(c, 36000001, "invalid app credential")
		c.Abort()
		return
	}
	if tokenCipher == "" {
		s.tokopediaError(c, 36000001, "create a new credential to obtain an access token")
		c.Abort()
		return
	}
	accessToken, err := platform.Decrypt(s.cfg.EncryptionKey, tokenCipher)
	if err != nil || subtle.ConstantTimeCompare([]byte(accessToken), []byte(c.GetHeader("x-tts-access-token"))) != 1 {
		s.tokopediaError(c, 36000001, "invalid access token")
		c.Abort()
		return
	}
	scenario, err := s.loadScenario(c, shopID)
	if err != nil {
		s.tokopediaError(c, 500, "could not load scenario")
		c.Abort()
		return
	}
	limit, resetAt := s.cfg.RateLimitPerMinute, time.Now().Truncate(time.Minute).Add(time.Minute)
	if scenario.ForceRateLimit {
		s.setTokopediaRateLimitHeaders(c, limit, 0, resetAt)
		s.tokopediaError(c, 429, "rate limit exceeded")
		c.Abort()
		return
	}
	allowed, remaining := s.allowRate(c, "tokopedia:"+credentialID, limit)
	s.setTokopediaRateLimitHeaders(c, limit, remaining, resetAt)
	if !allowed {
		s.tokopediaError(c, 429, "rate limit exceeded")
		c.Abort()
		return
	}
	secret, err := platform.Decrypt(s.cfg.EncryptionKey, secretCipher)
	if err != nil {
		s.tokopediaError(c, 500, "credential unavailable")
		c.Abort()
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		s.tokopediaError(c, 400, "could not read request body")
		c.Abort()
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	provided, err := hex.DecodeString(sign)
	expected, _ := hex.DecodeString(tokopedia.Sign(secret, c.Request.URL.Path, query, body))
	if err != nil || subtle.ConstantTimeCompare(expected, provided) != 1 {
		s.tokopediaError(c, 36000001, "invalid signature")
		c.Abort()
		return
	}
	c.Set("client", integrationClient{CredentialID: credentialID, ShopID: shopID, ClientID: clientID})
	c.Set("scenario", scenario)
	c.Next()
}

func (s *Server) tokopediaError(c *gin.Context, code int, message string) {
	c.JSON(http.StatusBadRequest, gin.H{"code": code, "message": message, "request_id": "req_" + platform.NewID(""), "data": gin.H{}})
}

func (s *Server) tokopediaSuccess(c *gin.Context, data gin.H) {
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "request_id": "req_" + platform.NewID(""), "data": data})
}

func (s *Server) setTokopediaRateLimitHeaders(c *gin.Context, limit, remaining int, resetAt time.Time) {
	c.Header("X-TTS-RateLimit-Limit", strconv.Itoa(limit))
	c.Header("X-TTS-RateLimit-Remaining", strconv.Itoa(max(remaining, 0)))
	c.Header("X-TTS-RateLimit-Reset", strconv.FormatInt(resetAt.Unix(), 10))
}

func (s *Server) tokopediaListOrders(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		PageSize    int    `json:"page_size"`
		PageToken   string `json:"page_token"`
		OrderStatus string `json:"order_status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		s.tokopediaError(c, 400, "invalid request body")
		return
	}
	if input.PageSize == 0 {
		input.PageSize = 20
	}
	if input.PageSize < 1 || input.PageSize > 100 {
		s.tokopediaError(c, 400, "page_size must be between 1 and 100")
		return
	}
	offset := 0
	if input.PageToken != "" {
		raw, err := base64.RawURLEncoding.DecodeString(input.PageToken)
		if err != nil {
			s.tokopediaError(c, 400, "invalid page_token")
			return
		}
		offset, err = strconv.Atoi(string(raw))
		if err != nil || offset < 0 {
			s.tokopediaError(c, 400, "invalid page_token")
			return
		}
	}
	rows, err := s.db.Query(c, `SELECT id,order_number,status,total_amount,created_at,updated_at FROM orders WHERE shop_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, client.ShopID, input.PageSize+1, offset)
	if err != nil {
		s.tokopediaError(c, 500, "could not list orders")
		return
	}
	defer rows.Close()
	ordersData := []gin.H{}
	for rows.Next() {
		var id, number, status string
		var total int64
		var created, updated time.Time
		if err := rows.Scan(&id, &number, &status, &total, &created, &updated); err != nil {
			s.tokopediaError(c, 500, "could not read order")
			return
		}
		if input.OrderStatus != "" && tokopedia.OrderStatus(status) != input.OrderStatus {
			continue
		}
		ordersData = append(ordersData, gin.H{"order_id": id, "order_number": number, "order_status": tokopedia.OrderStatus(status), "payment_status": paymentStatusForTokopedia(status), "total_amount": total, "create_time": created.Unix(), "update_time": updated.Unix()})
	}
	more := len(ordersData) > input.PageSize
	if more {
		ordersData = ordersData[:input.PageSize]
	}
	next := ""
	if more {
		next = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + input.PageSize)))
	}
	s.tokopediaSuccess(c, gin.H{"orders": ordersData, "next_page_token": next, "has_more": more})
}

func paymentStatusForTokopedia(status string) string {
	if status == orders.Unpaid {
		return "UNPAID"
	}
	if status == orders.Cancelled {
		return "CANCELLED"
	}
	return "PAID"
}

func (s *Server) tokopediaGetOrder(c *gin.Context) {
	client := currentClient(c)
	var id, number, status string
	var total int64
	var created, updated time.Time
	err := s.db.QueryRow(c, `SELECT id,order_number,status,total_amount,created_at,updated_at FROM orders WHERE id=$1 AND shop_id=$2`, c.Param("id"), client.ShopID).Scan(&id, &number, &status, &total, &created, &updated)
	if err != nil {
		s.tokopediaError(c, 400, "order not found")
		return
	}
	s.tokopediaSuccess(c, gin.H{"order_id": id, "order_number": number, "order_status": tokopedia.OrderStatus(status), "payment_status": paymentStatusForTokopedia(status), "total_amount": total, "create_time": created.Unix(), "update_time": updated.Unix(), "line_items": s.items(c, id), "package": s.shipmentForOrder(c, id)})
}

func (s *Server) tokopediaPackOrder(c *gin.Context)     { s.tokopediaTransition(c, orders.Processing) }
func (s *Server) tokopediaHandoverOrder(c *gin.Context) { s.tokopediaTransition(c, orders.ReadyToShip) }

func (s *Server) tokopediaTransition(c *gin.Context, target string) {
	client := currentClient(c)
	if err := s.transition(c, client.ShopID, c.Param("id"), target, ""); err != nil {
		s.tokopediaError(c, 400, err.Error())
		return
	}
	s.tokopediaSuccess(c, gin.H{"order_id": c.Param("id"), "order_status": tokopedia.OrderStatus(target)})
}

func (s *Server) tokopediaConfigureWebhooks(c *gin.Context) {
	client := currentClient(c)
	var input struct {
		CallbackURL string   `json:"callback_url"`
		EventTypes  []string `json:"event_types"`
		Secret      string   `json:"secret"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.CallbackURL == "" || len(input.EventTypes) == 0 {
		s.tokopediaError(c, 400, "callback_url and event_types are required")
		return
	}
	u, err := url.ParseRequestURI(input.CallbackURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		s.tokopediaError(c, 400, "callback_url must be http or https")
		return
	}
	canonical := []string{}
	for _, topic := range input.EventTypes {
		switch topic {
		case "ORDER_STATUS_CHANGE":
			canonical = append(canonical, "order.created", "order.paid", "order.processing", "order.ready_to_ship", "order.completed", "order.cancelled")
		case "PACKAGE_UPDATE":
			canonical = append(canonical, "order.shipped", "order.in_delivery", "order.delivered", "shipment.delivery_failed", "shipment.returning", "shipment.returned")
		case "PRODUCT_INFORMATION_CHANGE":
			canonical = append(canonical, "product.created", "product.updated", "product.deleted")
		default:
			s.tokopediaError(c, 400, "unsupported event_type "+topic)
			return
		}
	}
	if input.Secret == "" {
		input.Secret = platform.NewID("whsec")
	}
	cipher, err := platform.Encrypt(s.cfg.EncryptionKey, input.Secret)
	if err != nil {
		s.tokopediaError(c, 500, "could not protect webhook secret")
		return
	}
	raw, _ := json.Marshal(canonical)
	id := platform.NewID("wh")
	if _, err = s.db.Exec(c, `INSERT INTO webhooks(id,shop_id,url,secret_ciphertext,subscribed_events) VALUES($1,$2,$3,$4,$5)`, id, client.ShopID, input.CallbackURL, cipher, raw); err != nil {
		s.tokopediaError(c, 500, "could not create webhook")
		return
	}
	s.tokopediaSuccess(c, gin.H{"webhook_id": id, "event_types": input.EventTypes, "secret": input.Secret})
}
func (s *Server) setRateLimitHeaders(c *gin.Context, limit, remaining int, resetAt time.Time) {
	c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
	c.Header("X-RateLimit-Remaining", strconv.Itoa(max(remaining, 0)))
	c.Header("X-RateLimit-Reset", strconv.FormatInt(resetAt.Unix(), 10))
}

func (s *Server) allowRate(ctx context.Context, credential string, limit int) (bool, int) {
	return ratelimit.NewFixedWindow(s.redis).Allow(ctx, credential, limit)
}

func (s *Server) transition(c *gin.Context, shop, orderID, target, cancellationReason string) error {
	return s.orders.Transition(c, shop, orderID, target, cancellationReason)
}

func (s *Server) transitionTx(ctx context.Context, tx pgx.Tx, shop, orderID, target, cancellationReason string) error {
	var status, provider, paymentStatus string
	var paymentExpiry *time.Time
	err := tx.QueryRow(ctx, `SELECT o.status,s.provider_profile,o.payment_status,o.payment_expires_at FROM orders o JOIN shops s ON s.id=o.shop_id WHERE o.id=$1 AND o.shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &provider, &paymentStatus, &paymentExpiry)
	if err != nil {
		return err
	}
	if !orders.CanTransition(status, target) {
		return fmt.Errorf("cannot transition from %s to %s", status, target)
	}
	if target == orders.Paid && (paymentStatus != "PENDING" || paymentExpiry != nil && time.Now().After(*paymentExpiry)) {
		return fmt.Errorf("payment is no longer pending")
	}
	paymentReference := ""
	if target == orders.Paid {
		paymentReference = "SIM-PAY-" + strings.ToUpper(platform.NewID(""))[1:]
	}
	if _, err = tx.Exec(ctx, `UPDATE orders SET status=$1,payment_reference=CASE WHEN $1='PAID' THEN $2 ELSE payment_reference END,paid_at=CASE WHEN $1='PAID' THEN now() ELSE paid_at END,payment_status=CASE WHEN $1='PAID' THEN 'PAID' ELSE payment_status END,seller_deadline_at=CASE WHEN $1='PAID' AND $3='SHOPEE_LIKE' THEN now()+($4 * interval '1 second') ELSE seller_deadline_at END,updated_at=now() WHERE id=$5`, target, paymentReference, provider, int(s.sellerSLA().Seconds()), orderID); err != nil {
		return fmt.Errorf("update order: %w", err)
	}
	if target == orders.Paid {
		if err = inventory.Commit(ctx, tx, orderID); err != nil {
			return fmt.Errorf("commit inventory reservation: %w", err)
		}
	}
	payload := gin.H{"id": orderID, "status": target}
	if paymentReference != "" {
		payload["payment"] = gin.H{"status": "PAID", "reference": paymentReference}
	}
	if cancellationReason != "" {
		payload["cancellation_reason"] = cancellationReason
	}
	if err = events.Record(ctx, tx, shop, "order."+strings.ToLower(target), orderID, payload); err != nil {
		return err
	}
	return nil
}

func (s *Server) orderAction(c *gin.Context) {
	id := c.Param("id")
	var shop string
	err := s.db.QueryRow(c, `SELECT shop_id FROM orders WHERE id=$1`, id).Scan(&shop)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	if strings.EqualFold(c.Param("action"), "PAYMENT_FAILED") {
		s.failPayment(c, shop, id, "SIMULATED_PAYMENT_FAILURE")
		return
	}
	if strings.EqualFold(c.Param("action"), "CANCEL") {
		s.cancelResponse(c, shop, id, orders.Seller, "OUT_OF_STOCK")
		return
	}
	targets := map[string]string{"PAY": orders.Paid, "PROCESS": orders.Processing, "READY_TO_SHIP": orders.ReadyToShip, "COMPLETE": orders.Completed}
	target, ok := targets[strings.ToUpper(c.Param("action"))]
	if !ok {
		c.JSON(400, errorBody("INVALID_ACTION", "unsupported order action"))
		return
	}
	if err := s.transition(c, shop, id, target, ""); err != nil {
		c.JSON(400, errorBody("INVALID_TRANSITION", err.Error()))
		return
	}
	c.JSON(200, gin.H{"id": id, "status": "updated"})
}

func (s *Server) failPayment(c *gin.Context, shop, orderID, reason string) {
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not start payment failure"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	var status, paymentStatus string
	if err = tx.QueryRow(c, `SELECT status,payment_status FROM orders WHERE id=$1 AND shop_id=$2 FOR UPDATE`, orderID, shop).Scan(&status, &paymentStatus); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "order not found"))
		return
	}
	if status != orders.Unpaid || paymentStatus != "PENDING" {
		c.JSON(400, errorBody("INVALID_TRANSITION", "payment can only fail while the order is unpaid"))
		return
	}
	if _, err = tx.Exec(c, `UPDATE orders SET status='CANCELLED',payment_status='FAILED',payment_failed_at=now(),payment_failure_reason=$1,cancellation_actor='SYSTEM',cancellation_reason='PAYMENT_FAILED',updated_at=now() WHERE id=$2`, reason, orderID); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not record failed payment"))
		return
	}
	if err = inventory.Release(c, tx, orderID); err != nil {
		c.JSON(500, errorBody("INVENTORY_ERROR", "could not release reserved stock"))
		return
	}
	if err = events.Record(c, tx, shop, "order.payment_failed", orderID, gin.H{"id": orderID, "reason": reason}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not record payment failure"))
		return
	}
	if err = events.Record(c, tx, shop, "order.cancelled", orderID, gin.H{"id": orderID, "status": orders.Cancelled, "cancellation_actor": orders.System, "cancellation_reason": "PAYMENT_FAILED"}); err != nil {
		c.JSON(500, errorBody("EVENT_ERROR", "could not record cancellation"))
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit payment failure"))
		return
	}
	c.JSON(200, gin.H{"id": orderID, "status": orders.Cancelled, "payment_status": "FAILED"})
}

func (s *Server) paymentExpiry() time.Duration {
	if s.cfg.PaymentExpiry > 0 {
		return s.cfg.PaymentExpiry
	}
	return 30 * time.Minute
}
func (s *Server) sellerSLA() time.Duration {
	if s.cfg.SellerSLA > 0 {
		return s.cfg.SellerSLA
	}
	return 48 * time.Hour
}

func (s *Server) shipmentAction(c *gin.Context) {
	id := c.Param("id")
	var shop string
	if err := s.db.QueryRow(c, `SELECT o.shop_id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1`, id).Scan(&shop); err != nil {
		c.JSON(http.StatusNotFound, errorBody("NOT_FOUND", "shipment not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "invalid shipment action request"))
		return
	}
	targets := map[string]struct{ shipment, order string }{
		"SHIP": {"SHIPPED", orders.Shipped}, "IN_DELIVERY": {"IN_DELIVERY", orders.InDelivery}, "DELIVER": {"DELIVERED", orders.Delivered},
		"DELIVERY_FAILED": {"DELIVERY_FAILED", ""}, "RETURN_TO_SENDER": {"RETURNING", ""}, "COMPLETE_RETURN": {"RETURNED", orders.Returned},
	}
	target, ok := targets[strings.ToUpper(c.Param("action"))]
	if !ok {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_ACTION", "unsupported shipment action"))
		return
	}
	if target.shipment == "DELIVERY_FAILED" && strings.TrimSpace(input.Reason) == "" {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "delivery failure reason is required"))
		return
	}
	if err := s.transitionShipment(c, shop, id, target.shipment, target.order, strings.TrimSpace(input.Reason)); err != nil {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_TRANSITION", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "status": target.shipment})
}

func (s *Server) transitionShipment(c *gin.Context, shop, shipmentID, shipmentTarget, orderTarget, failureReason string) error {
	tx, err := s.db.Begin(c)
	if err != nil {
		return fmt.Errorf("start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(c) }()
	var orderID, packageID, shipmentStatus, orderStatus string
	if err = tx.QueryRow(c, `SELECT s.order_id,COALESCE(s.package_id,''),s.status,o.status FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1 AND o.shop_id=$2 FOR UPDATE`, shipmentID, shop).Scan(&orderID, &packageID, &shipmentStatus, &orderStatus); err != nil {
		return err
	}
	expected := map[string]string{"SHIPPED": "CREATED", "IN_DELIVERY": "SHIPPED", "DELIVERED": "IN_DELIVERY", "DELIVERY_FAILED": "IN_DELIVERY", "RETURNING": "DELIVERY_FAILED", "RETURNED": "RETURNING"}
	if expected[shipmentTarget] != shipmentStatus {
		return fmt.Errorf("cannot transition shipment from %s to %s", shipmentStatus, shipmentTarget)
	}
	// Failure and return-in-progress are package-level states. The linked order
	// remains IN_DELIVERY until every package has reached its final return state.
	transitionOrder := orderTarget != "" && orderStatus != orderTarget
	if shipmentTarget == "DELIVERED" || shipmentTarget == "RETURNED" {
		var outstanding int
		if err = tx.QueryRow(c, `SELECT count(*) FROM shipments WHERE order_id=$1 AND status NOT IN ('DELIVERED','RETURNED')`, orderID).Scan(&outstanding); err != nil {
			return err
		}
		transitionOrder = outstanding == 1 && orderStatus != orderTarget
	}
	expectedOrder := map[string]string{"SHIPPED": orders.ReadyToShip, "IN_DELIVERY": orders.Shipped, "DELIVERED": orders.InDelivery, "RETURNED": orders.InDelivery}[shipmentTarget]
	if transitionOrder && orderStatus != expectedOrder {
		orderRank := map[string]int{orders.ReadyToShip: 1, orders.Shipped: 2, orders.InDelivery: 3, orders.Delivered: 4}
		if orderRank[orderStatus] > orderRank[orderTarget] {
			transitionOrder = false
		} else {
			return fmt.Errorf("cannot update package while order is %s", orderStatus)
		}
	}
	if shipmentTarget == "SHIPPED" {
		if packageID == "" {
			return fmt.Errorf("shipment does not have a fulfillment package")
		}
		if err = inventory.FulfillPackage(c, tx, packageID); err != nil {
			return fmt.Errorf("fulfill package inventory: %w", err)
		}
	}
	if _, err = tx.Exec(c, `UPDATE shipments SET status=$1,delivery_failure_reason=CASE WHEN $1='DELIVERY_FAILED' THEN $2 ELSE delivery_failure_reason END,shipped_at=CASE WHEN $1='SHIPPED' THEN now() ELSE shipped_at END,delivered_at=CASE WHEN $1='DELIVERED' THEN now() ELSE delivered_at END,failed_at=CASE WHEN $1='DELIVERY_FAILED' THEN now() ELSE failed_at END,returning_at=CASE WHEN $1='RETURNING' THEN now() ELSE returning_at END,returned_at=CASE WHEN $1='RETURNED' THEN now() ELSE returned_at END WHERE id=$3`, shipmentTarget, failureReason, shipmentID); err != nil {
		return fmt.Errorf("update shipment: %w", err)
	}
	if packageID != "" {
		if _, err = tx.Exec(c, `UPDATE packages SET status=$1,updated_at=now() WHERE id=$2`, shipmentTarget, packageID); err != nil {
			return fmt.Errorf("update package: %w", err)
		}
	}
	if transitionOrder {
		if err = s.transitionTx(c, tx, shop, orderID, orderTarget, ""); err != nil {
			return err
		}
	}
	shipmentEvent := map[string]string{"DELIVERY_FAILED": "shipment.delivery_failed", "RETURNING": "shipment.returning", "RETURNED": "shipment.returned"}[shipmentTarget]
	if shipmentEvent != "" {
		payload := gin.H{"id": shipmentID, "order_id": orderID, "status": shipmentTarget}
		if failureReason != "" {
			payload["reason"] = failureReason
		}
		if err = events.Record(c, tx, shop, shipmentEvent, shipmentID, payload); err != nil {
			return err
		}
	}
	if err = tx.Commit(c); err != nil {
		return fmt.Errorf("commit shipment transition: %w", err)
	}
	return nil
}

func (s *Server) retryDelivery(c *gin.Context) {
	id := c.Param("id")
	var shop string
	err := s.db.QueryRow(c, `SELECT w.shop_id FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.id=$1`, id).Scan(&shop)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "delivery not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	_, err = s.db.Exec(c, `UPDATE webhook_deliveries SET status='PENDING',next_attempt_at=now(),leased_until=NULL WHERE id=$1`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not schedule retry"))
		return
	}
	c.Status(202)
}
func (s *Server) replayEvent(c *gin.Context) {
	id := c.Param("id")
	var shop string
	err := s.db.QueryRow(c, `SELECT shop_id FROM domain_events WHERE id=$1`, id).Scan(&shop)
	if err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "event not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	// An outbox row is unique per durable event. Resetting its publication marker lets
	// the worker fan the same event ID out again without violating that invariant.
	command, err := s.db.Exec(c, `UPDATE outbox SET published_at=NULL WHERE event_id=$1`, id)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not replay event"))
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(500, errorBody("DATABASE_ERROR", "event is missing its outbox record"))
		return
	}
	c.Status(202)
}

func (s *Server) duplicateEvent(c *gin.Context) {
	s.createManualEventDeliveries(c, 2, 0)
}

func (s *Server) delayEvent(c *gin.Context) {
	var input struct {
		DelaySeconds int `json:"delay_seconds"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.DelaySeconds <= 0 || input.DelaySeconds > 86400 {
		c.JSON(400, errorBody("INVALID_REQUEST", "delay_seconds must be between 1 and 86400"))
		return
	}
	s.createManualEventDeliveries(c, 1, input.DelaySeconds)
}

func (s *Server) createManualEventDeliveries(c *gin.Context, copies, delaySeconds int) {
	eventID := c.Param("id")
	var shop string
	if err := s.db.QueryRow(c, `SELECT shop_id FROM domain_events WHERE id=$1`, eventID).Scan(&shop); err != nil {
		c.JSON(404, errorBody("NOT_FOUND", "event not found"))
		return
	}
	if !s.mustAccessShop(c, shop) {
		return
	}
	tx, err := s.db.Begin(c)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not begin debug delivery"))
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	rows, err := tx.Query(c, `SELECT id FROM webhooks WHERE shop_id=$1 AND enabled=true AND subscribed_events ? (SELECT event_type FROM domain_events WHERE id=$2)`, shop, eventID)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load matching webhooks"))
		return
	}
	defer rows.Close()
	webhooks := make([]string, 0)
	for rows.Next() {
		var webhookID string
		if err := rows.Scan(&webhookID); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read matching webhook"))
			return
		}
		webhooks = append(webhooks, webhookID)
	}
	if err := rows.Err(); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not iterate matching webhooks"))
		return
	}
	created := 0
	for _, webhookID := range webhooks {
		for copyNumber := 0; copyNumber < copies; copyNumber++ {
			if _, err := tx.Exec(c, `INSERT INTO webhook_deliveries(id,webhook_id,event_id,next_attempt_at) VALUES($1,$2,$3,now()+($4 * interval '1 second'))`, platform.NewID("del"), webhookID, eventID, delaySeconds); err != nil {
				c.JSON(500, errorBody("DATABASE_ERROR", "could not create debug delivery"))
				return
			}
			created++
		}
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not commit debug delivery"))
		return
	}
	c.JSON(202, gin.H{"event_id": eventID, "deliveries_created": created, "delay_seconds": delaySeconds})
}

func (s *Server) items(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT id,product_id,sku,product_name,price,quantity,subtotal FROM order_items WHERE order_id=$1`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, sku, name string
		var product *string
		var price, sub int64
		var quantity int
		if rows.Scan(&id, &product, &sku, &name, &price, &quantity, &sub) == nil {
			data = append(data, gin.H{"id": id, "product_id": product, "sku": sku, "product_name": name, "price": price, "quantity": quantity, "subtotal": sub})
		}
	}
	return data
}

func (s *Server) packagesForOrder(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT id,package_number,status,created_at,updated_at FROM packages WHERE order_id=$1 ORDER BY created_at`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, number, status string
		var created, updated time.Time
		if err := rows.Scan(&id, &number, &status, &created, &updated); err == nil {
			data = append(data, gin.H{"package_id": id, "package_number": number, "package_status": status, "create_time": created.Unix(), "update_time": updated.Unix()})
		}
	}
	return data
}

func (s *Server) shipmentForOrder(ctx context.Context, orderID string) gin.H {
	var id, tracking, provider, pickupType, status string
	var failureReason *string
	var created time.Time
	var shipped *time.Time
	var delivered *time.Time
	var failed, returningAt, returned *time.Time
	err := s.db.QueryRow(ctx, `SELECT id,tracking_number,shipping_provider,pickup_type,status,delivery_failure_reason,created_at,shipped_at,delivered_at,failed_at,returning_at,returned_at FROM shipments WHERE order_id=$1`, orderID).Scan(&id, &tracking, &provider, &pickupType, &status, &failureReason, &created, &shipped, &delivered, &failed, &returningAt, &returned)
	if err != nil {
		return nil
	}
	return gin.H{"id": id, "order_id": orderID, "tracking_number": tracking, "shipping_provider": provider, "pickup_type": pickupType, "status": status, "delivery_failure_reason": failureReason, "created_at": created, "shipped_at": shipped, "delivered_at": delivered, "failed_at": failed, "returning_at": returningAt, "returned_at": returned}
}

// fulfillmentForOrder returns the selected warehouse without exposing its full
// stock ledger in an order response.
func (s *Server) fulfillmentForOrder(ctx context.Context, orderID string) gin.H {
	var id, code, name, status string
	err := s.db.QueryRow(ctx, `SELECT w.id,w.code,w.name,w.status FROM orders o JOIN warehouses w ON w.id=o.fulfillment_warehouse_id WHERE o.id=$1`, orderID).Scan(&id, &code, &name, &status)
	if err != nil {
		return nil
	}
	return gin.H{"warehouse_id": id, "warehouse_code": code, "warehouse_name": name, "warehouse_status": status}
}

func shipmentControlData(id, orderID, orderNumber, tracking, provider, pickupType, status string, created time.Time, shipped, delivered *time.Time) gin.H {
	return gin.H{
		"id":                id,
		"order_id":          orderID,
		"order_number":      orderNumber,
		"tracking_number":   tracking,
		"shipping_provider": provider,
		"pickup_type":       pickupType,
		"status":            status,
		"created_at":        created,
		"shipped_at":        shipped,
		"delivered_at":      delivered,
	}
}

func shipmentList(shipment gin.H) []gin.H {
	if shipment == nil {
		return []gin.H{}
	}
	return []gin.H{shipment}
}

func (s *Server) orderOperations(ctx context.Context, orderID string) gin.H {
	var provider, paymentStatus string
	var paymentExpiry, paymentFailed, sellerDeadline *time.Time
	var paymentFailure, cancellationActor, cancellationReason *string
	err := s.db.QueryRow(ctx, `SELECT sh.provider_profile,o.payment_status,o.payment_expires_at,o.payment_failed_at,o.seller_deadline_at,o.payment_failure_reason,o.cancellation_actor,o.cancellation_reason FROM orders o JOIN shops sh ON sh.id=o.shop_id WHERE o.id=$1`, orderID).Scan(&provider, &paymentStatus, &paymentExpiry, &paymentFailed, &sellerDeadline, &paymentFailure, &cancellationActor, &cancellationReason)
	if err != nil {
		return gin.H{}
	}
	return gin.H{"provider_profile": provider, "payment_status": paymentStatus, "payment_expires_at": paymentExpiry, "payment_failed_at": paymentFailed, "payment_failure_reason": paymentFailure, "seller_deadline_at": sellerDeadline, "cancellation_actor": cancellationActor, "cancellation_reason": cancellationReason}
}

func paymentInfo(reference *string, paidAt *time.Time) gin.H {
	if paidAt == nil {
		return gin.H{"status": "UNPAID", "reference": nil, "paid_at": nil}
	}
	return gin.H{"status": "PAID", "reference": reference, "paid_at": paidAt}
}

func (s *Server) events(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT id,event_type,occurred_at,payload FROM domain_events WHERE aggregate_id=$1 ORDER BY occurred_at`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, typ string
		var at time.Time
		var payload []byte
		if rows.Scan(&id, &typ, &at, &payload) == nil {
			data = append(data, gin.H{"id": id, "event_type": typ, "occurred_at": at, "payload": json.RawMessage(payload)})
		}
	}
	return data
}
func (s *Server) deliveriesForOrder(ctx context.Context, orderID string) []gin.H {
	rows, err := s.db.Query(ctx, `SELECT d.id,d.event_id,d.status,d.attempt_count FROM webhook_deliveries d JOIN domain_events e ON e.id=d.event_id WHERE e.aggregate_id=$1 ORDER BY d.created_at`, orderID)
	if err != nil {
		return []gin.H{}
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, event, status string
		var attempts int
		if rows.Scan(&id, &event, &status, &attempts) == nil {
			data = append(data, gin.H{"id": id, "event_id": event, "status": status, "attempt_count": attempts})
		}
	}
	return data
}
