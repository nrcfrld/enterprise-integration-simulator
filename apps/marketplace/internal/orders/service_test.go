package orders

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeLifecycleRepository struct {
	state       LifecycleState
	err         error
	lockErr     error
	updateErr   error
	commitErr   error
	releaseErr  error
	eventErrors map[string]error
	update      *TransitionUpdate
	events      []string
	commit      bool
	release     bool
}

func (r *fakeLifecycleRepository) InTransaction(ctx context.Context, operation func(context.Context, LifecycleTransaction) error) error {
	if r.err != nil {
		return r.err
	}
	return operation(ctx, fakeLifecycleTransaction{repository: r})
}

type fakeLifecycleTransaction struct {
	repository *fakeLifecycleRepository
}

func (t fakeLifecycleTransaction) LockOrder(context.Context, string, string) (LifecycleState, error) {
	return t.repository.state, t.repository.lockErr
}

func (t fakeLifecycleTransaction) UpdateOrder(_ context.Context, _ string, update TransitionUpdate) error {
	if t.repository.updateErr != nil {
		return t.repository.updateErr
	}
	t.repository.update = &update
	return nil
}

func (t fakeLifecycleTransaction) CommitInventory(context.Context, string) error {
	if t.repository.commitErr != nil {
		return t.repository.commitErr
	}
	t.repository.commit = true
	return nil
}

func (t fakeLifecycleTransaction) ReleaseInventory(context.Context, string) error {
	if t.repository.releaseErr != nil {
		return t.repository.releaseErr
	}
	t.repository.release = true
	return nil
}

func (t fakeLifecycleTransaction) RecordEvent(_ context.Context, _ string, eventType, _ string, _ map[string]any) error {
	if err := t.repository.eventErrors[eventType]; err != nil {
		return err
	}
	t.repository.events = append(t.repository.events, eventType)
	return nil
}

func TestServiceTransitionFailures(t *testing.T) {
	t.Parallel()
	dependencyErr := errors.New("dependency failed")
	tests := []struct {
		name       string
		repository *fakeLifecycleRepository
		target     string
		newID      func(string) string
		wantErr    error
	}{
		{name: "transaction fails", repository: &fakeLifecycleRepository{err: dependencyErr}, target: Processing, wantErr: dependencyErr},
		{name: "order lock fails", repository: &fakeLifecycleRepository{lockErr: dependencyErr}, target: Processing, wantErr: dependencyErr},
		{name: "payment identifier is empty", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING"}}, target: Paid, newID: func(string) string { return "" }},
		{name: "update fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Paid}, updateErr: dependencyErr}, target: Processing, wantErr: dependencyErr},
		{name: "inventory commit fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING"}, commitErr: dependencyErr}, target: Paid, wantErr: dependencyErr},
		{name: "event persistence fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Paid}, eventErrors: map[string]error{"order.processing": dependencyErr}}, target: Processing, wantErr: dependencyErr},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			newID := test.newID
			if newID == nil {
				newID = func(string) string { return "id_payment" }
			}
			err := NewService(test.repository, WithIDGenerator(newID)).Transition(context.Background(), "shop_1", "ord_1", test.target, "manual")
			if test.name == "payment identifier is empty" {
				if err == nil || err.Error() != "generate payment reference: empty identifier" {
					t.Fatalf("Transition() error = %v", err)
				}
				return
			}
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Transition() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestServiceTransition(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.September, 2, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		state   LifecycleState
		target  string
		wantErr error
		commit  bool
		event   string
	}{
		{name: "paid order enters seller processing", state: LifecycleState{Status: Paid, Provider: ShopeeLike}, target: Processing, event: "order.processing"},
		{name: "pending payment commits inventory and creates reference", state: LifecycleState{Status: Unpaid, Provider: ShopeeLike, PaymentStatus: "PENDING"}, target: Paid, commit: true, event: "order.paid"},
		{name: "expired payment is rejected", state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING", PaymentExpires: timePointer(now.Add(-time.Second))}, target: Paid, wantErr: ErrInvalidTransition},
		{name: "invalid state is rejected", state: LifecycleState{Status: Unpaid}, target: Processing, wantErr: ErrInvalidTransition},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			repository := &fakeLifecycleRepository{state: test.state}
			service := NewService(repository, WithClock(func() time.Time { return now }), WithIDGenerator(func(string) string { return "id_payment" }), WithSellerSLA(time.Hour))
			err := service.Transition(context.Background(), "shop_1", "ord_1", test.target, "")
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Transition() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr != nil {
				return
			}
			if repository.commit != test.commit {
				t.Fatalf("inventory commit = %t, want %t", repository.commit, test.commit)
			}
			if repository.update == nil || repository.update.Target != test.target {
				t.Fatalf("update = %#v, want target %s", repository.update, test.target)
			}
			if got := repository.events; len(got) != 1 || got[0] != test.event {
				t.Fatalf("events = %#v, want %s", got, test.event)
			}
		})
	}
}

func TestServiceCancel(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		state   LifecycleState
		actor   string
		reason  string
		wantErr error
	}{
		{name: "customer cancels unpaid Shopee order", state: LifecycleState{Status: Unpaid, Provider: ShopeeLike}, actor: Customer, reason: "CHANGE_OF_MIND"},
		{name: "customer cannot cancel shipped Shopee order", state: LifecycleState{Status: Shipped, Provider: ShopeeLike}, actor: Customer, reason: "CHANGE_OF_MIND", wantErr: ErrInvalidTransition},
		{name: "reason must match actor", state: LifecycleState{Status: Paid, Provider: ShopeeLike}, actor: Customer, reason: "OUT_OF_STOCK", wantErr: ErrInvalidTransition},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			repository := &fakeLifecycleRepository{state: test.state}
			service := NewService(repository)
			err := service.Cancel(context.Background(), "shop_1", "ord_1", test.actor, test.reason)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Cancel() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr != nil {
				return
			}
			if !repository.release || repository.update == nil || repository.update.Target != Cancelled {
				t.Fatalf("cancel persistence = release:%t update:%#v", repository.release, repository.update)
			}
			if got := repository.events; len(got) != 1 || got[0] != "order.cancelled" {
				t.Fatalf("events = %#v, want order.cancelled", got)
			}
		})
	}
}

