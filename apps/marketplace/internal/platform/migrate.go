package platform

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

const migrationLockID int64 = 826315

// RunMigrations applies committed Goose migrations. Goose maintains its own
// version ledger; the idempotent SQL keeps existing development databases safe
// while they transition away from the former custom migration ledger.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool, directory string) (err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration lock connection: %w", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationLockID); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	defer func() { _, _ = conn.Exec(ctx, `SELECT pg_advisory_unlock($1)`, migrationLockID) }()

	db := stdlib.OpenDBFromPool(pool)
	defer func() {
		if closeErr := db.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close goose database: %w", closeErr)
		}
	}()
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("configure goose postgres dialect: %w", err)
	}
	if err := goose.UpContext(ctx, db, directory); err != nil {
		return fmt.Errorf("apply goose migrations: %w", err)
	}
	return nil
}
