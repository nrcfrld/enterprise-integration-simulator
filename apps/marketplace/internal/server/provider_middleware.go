package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/idempotency"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/scenarios"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/tokopedia"
)

func (s *Server) idempotent(operation string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.GetHeader("Idempotency-Key")
		if key == "" {
			s.idempotencyError(c, http.StatusBadRequest, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required")
			c.Abort()
			return
		}
		if len(key) > 255 {
			s.idempotencyError(c, http.StatusBadRequest, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must not exceed 255 characters")
			c.Abort()
			return
		}
		client := currentClient(c)
		body := requestBody(c)
		claim := idempotency.Claim{
			ID:           platform.NewID("idem"),
			CredentialID: client.CredentialID,
			Operation:    operation,
			Key:          key,
			RequestHash:  requestFingerprint(c.Request, body),
		}
		result, err := s.idem.Acquire(c, claim)
		if err != nil {
			s.idempotencyError(c, http.StatusInternalServerError, "DATABASE_ERROR", "could not claim idempotency key")
			c.Abort()
			return
		}
		switch result.Outcome {
		case idempotency.OutcomeReplay:
			c.Header("Idempotent-Replayed", "true")
			c.Data(result.Status, "application/json", result.Body)
			c.Abort()
			return
		case idempotency.OutcomeConflict:
			s.idempotencyError(c, http.StatusConflict, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different request")
			c.Abort()
			return
		case idempotency.OutcomeInProgress:
			c.Header("Retry-After", "1")
			s.idempotencyError(c, http.StatusConflict, "IDEMPOTENCY_IN_PROGRESS", "a request with this Idempotency-Key is still processing")
			c.Abort()
			return
		}
		underlyingWriter := c.Writer
		recorder := &responseRecorder{ResponseWriter: underlyingWriter}
		c.Writer = recorder
		c.Next()
		status := recorder.Status()
		if status >= 200 && status < 300 {
			responseBody := recorder.body.Bytes()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := s.idem.Complete(ctx, claim, status, responseBody)
			cancel()
			if err != nil {
				s.logger.Error("idempotency completion failed", "operation", operation, "credential", platform.Redact(client.CredentialID), "error", err)
				c.Writer = underlyingWriter
				c.Writer.Header().Del("Content-Length")
				s.idempotencyError(c, http.StatusInternalServerError, "IDEMPOTENCY_FINALIZATION_FAILED", "the operation completed but its retry-safe response could not be finalized")
				c.Abort()
				return
			}
			c.Writer = underlyingWriter
			if err := recorder.commit(); err != nil {
				s.logger.Error("idempotent response write failed", "operation", operation, "credential", platform.Redact(client.CredentialID), "error", err)
			}
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err = s.idem.Release(ctx, claim)
		cancel()
		if err != nil {
			s.logger.Error("idempotency release failed", "operation", operation, "credential", platform.Redact(client.CredentialID), "error", err)
		}
		c.Writer = underlyingWriter
		if err := recorder.commit(); err != nil {
			s.logger.Error("idempotent response write failed", "operation", operation, "credential", platform.Redact(client.CredentialID), "error", err)
		}
	}
}

func (s *Server) idempotencyError(c *gin.Context, status int, code, message string) {
	provider, _ := c.Get("provider_contract")
	switch provider {
	case orders.ShopeeLike:
		s.shopeeError(c, status, "error_idempotency", message)
	case orders.TokopediaLike:
		numericCode := 36000004
		if status >= http.StatusInternalServerError {
			numericCode = 50000
		}
		c.JSON(status, gin.H{"code": numericCode, "message": message, "request_id": "req_" + platform.NewID("")})
	default:
		c.JSON(status, errorBody(code, message))
	}
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
	body, err := readRequestBody(c, s.cfg.RequestBodyLimit)
	if err != nil {
		status := http.StatusBadRequest
		message := "could not read body"
		if isRequestTooLarge(err) {
			status = http.StatusRequestEntityTooLarge
			message = "request body exceeds the configured limit"
		}
		s.shopeeError(c, status, "error_param", message)
		c.Abort()
		return
	}
	setRequestBody(c, body)
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
	if status >= http.StatusInternalServerError {
		return status
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
	body, err := readRequestBody(c, s.cfg.RequestBodyLimit)
	if err != nil {
		code := http.StatusBadRequest
		message := "could not read request body"
		if isRequestTooLarge(err) {
			code = http.StatusRequestEntityTooLarge
			message = "request body exceeds the configured limit"
		}
		s.tokopediaError(c, code, message)
		c.Abort()
		return
	}
	setRequestBody(c, body)
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
	status := http.StatusBadRequest
	switch {
	case code == http.StatusTooManyRequests:
		status = http.StatusTooManyRequests
	case code == http.StatusRequestEntityTooLarge:
		status = http.StatusRequestEntityTooLarge
	case code >= http.StatusInternalServerError && code <= 599:
		status = code
	case code == 36000001 || code == 36000002:
		status = http.StatusUnauthorized
	}
	c.JSON(status, gin.H{"code": code, "message": message, "request_id": "req_" + platform.NewID(""), "data": gin.H{}})
}

func (s *Server) tokopediaSuccess(c *gin.Context, data gin.H) {
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "request_id": "req_" + platform.NewID(""), "data": data})
}

func (s *Server) setTokopediaRateLimitHeaders(c *gin.Context, limit, remaining int, resetAt time.Time) {
	c.Header("X-TTS-Api-Call-Limit", strconv.Itoa(limit))
	c.Header("X-TTS-RateLimit-Limit", strconv.Itoa(limit))
	c.Header("X-TTS-RateLimit-Remaining", strconv.Itoa(max(remaining, 0)))
	c.Header("X-TTS-RateLimit-Reset", strconv.FormatInt(resetAt.Unix(), 10))
}
