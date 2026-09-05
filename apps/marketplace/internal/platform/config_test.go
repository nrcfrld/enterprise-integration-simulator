package platform

import (
	"testing"
	"time"
)

func TestLoadConfigRequestTimeout(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_REQUEST_TIMEOUT", "7s")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.RequestLifetime != 7*time.Second {
		t.Fatalf("request lifetime = %s, want 7s", cfg.RequestLifetime)
	}
}

func TestLoadConfigRejectsInvalidRequestTimeout(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_REQUEST_TIMEOUT", "zero")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("LoadConfig accepted an invalid request timeout")
	}
}

func TestLoadConfigReadsRateLimitAndSeedSwitch(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_RATE_LIMIT_PER_MINUTE", "42")
	t.Setenv("MARKETPLACE_SEED_ON_BOOT", "true")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.RateLimitPerMinute != 42 || !cfg.SeedOnBoot {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestLoadConfigReadsRequestBodyLimit(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_REQUEST_BODY_LIMIT_BYTES", "2048")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.RequestBodyLimit != 2048 {
		t.Fatalf("request body limit = %d, want 2048", cfg.RequestBodyLimit)
	}
}

func TestLoadConfigRejectsInvalidRequestBodyLimit(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_REQUEST_BODY_LIMIT_BYTES", "0")

	if _, err := LoadConfig(); err == nil {
		t.Fatal("LoadConfig accepted a zero request body limit")
	}
}

func TestLoadConfigSecuresProductionWebhookTargets(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_ENV", "production")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.AllowPrivateWebhooks {
		t.Fatal("production config allowed private webhook targets")
	}
}

func TestLoadConfigRejectsInvalidRateLimit(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_RATE_LIMIT_PER_MINUTE", "0")

	if _, err := LoadConfig(); err == nil {
		t.Fatal("LoadConfig accepted a zero rate limit")
	}
}

func TestLoadConfigReadsDeadlineWorkerSettings(t *testing.T) {
	t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
	t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
	t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
	t.Setenv("MARKETPLACE_DEADLINE_POLL_INTERVAL", "2s")
	t.Setenv("MARKETPLACE_DEADLINE_LEASE", "45s")
	t.Setenv("MARKETPLACE_DEADLINE_BATCH_SIZE", "250")
	t.Setenv("MARKETPLACE_DEADLINE_CONCURRENCY", "12")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.DeadlinePollInterval != 2*time.Second || cfg.DeadlineLease != 45*time.Second || cfg.DeadlineBatchSize != 250 || cfg.DeadlineConcurrency != 12 {
		t.Fatalf("unexpected deadline worker config: %#v", cfg)
	}
}

func TestLoadConfigRejectsInvalidDeadlineWorkerSettings(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "poll interval", key: "MARKETPLACE_DEADLINE_POLL_INTERVAL", value: "never"},
		{name: "lease", key: "MARKETPLACE_DEADLINE_LEASE", value: "0s"},
		{name: "batch size", key: "MARKETPLACE_DEADLINE_BATCH_SIZE", value: "0"},
		{name: "concurrency", key: "MARKETPLACE_DEADLINE_CONCURRENCY", value: "-1"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("MARKETPLACE_ENCRYPTION_KEY", "test-encryption")
			t.Setenv("MARKETPLACE_SESSION_SECRET", "test-session")
			t.Setenv("MARKETPLACE_ADMIN_PASSWORD", "test-password")
			t.Setenv(test.key, test.value)
			if _, err := LoadConfig(); err == nil {
				t.Fatalf("LoadConfig accepted %s=%q", test.key, test.value)
			}
		})
	}
}
