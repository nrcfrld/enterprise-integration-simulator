package orders

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	// ErrOrderNotFound is returned when an order is absent from its shop.
	ErrOrderNotFound = errors.New("order not found")
	// ErrInvalidTransition is returned when the current lifecycle state cannot
	// move to the requested state.
	ErrInvalidTransition = errors.New("invalid order transition")
)

// LifecycleState is the locked persisted state needed for a lifecycle decision.
type LifecycleState struct {
	Status         string
	Provider       string
	PaymentStatus  string
	PaymentExpires *time.Time
}

// TransitionUpdate is the persistence change decided by Service.
type TransitionUpdate struct {
	Target             string
	PaymentReference   string
	SellerSLA          time.Duration
	CancellationActor  string
	CancellationReason string
}

// LifecycleTransaction is the narrow persistence contract used by the order
// lifecycle service. Implementations must keep all methods in one transaction.
type LifecycleTransaction interface {
	LockOrder(ctx context.Context, shopID, orderID string) (LifecycleState, error)
	UpdateOrder(ctx context.Context, orderID string, update TransitionUpdate) error
	CommitInventory(ctx context.Context, orderID string) error
	ReleaseInventory(ctx context.Context, orderID string) error
	RecordEvent(ctx context.Context, shopID, eventType, aggregateID string, payload map[string]any) error
}

// LifecycleRepository owns the transaction boundary for lifecycle use cases.
type LifecycleRepository interface {
	InTransaction(ctx context.Context, operation func(context.Context, LifecycleTransaction) error) error
}

// Option configures an order lifecycle Service.
type Option func(*Service)

// WithClock makes payment-expiry decisions deterministic in unit tests.
func WithClock(clock func() time.Time) Option {
	return func(service *Service) {
		if clock != nil {
			service.clock = clock
		}
	}
}

// WithIDGenerator configures the opaque identifier source used for simulator
// payment references.
func WithIDGenerator(generator func(prefix string) string) Option {
	return func(service *Service) {
		if generator != nil {
			service.newID = generator
		}
	}
}

// WithSellerSLA configures the seller deadline applied to Shopee-like payments.
func WithSellerSLA(duration time.Duration) Option {
	return func(service *Service) {
		if duration > 0 {
			service.sellerSLA = duration
		}
	}
}

// Service owns canonical order transition and cancellation decisions.
type Service struct {
	repository LifecycleRepository
	clock      func() time.Time
	newID      func(prefix string) string
	sellerSLA  time.Duration
}

// NewService constructs an order lifecycle service with safe defaults.
func NewService(repository LifecycleRepository, options ...Option) *Service {
	service := &Service{
		repository: repository,
		clock:      time.Now,
		newID:      func(string) string { return "simulator" },
		sellerSLA:  24 * time.Hour,
	}
	for _, option := range options {
		option(service)
	}
	return service
}

// Transition advances one order along the canonical lifecycle, commits
// inventory after payment, and emits a durable event in the same transaction.
func (s *Service) Transition(ctx context.Context, shopID, orderID, target, cancellationReason string) error {
	return s.repository.InTransaction(ctx, func(ctx context.Context, tx LifecycleTransaction) error {
		state, err := tx.LockOrder(ctx, shopID, orderID)
		if err != nil {
			return err
		}
		if !CanTransition(state.Status, target) {
			return fmt.Errorf("%w: cannot transition from %s to %s", ErrInvalidTransition, state.Status, target)
		}
		if target == Paid && (state.PaymentStatus != "PENDING" || state.PaymentExpires != nil && s.clock().After(*state.PaymentExpires)) {
			return fmt.Errorf("%w: payment is no longer pending", ErrInvalidTransition)
		}
		update := TransitionUpdate{Target: target}
		if target == Paid {
			rawID := strings.ToUpper(s.newID(""))
			if len(rawID) == 0 {
				return fmt.Errorf("generate payment reference: empty identifier")
			}
			update.PaymentReference = "SIM-PAY-" + rawID[1:]
			if NormaliseProvider(state.Provider) == ShopeeLike {
				update.SellerSLA = s.sellerSLA
			}
		}
		if err := tx.UpdateOrder(ctx, orderID, update); err != nil {
			return fmt.Errorf("update order transition: %w", err)
		}
		if target == Paid {
			if err := tx.CommitInventory(ctx, orderID); err != nil {
				return fmt.Errorf("commit inventory reservation: %w", err)
			}
		}
		payload := map[string]any{"id": orderID, "status": target}
		if update.PaymentReference != "" {
			payload["payment"] = map[string]any{"status": "PAID", "reference": update.PaymentReference}
		}
		if cancellationReason != "" {
			payload["cancellation_reason"] = cancellationReason
		}
		if err := tx.RecordEvent(ctx, shopID, "order."+strings.ToLower(target), orderID, payload); err != nil {
			return fmt.Errorf("record lifecycle event: %w", err)
		}
		return nil
	})
}

// Cancel validates provider rules, releases the reservation, and records the
// durable cancellation event atomically.
func (s *Service) Cancel(ctx context.Context, shopID, orderID, actor, reason string) error {
	if !ValidCancellationReason(actor, reason) {
		return fmt.Errorf("%w: invalid cancellation reason", ErrInvalidTransition)
	}
	return s.repository.InTransaction(ctx, func(ctx context.Context, tx LifecycleTransaction) error {
		state, err := tx.LockOrder(ctx, shopID, orderID)
		if err != nil {
			return err
		}
		if !CanCancel(state.Provider, state.Status, actor) {
			return fmt.Errorf("%w: %s cannot cancel %s order from %s", ErrInvalidTransition, actor, state.Provider, state.Status)
		}
		update := TransitionUpdate{Target: Cancelled, CancellationActor: actor, CancellationReason: reason}
		if err := tx.UpdateOrder(ctx, orderID, update); err != nil {
			return fmt.Errorf("cancel order: %w", err)
		}
		if err := tx.ReleaseInventory(ctx, orderID); err != nil {
			return fmt.Errorf("release inventory reservation: %w", err)
		}
		payload := map[string]any{"id": orderID, "status": Cancelled, "cancellation_actor": actor, "cancellation_reason": reason}
		if err := tx.RecordEvent(ctx, shopID, "order.cancelled", orderID, payload); err != nil {
			return fmt.Errorf("record cancellation event: %w", err)
		}
		return nil
	})
}
