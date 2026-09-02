// Package authrepo provides PostgreSQL persistence for authentication use cases.
package authrepo

import (
	"context"
	"errors"
	"fmt"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/auth"
	store "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
)

// PostgreSQLRepository implements auth.IdentityRepository with sqlc queries.
type PostgreSQLRepository struct {
	queries *store.Queries
}

var _ auth.IdentityRepository = (*PostgreSQLRepository)(nil)

// NewPostgreSQLRepository constructs a PostgreSQL identity repository.
func NewPostgreSQLRepository(queries *store.Queries) *PostgreSQLRepository {
	return &PostgreSQLRepository{queries: queries}
}

// FindByEmail returns the identity used during credential verification.
func (r *PostgreSQLRepository) FindByEmail(ctx context.Context, email string) (auth.Identity, error) {
	row, err := r.queries.GetUserForLogin(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Identity{}, auth.ErrIdentityNotFound
	}
	if err != nil {
		return auth.Identity{}, fmt.Errorf("get user for login: %w", err)
	}
	return auth.Identity{ID: row.ID, Email: row.Email, Role: row.Role, SessionVersion: int(row.SessionVersion), PasswordHash: row.PasswordHash}, nil
}

// FindByID returns the identity used during session validation.
func (r *PostgreSQLRepository) FindByID(ctx context.Context, id string) (auth.Identity, error) {
	row, err := r.queries.GetSessionUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Identity{}, auth.ErrIdentityNotFound
	}
	if err != nil {
		return auth.Identity{}, fmt.Errorf("get session user: %w", err)
	}
	return auth.Identity{ID: row.ID, Email: row.Email, Role: row.Role, SessionVersion: int(row.SessionVersion)}, nil
}
