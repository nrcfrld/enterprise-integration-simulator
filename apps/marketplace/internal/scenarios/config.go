// Package scenarios owns validation for per-shop failure injection.
package scenarios

import "fmt"

// Config is isolated configuration for one shop's simulated failures.
type Config struct {
	APISlowMS               int  `json:"api_slow_ms"`
	APISlowProbability      int  `json:"api_slow_probability"`
	APIRandom500Probability int  `json:"api_random_500_probability"`
	APITimeoutProbability   int  `json:"api_timeout_probability"`
	ForceRateLimit          bool `json:"force_rate_limit"`
	WebhookDuplicate        bool `json:"webhook_duplicate"`
	WebhookDelaySeconds     int  `json:"webhook_delay_seconds"`
	WebhookOutOfOrder       bool `json:"webhook_out_of_order"`
	WebhookForceFailure     bool `json:"webhook_force_failure"`
}

// Validate prevents malformed failure scenarios from reaching a shop.
func (c Config) Validate() error {
	if c.APISlowMS < 0 || c.WebhookDelaySeconds < 0 {
		return fmt.Errorf("delays must be non-negative")
	}
	if c.APISlowProbability < 0 || c.APISlowProbability > 100 || c.APIRandom500Probability < 0 || c.APIRandom500Probability > 100 || c.APITimeoutProbability < 0 || c.APITimeoutProbability > 100 {
		return fmt.Errorf("probabilities must be between 0 and 100")
	}
	return nil
}
