// Package orderrepo provides PostgreSQL persistence for order application services.
package orderrepo

import (
	"context"
	"errors"
	"fmt"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/events"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/inventory"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQLLifecycleRepository implements the transactional order lifecycle
// persistence contract using pgx.
type PostgreSQLLifecycleRepository struct {
	pool *pgxpool.Pool
}

var _ orders.LifecycleRepository = (*PostgreSQLLifecycleRepository)(nil)

// NewPostgreSQLLifecycleRepository constructs an order lifecycle repository.
func NewPostgreSQLLifecycleRepository(pool *pgxpool.Pool) *PostgreSQLLifecycleRepository {
	return &PostgreSQLLifecycleRepository{pool: pool}
}

// InTransaction executes one lifecycle operation atomically.
func (r *PostgreSQLLifecycleRepository) InTransaction(ctx context.Context, operation func(context.Context, orders.LifecycleTransaction) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin lifecycle transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := operation(ctx, lifecycleTransaction{tx: tx}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit lifecycle transaction: %w", err)
	}
	return nil
}

type lifecycleTransaction struct {
	tx pgx.Tx
}

var _ orders.LifecycleTransaction = lifecycleTransaction{}

func (t lifecycleTransaction) LockOrder(ctx context.Context, shopID, orderID string) (orders.LifecycleState, error) {
	var state orders.LifecycleState
	query := "SELECT o.status,s.provider_profile,o.payment_status,o.payment_expires_at FROM orders o JOIN shops s ON s.id=o.shop_id WHERE o.id=$1 AND o.shop_id=$2 FOR UPDATE"
	err := t.tx.QueryRow(ctx, query, orderID, shopID).Scan(&state.Status, &state.Provider, &state.PaymentStatus, &state.PaymentExpires)
	if errors.Is(err, pgx.ErrNoRows) {
		return orders.LifecycleState{}, orders.ErrOrderNotFound
	}
	if err != nil {
		return orders.LifecycleState{}, fmt.Errorf("lock order: %w", err)
	}
	return state, nil
}

func (t lifecycleTransaction) UpdateOrder(ctx context.Context, orderID string, update orders.TransitionUpdate) error {
	query := "UPDATE orders SET status=$1,payment_reference=CASE WHEN $1='PAID' THEN $2 ELSE payment_reference END,paid_at=CASE WHEN $1='PAID' THEN now() ELSE paid_at END,payment_status=CASE WHEN $1='PAID' THEN 'PAID' ELSE payment_status END,seller_deadline_at=CASE WHEN $1='PAID' AND $3='SHOPEE_LIKE' AND $4 > 0 THEN now()+($4 * interval '1 second') ELSE seller_deadline_at END,cancellation_actor=CASE WHEN $1='CANCELLED' THEN $5 ELSE cancellation_actor END,cancellation_reason=CASE WHEN $1='CANCELLED' THEN $6 ELSE cancellation_reason END,updated_at=now() WHERE id=$7"
	_, err := t.tx.Exec(ctx, query, update.Target, update.PaymentReference, "SHOPEE_LIKE", int(update.SellerSLA.Seconds()), update.CancellationActor, update.CancellationReason, orderID)
	if err != nil {
		return fmt.Errorf("update order: %w", err)
	}
	return nil
}

func (t lifecycleTransaction) CommitInventory(ctx context.Context, orderID string) error {
	if err := inventory.Commit(ctx, t.tx, orderID); err != nil {
		return fmt.Errorf("commit inventory: %w", err)
	}
	return nil
}

func (t lifecycleTransaction) ReleaseInventory(ctx context.Context, orderID string) error {
	if err := inventory.Release(ctx, t.tx, orderID); err != nil {
		return fmt.Errorf("release inventory: %w", err)
	}
	return nil
}

func (t lifecycleTransaction) RecordEvent(ctx context.Context, shopID, eventType, aggregateID string, payload map[string]any) error {
	if err := events.Record(ctx, t.tx, shopID, eventType, aggregateID, payload); err != nil {
		return fmt.Errorf("record outbox event: %w", err)
	}
	return nil
}
