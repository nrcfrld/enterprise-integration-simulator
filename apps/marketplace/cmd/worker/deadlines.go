package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/orders"
	orderrepo "github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/repository/orders"
)

const (
	defaultDeadlinePollInterval = time.Second
	defaultDeadlineLease        = 30 * time.Second
	defaultDeadlineBatchSize    = 100
	defaultDeadlineConcurrency  = 8
)

type deadlineOrderService interface {
	CancelOverdue(ctx context.Context, shopID, orderID, reason string) error
}

type deadlineCandidate struct {
	id     string
	shopID string
}

type deadlineRule struct {
	reason     string
	claimQuery string
}

var deadlineRules = []deadlineRule{
	{
		reason: orders.PaymentExpiredReason,
		claimQuery: `WITH candidates AS (
			SELECT id FROM orders
			WHERE status='UNPAID' AND payment_status='PENDING'
			  AND payment_expires_at<=now()
			  AND (deadline_claimed_until IS NULL OR deadline_claimed_until<=now())
			ORDER BY payment_expires_at,id
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE orders AS target
		SET deadline_claimed_until=now()+($2 * interval '1 millisecond')
		FROM candidates
		WHERE target.id=candidates.id
		RETURNING target.id,target.shop_id`,
	},
	{
		reason: orders.SellerSLAExpiredReason,
		claimQuery: `WITH candidates AS (
			SELECT id FROM orders
			WHERE status IN ('PAID','PROCESSING')
			  AND seller_deadline_at<=now()
			  AND (deadline_claimed_until IS NULL OR deadline_claimed_until<=now())
			ORDER BY seller_deadline_at,id
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE orders AS target
		SET deadline_claimed_until=now()+($2 * interval '1 millisecond')
		FROM candidates
		WHERE target.id=candidates.id
		RETURNING target.id,target.shop_id`,
	},
}

func (w *worker) deadlineLoop(ctx context.Context) {
	ticker := time.NewTicker(w.deadlinePollInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.enforceOrderDeadlines(ctx); err != nil {
				w.logger.Error("order deadline enforcement failed", "error", err)
			}
		}
	}
}

// enforceOrderDeadlines drains every currently due deadline through atomically
// claimed batches. Rules are visited round-robin so one continuously busy
// deadline class cannot starve another. A dedicated loop keeps large backlogs
// from blocking webhook delivery scheduling.
func (w *worker) enforceOrderDeadlines(ctx context.Context) error {
	var processErrors []error
	for {
		claimedAny := false
		for _, rule := range deadlineRules {
			candidates, err := w.claimDeadlineBatch(ctx, rule)
			if err != nil {
				processErrors = append(processErrors, err)
				return errors.Join(processErrors...)
			}
			if len(candidates) == 0 {
				continue
			}
			claimedAny = true
			if err := w.processDeadlineBatch(ctx, rule.reason, candidates); err != nil {
				processErrors = append(processErrors, err)
			}
		}
		if !claimedAny {
			return errors.Join(processErrors...)
		}
	}
}

// claimDeadlineBatch uses row locks only for the short claim statement. The
// persisted lease keeps other replicas from selecting the same order after the
// transaction releases its locks and makes crashed claims retryable.
func (w *worker) claimDeadlineBatch(ctx context.Context, rule deadlineRule) ([]deadlineCandidate, error) {
	rows, err := w.db.Query(
		ctx,
		rule.claimQuery,
		w.deadlineBatchSize(),
		max(w.deadlineLease().Milliseconds(), 1),
	)
	if err != nil {
		return nil, fmt.Errorf("claim %s deadlines: %w", rule.reason, err)
	}
	defer rows.Close()

	candidates := make([]deadlineCandidate, 0, w.deadlineBatchSize())
	for rows.Next() {
		var candidate deadlineCandidate
		if err := rows.Scan(&candidate.id, &candidate.shopID); err != nil {
			return nil, fmt.Errorf("scan %s deadline claim: %w", rule.reason, err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate %s deadline claims: %w", rule.reason, err)
	}
	return candidates, nil
}

func (w *worker) processDeadlineBatch(ctx context.Context, reason string, candidates []deadlineCandidate) error {
	if len(candidates) == 0 {
		return nil
	}
	service := w.orderService()
	jobs := make(chan deadlineCandidate)
	errCh := make(chan error, len(candidates))
	workerCount := min(w.deadlineConcurrency(), len(candidates))

	var group sync.WaitGroup
	group.Add(workerCount)
	for range workerCount {
		go func() {
			defer group.Done()
			for candidate := range jobs {
				if err := service.CancelOverdue(ctx, candidate.shopID, candidate.id, reason); err != nil && !errors.Is(err, orders.ErrDeadlineNotEligible) {
					errCh <- fmt.Errorf("expire order %s: %w", candidate.id, err)
				}
			}
		}()
	}

	for _, candidate := range candidates {
		select {
		case jobs <- candidate:
		case <-ctx.Done():
			close(jobs)
			group.Wait()
			close(errCh)
			return ctx.Err()
		}
	}
	close(jobs)
	group.Wait()
	close(errCh)

	batchErrors := make([]error, 0, len(errCh))
	for err := range errCh {
		batchErrors = append(batchErrors, err)
	}
	return errors.Join(batchErrors...)
}

func (w *worker) orderService() deadlineOrderService {
	if w.orders == nil {
		w.orders = orders.NewService(orderrepo.NewPostgreSQLLifecycleRepository(w.db))
	}
	return w.orders
}

func (w *worker) deadlinePollInterval() time.Duration {
	if w.cfg.DeadlinePollInterval > 0 {
		return w.cfg.DeadlinePollInterval
	}
	return defaultDeadlinePollInterval
}

func (w *worker) deadlineLease() time.Duration {
	if w.cfg.DeadlineLease > 0 {
		return w.cfg.DeadlineLease
	}
	return defaultDeadlineLease
}

func (w *worker) deadlineBatchSize() int {
	if w.cfg.DeadlineBatchSize > 0 {
		return w.cfg.DeadlineBatchSize
	}
	return defaultDeadlineBatchSize
}

func (w *worker) deadlineConcurrency() int {
	if w.cfg.DeadlineConcurrency > 0 {
		return w.cfg.DeadlineConcurrency
	}
	return defaultDeadlineConcurrency
}
