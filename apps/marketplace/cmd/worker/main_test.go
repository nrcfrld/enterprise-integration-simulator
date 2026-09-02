package main

import (
	"testing"
	"time"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
)

func TestRetryAfter(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		attempt int
		want    time.Duration
	}{
		{"first failure", 1, 30 * time.Second},
		{"second failure", 2, 2 * time.Minute},
		{"third failure", 3, 10 * time.Minute},
		{"fourth failure", 4, 30 * time.Minute},
		{"maximum cap", 99, 30 * time.Minute},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := webhooks.RetryAfter(test.attempt); got != test.want {
				t.Fatalf("RetryAfter(%d) = %s, want %s", test.attempt, got, test.want)
			}
		})
	}
}