func TestServiceCancelPersistenceFailures(t *testing.T) {
	t.Parallel()
	dependencyErr := errors.New("dependency failed")
	tests := []struct {
		name       string
		repository *fakeLifecycleRepository
	}{
		{name: "transaction fails", repository: &fakeLifecycleRepository{err: dependencyErr}},
		{name: "order lock fails", repository: &fakeLifecycleRepository{lockErr: dependencyErr}},
		{name: "update fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Paid, Provider: ShopeeLike}, updateErr: dependencyErr}},
		{name: "inventory release fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Paid, Provider: ShopeeLike}, releaseErr: dependencyErr}},
		{name: "event persistence fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Paid, Provider: ShopeeLike}, eventErrors: map[string]error{"order.cancelled": dependencyErr}}},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := NewService(test.repository).Cancel(context.Background(), "shop_1", "ord_1", Customer, "CHANGE_OF_MIND")
			if !errors.Is(err, dependencyErr) {
				t.Fatalf("Cancel() error = %v, want %v", err, dependencyErr)
			}
		})
	}
}

func TestServiceCancelOverdueRevalidatesLockedState(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.September, 3, 1, 0, 0, 0, time.UTC)
	tests := []struct {
		name          string
		state         LifecycleState
		reason        string
		wantErr       error
		paymentStatus string
	}{
		{name: "expired pending payment", state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING", PaymentExpires: timePointer(now.Add(-time.Second))}, reason: PaymentExpiredReason, paymentStatus: "EXPIRED"},
		{name: "future payment remains active", state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING", PaymentExpires: timePointer(now.Add(time.Second))}, reason: PaymentExpiredReason, wantErr: ErrDeadlineNotEligible},
		{name: "stale seller candidate already ready to ship", state: LifecycleState{Status: ReadyToShip, PaymentStatus: "PAID", SellerDeadline: timePointer(now.Add(-time.Second))}, reason: SellerSLAExpiredReason, wantErr: ErrDeadlineNotEligible},
		{name: "overdue processing seller", state: LifecycleState{Status: Processing, PaymentStatus: "PAID", SellerDeadline: timePointer(now.Add(-time.Second))}, reason: SellerSLAExpiredReason},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			repository := &fakeLifecycleRepository{state: test.state}
			service := NewService(repository, WithClock(func() time.Time { return now }))
			err := service.CancelOverdue(context.Background(), "shop_1", "ord_1", test.reason)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("CancelOverdue() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr != nil {
				if repository.update != nil || repository.release {
					t.Fatalf("stale candidate mutated state: update=%#v release=%t", repository.update, repository.release)
				}
				return
			}
			if repository.update == nil || repository.update.Target != Cancelled || repository.update.PaymentStatus != test.paymentStatus || !repository.release {
				t.Fatalf("deadline persistence = update:%#v release:%t", repository.update, repository.release)
			}
			if got := repository.events; len(got) != 2 || got[1] != "order.cancelled" {
				t.Fatalf("deadline events = %#v", got)
			}
		})
	}
}

func TestServiceCancelOverdueFailures(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.September, 3, 1, 0, 0, 0, time.UTC)
	expired := timePointer(now.Add(-time.Second))
	dependencyErr := errors.New("dependency failed")
	tests := []struct {
		name       string
		repository *fakeLifecycleRepository
		reason     string
		wantErr    error
	}{
		{name: "transaction fails", repository: &fakeLifecycleRepository{err: dependencyErr}, reason: PaymentExpiredReason, wantErr: dependencyErr},
		{name: "order lock fails", repository: &fakeLifecycleRepository{lockErr: dependencyErr}, reason: PaymentExpiredReason, wantErr: dependencyErr},
		{name: "unknown deadline reason", repository: &fakeLifecycleRepository{}, reason: "UNKNOWN", wantErr: ErrDeadlineNotEligible},
		{name: "missing payment deadline", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING"}}, reason: PaymentExpiredReason, wantErr: ErrDeadlineNotEligible},
		{name: "missing seller deadline", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Paid}}, reason: SellerSLAExpiredReason, wantErr: ErrDeadlineNotEligible},
		{name: "update fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING", PaymentExpires: expired}, updateErr: dependencyErr}, reason: PaymentExpiredReason, wantErr: dependencyErr},
		{name: "inventory release fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING", PaymentExpires: expired}, releaseErr: dependencyErr}, reason: PaymentExpiredReason, wantErr: dependencyErr},
		{name: "deadline event fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING", PaymentExpires: expired}, eventErrors: map[string]error{"order.payment_expired": dependencyErr}}, reason: PaymentExpiredReason, wantErr: dependencyErr},
		{name: "cancellation event fails", repository: &fakeLifecycleRepository{state: LifecycleState{Status: Unpaid, PaymentStatus: "PENDING", PaymentExpires: expired}, eventErrors: map[string]error{"order.cancelled": dependencyErr}}, reason: PaymentExpiredReason, wantErr: dependencyErr},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := NewService(test.repository, WithClock(func() time.Time { return now })).CancelOverdue(context.Background(), "shop_1", "ord_1", test.reason)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("CancelOverdue() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func timePointer(value time.Time) *time.Time {
	return &value
}
