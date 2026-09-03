// Package server exposes the control-plane and public integration HTTP APIs.
package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/auth"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/idempotency"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/observability"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/products"
	authrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/auth"
	orderrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/orders"
	productrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/products"
	store "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/store/sqlc"
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
	idem    *idempotency.Manager
}

// New constructs the HTTP application service.
func New(db *pgxpool.Pool, redisClient *redis.Client, cfg platform.Config, logger *slog.Logger) *Server {
	queries := store.New(db)
	identities := authrepo.NewPostgreSQLRepository(queries)
	idempotencyLease := max(60*time.Second, cfg.RequestLifetime+10*time.Second)
	server := &Server{
		db:      db,
		redis:   redisClient,
		cfg:     cfg,
		logger:  logger,
		store:   queries,
		auth:    auth.NewService(identities, cfg.SessionSecret, auth.WithRegistration(identities, platform.NewID)),
		catalog: products.NewService(productrepo.NewPostgreSQLCreator(db), platform.NewID),
		metrics: observability.NewHTTPMetrics(),
		idem:    idempotency.NewManager(db, idempotencyLease),
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
	router := gin.New()
	router.Use(s.metrics.Middleware(s.logger), observability.Recovery(s.logger), cors())
	s.registerOperationalRoutes(router)
	s.registerControlRoutes(router)
	s.registerSharedRoutes(router)
	s.registerShopeeRoutes(router)
	s.registerTokopediaRoutes(router)
	return router
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
	ID             string `json:"id"`
	Email          string `json:"email"`
	Role           string `json:"role"`
	SessionVersion int    `json:"session_version"`
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

func (s *Server) register(c *gin.Context) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "email and an 8+ character password are required"))
		return
	}
	claims, token, err := s.auth.Register(c, input.Email, input.Password)
	if errors.Is(err, auth.ErrInvalidRegistration) {
		c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "enter a valid email and an 8+ character password"))
		return
	}
	if errors.Is(err, auth.ErrEmailAlreadyRegistered) {
		c.JSON(http.StatusConflict, errorBody("EMAIL_EXISTS", "an account already uses this email"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, errorBody("REGISTRATION_ERROR", "could not create account"))
		return
	}
	a := actor{ID: claims.ID, Email: claims.Email, Role: claims.Role, SessionVersion: claims.SessionVersion}
	c.JSON(http.StatusCreated, gin.H{"token": token, "user": a})
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
	body, err := readRequestBody(c, s.cfg.RequestBodyLimit)
	if err != nil {
		if isRequestTooLarge(err) {
			c.JSON(http.StatusRequestEntityTooLarge, errorBody("PAYLOAD_TOO_LARGE", "request body exceeds the configured limit"))
		} else {
			c.JSON(http.StatusBadRequest, errorBody("INVALID_REQUEST", "could not read body"))
		}
		c.Abort()
		return
	}
	setRequestBody(c, body)
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
