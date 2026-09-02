// Package ratelimit provides Redis-backed request quotas for public APIs.
package ratelimit

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// FixedWindow tracks one credential quota per wall-clock minute.
type FixedWindow struct{ client redisCommands }

type redisCommands interface {
	Incr(ctx context.Context, key string) *redis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
}

// NewFixedWindow constructs a Redis-backed fixed-window limiter.
func NewFixedWindow(client *redis.Client) *FixedWindow { return &FixedWindow{client: client} }

// Allow consumes one request and returns whether it is inside the limit.
// Redis failures fail open so the simulator remains usable during an outage.
func (l *FixedWindow) Allow(ctx context.Context, credential string, limit int) (bool, int) {
	key := fixedWindowKey(credential, time.Now())
	n, err := l.client.Incr(ctx, key).Result()
	if err != nil {
		return true, limit
	}
	if n == 1 {
		_ = l.client.Expire(ctx, key, time.Minute).Err()
	}
	remaining := limit - int(n)
	if remaining < 0 {
		remaining = 0
	}
	return n <= int64(limit), remaining
}

func fixedWindowKey(credential string, at time.Time) string {
	return "marketplace:rate:" + credential + ":" + strconv.FormatInt(at.Unix()/60, 10)
}
