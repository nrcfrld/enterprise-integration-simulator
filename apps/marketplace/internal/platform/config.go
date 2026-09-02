// Package platform contains process-level configuration and infrastructure helpers.
package platform

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the immutable runtime configuration of a marketplace process.
type Config struct {
	DatabaseURL        string
	RedisURL           string
	AdminEmail         string
	AdminPassword      string
	EncryptionKey      []byte
	SessionSecret      []byte
	HTTPAddress        string
	RequestLifetime    time.Duration
	RateLimitPerMinute int
	SeedOnBoot         bool
	PaymentExpiry      time.Duration
	SellerSLA          time.Duration
}

// LoadConfig reads configuration from MARKETPLACE_* environment variables.
func LoadConfig() (Config, error) {
	cfg := Config{
		DatabaseURL:        value("MARKETPLACE_DATABASE_URL", "postgres://marketplace:marketplace@localhost:5432/marketplace?sslmode=disable"),
		RedisURL:           value("MARKETPLACE_REDIS_URL", "redis://localhost:6379/0"),
		AdminEmail:         value("MARKETPLACE_ADMIN_EMAIL", "admin@example.test"),
		AdminPassword:      value("MARKETPLACE_ADMIN_PASSWORD", "change-me-now"),
		HTTPAddress:        value("MARKETPLACE_HTTP_ADDRESS", ":8080"),
		RequestLifetime:    30 * time.Second,
		RateLimitPerMinute: 100,
		PaymentExpiry:      30 * time.Minute,
		SellerSLA:          48 * time.Hour,
	}
	if cfg.AdminPassword == "" {
		return Config{}, fmt.Errorf("MARKETPLACE_ADMIN_PASSWORD cannot be empty")
	}
	if raw := os.Getenv("MARKETPLACE_REQUEST_TIMEOUT"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("MARKETPLACE_REQUEST_TIMEOUT must be a positive duration")
		}
		cfg.RequestLifetime = parsed
	}
	if raw := os.Getenv("MARKETPLACE_RATE_LIMIT_PER_MINUTE"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 {
			return Config{}, fmt.Errorf("MARKETPLACE_RATE_LIMIT_PER_MINUTE must be a positive integer")
		}
		cfg.RateLimitPerMinute = limit
	}
	for _, setting := range []struct {
		name string
		to   *time.Duration
	}{
		{"MARKETPLACE_PAYMENT_EXPIRY", &cfg.PaymentExpiry},
		{"MARKETPLACE_SELLER_SLA", &cfg.SellerSLA},
	} {
		if raw := os.Getenv(setting.name); raw != "" {
			parsed, err := time.ParseDuration(raw)
			if err != nil || parsed <= 0 {
				return Config{}, fmt.Errorf("%s must be a positive duration", setting.name)
			}
			*setting.to = parsed
		}
	}
	if raw := os.Getenv("MARKETPLACE_SEED_ON_BOOT"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("MARKETPLACE_SEED_ON_BOOT must be true or false")
		}
		cfg.SeedOnBoot = enabled
	}
	if raw := os.Getenv("MARKETPLACE_ENCRYPTION_KEY"); raw == "" {
		return Config{}, fmt.Errorf("MARKETPLACE_ENCRYPTION_KEY is required")
	} else {
		sum := sha256.Sum256([]byte(raw))
		cfg.EncryptionKey = sum[:]
	}
	if raw := os.Getenv("MARKETPLACE_SESSION_SECRET"); raw == "" {
		return Config{}, fmt.Errorf("MARKETPLACE_SESSION_SECRET is required")
	} else {
		sum := sha256.Sum256([]byte(raw))
		cfg.SessionSecret = sum[:]
	}
	return cfg, nil
}

func value(key, fallback string) string {
	if got := strings.TrimSpace(os.Getenv(key)); got != "" {
		return got
	}
	return fallback
}

// Redact keeps a stable, safe representation of a secret for logs.
func Redact(input string) string {
	if input == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(input))
	return "sha256:" + base64.RawURLEncoding.EncodeToString(sum[:6])
}
