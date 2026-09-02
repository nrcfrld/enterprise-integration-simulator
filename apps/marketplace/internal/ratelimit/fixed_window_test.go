package ratelimit

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type fakeRedisCommands struct {
	count       int64
	err         error
	expireCalls int
	key         string
}

func (f *fakeRedisCommands) Incr(_ context.Context, key string) *redis.IntCmd {
	f.key = key
	return redis.NewIntResult(f.count, f.err)
}

func (f *fakeRedisCommands) Expire(_ context.Context, _ string, _ time.Duration) *redis.BoolCmd {
	f.expireCalls++
	return redis.NewBoolResult(true, nil)
}

func TestFixedWindowAllow(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		count, limit  int64
		err           error
		wantAllowed   bool
		wantRemaining int
		wantExpiry    int
	}{
		{name: "first request starts a window", count: 1, limit: 3, wantAllowed: true, wantRemaining: 2, wantExpiry: 1},
		{name: "last permitted request", count: 3, limit: 3, wantAllowed: true, wantRemaining: 0},
		{name: "over quota request", count: 4, limit: 3, wantAllowed: false, wantRemaining: 0},
		{name: "redis failure fails open", limit: 3, err: errors.New("redis unavailable"), wantAllowed: true, wantRemaining: 3},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			client := &fakeRedisCommands{count: test.count, err: test.err}
			allowed, remaining := (&FixedWindow{client: client}).Allow(context.Background(), "cred_1", int(test.limit))
			if allowed != test.wantAllowed || remaining != test.wantRemaining {
				t.Fatalf("Allow() = (%v, %d), want (%v, %d)", allowed, remaining, test.wantAllowed, test.wantRemaining)
			}
			if client.expireCalls != test.wantExpiry {
				t.Fatalf("Expire calls = %d, want %d", client.expireCalls, test.wantExpiry)
			}
			if test.err == nil && client.key == "" {
				t.Fatal("Allow() did not create a Redis key")
			}
		})
	}
}

func TestFixedWindowKey(t *testing.T) {
	t.Parallel()
	at := time.Unix(125, 0)
	if got := fixedWindowKey("cred_1", at); got != "marketplace:rate:cred_1:2" {
		t.Fatalf("fixedWindowKey() = %q", got)
	}
}
