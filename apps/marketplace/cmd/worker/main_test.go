package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/webhooks"
)

type deadlineServiceFunc func(context.Context, string, string, string) error

func (function deadlineServiceFunc) CancelOverdue(ctx context.Context, shopID, orderID, reason string) error {
	return function(ctx, shopID, orderID, reason)
}

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

func TestProcessDeadlineBatchBoundsConcurrency(t *testing.T) {
	t.Parallel()
	const concurrency = 3
	started := make(chan struct{}, 8)
	release := make(chan struct{})
	var active atomic.Int32
	var peak atomic.Int32
	var calls atomic.Int32
	service := deadlineServiceFunc(func(ctx context.Context, _, _, _ string) error {
		current := active.Add(1)
		calls.Add(1)
		for {
			observed := peak.Load()
			if current <= observed || peak.CompareAndSwap(observed, current) {
				break
			}
		}
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
		}
		active.Add(-1)
		return nil
	})
	candidates := make([]deadlineCandidate, 8)
	for index := range candidates {
		candidates[index] = deadlineCandidate{id: fmt.Sprintf("order_%d", index), shopID: "shop_1"}
	}
	w := &worker{
		cfg:    platform.Config{DeadlineConcurrency: concurrency},
		orders: service,
	}
	done := make(chan error, 1)
	go func() {
		done <- w.processDeadlineBatch(context.Background(), "PAYMENT_EXPIRED", candidates)
	}()

	for range concurrency {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("deadline workers did not start")
		}
	}
	select {
	case <-started:
		t.Fatal("worker pool exceeded configured concurrency")
	case <-time.After(25 * time.Millisecond):
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("process deadline batch: %v", err)
	}
	if calls.Load() != int32(len(candidates)) || peak.Load() != concurrency {
		t.Fatalf("deadline calls=%d peak=%d, want %d/%d", calls.Load(), peak.Load(), len(candidates), concurrency)
	}
}

func TestProcessDeadlineBatchContinuesAfterFailure(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	w := &worker{
		cfg: platform.Config{DeadlineConcurrency: 2},
		orders: deadlineServiceFunc(func(_ context.Context, _, orderID, _ string) error {
			calls.Add(1)
			if orderID == "order_2" {
				return errors.New("database unavailable")
			}
			return nil
		}),
	}
	err := w.processDeadlineBatch(context.Background(), "PAYMENT_EXPIRED", []deadlineCandidate{
		{id: "order_1", shopID: "shop_1"},
		{id: "order_2", shopID: "shop_1"},
		{id: "order_3", shopID: "shop_1"},
	})
	if err == nil || !strings.Contains(err.Error(), "expire order order_2") {
		t.Fatalf("process deadline batch error = %v", err)
	}
	if calls.Load() != 3 {
		t.Fatalf("processed %d orders, want 3", calls.Load())
	}
}
