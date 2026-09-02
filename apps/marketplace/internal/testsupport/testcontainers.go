//go:build testcontainers

// Package testsupport provides disposable PostgreSQL and Redis services for integration tests.
package testsupport

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// Environment owns one isolated PostgreSQL database and Redis instance.
type Environment struct {
	DatabaseURL string
	RedisURL    string
	DB          *pgxpool.Pool
	Redis       *redis.Client
	postgres    testcontainers.Container
	redis       testcontainers.Container
}

// Start creates disposable PostgreSQL and Redis containers and waits until both accept connections.
func Start(t *testing.T) *Environment {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)

	postgres, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:           "postgres:16-alpine",
			ExposedPorts:    []string{"5432/tcp"},
			Env:             map[string]string{"POSTGRES_DB": "marketplace", "POSTGRES_USER": "marketplace", "POSTGRES_PASSWORD": "marketplace"},
			WaitingFor:      wait.ForListeningPort("5432/tcp").WithStartupTimeout(60 * time.Second),
			AlwaysPullImage: false,
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start PostgreSQL container: %v", err)
	}

	redisContainer, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:           "redis:7-alpine",
			ExposedPorts:    []string{"6379/tcp"},
			WaitingFor:      wait.ForListeningPort("6379/tcp").WithStartupTimeout(60 * time.Second),
			AlwaysPullImage: false,
		},
		Started: true,
	})
	if err != nil {
		_ = postgres.Terminate(context.Background())
		t.Fatalf("start Redis container: %v", err)
	}

	postgresHost, err := postgres.Host(ctx)
	if err != nil {
		t.Fatalf("resolve PostgreSQL host: %v", err)
	}
	postgresPort, err := postgres.MappedPort(ctx, "5432/tcp")
	if err != nil {
		t.Fatalf("resolve PostgreSQL port: %v", err)
	}
	redisHost, err := redisContainer.Host(ctx)
	if err != nil {
		t.Fatalf("resolve Redis host: %v", err)
	}
	redisPort, err := redisContainer.MappedPort(ctx, "6379/tcp")
	if err != nil {
		t.Fatalf("resolve Redis port: %v", err)
	}

	databaseURL := fmt.Sprintf("postgres://marketplace:marketplace@%s:%s/marketplace?sslmode=disable", postgresHost, postgresPort.Port())
	redisURL := fmt.Sprintf("redis://%s:%s/0", redisHost, redisPort.Port())
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("create PostgreSQL pool: %v", err)
	}
	redisClient := redis.NewClient(&redis.Options{Addr: redisHost + ":" + redisPort.Port()})
	if err := waitForReady(ctx, db, redisClient); err != nil {
		db.Close()
		_ = redisClient.Close()
		t.Fatalf("wait for test services: %v", err)
	}

	env := &Environment{DatabaseURL: databaseURL, RedisURL: redisURL, DB: db, Redis: redisClient, postgres: postgres, redis: redisContainer}
	t.Cleanup(func() {
		db.Close()
		if err := redisClient.Close(); err != nil {
			t.Errorf("close test Redis client: %v", err)
		}
		if err := redisContainer.Terminate(context.Background()); err != nil {
			t.Errorf("terminate Redis container: %v", err)
		}
		if err := postgres.Terminate(context.Background()); err != nil {
			t.Errorf("terminate PostgreSQL container: %v", err)
		}
	})
	return env
}

func waitForReady(ctx context.Context, db *pgxpool.Pool, redisClient *redis.Client) error {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := db.Ping(ctx); err == nil {
			if err := redisClient.Ping(ctx).Err(); err == nil {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
