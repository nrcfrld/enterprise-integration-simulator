package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := platform.LoadConfig()
	if err != nil {
		logger.Error("configuration failed", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := platform.RunMigrations(ctx, db, "migrations"); err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	if err := bootstrapAdmin(ctx, db, cfg); err != nil {
		logger.Error("bootstrap admin failed", "error", err)
		os.Exit(1)
	}
	options, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logger.Error("redis URL invalid", "error", err)
		os.Exit(1)
	}
	redisClient := redis.NewClient(options)
	defer func() {
		if err := redisClient.Close(); err != nil {
			logger.Warn("redis close failed", "error", err)
		}
	}()
	api := server.New(db, redisClient, cfg, logger)
	if err := api.EnsureDevelopmentSeed(ctx); err != nil {
		logger.Error("bootstrap development seed failed", "error", err)
		os.Exit(1)
	}
	httpServer := &http.Server{
		Addr:              cfg.HTTPAddress,
		Handler:           api.Router(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.RequestLifetime,
		WriteTimeout:      cfg.RequestLifetime,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server stopped", "error", err)
		}
	}()
	<-ctx.Done()
	logger.Info("shutting down API")
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdown)
}

func bootstrapAdmin(ctx context.Context, db *pgxpool.Pool, cfg platform.Config) error {
	var exists bool
	if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)`, cfg.AdminEmail).Scan(&exists); err != nil || exists {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')`, platform.NewID("usr"), cfg.AdminEmail, string(hash))
	return err
}
