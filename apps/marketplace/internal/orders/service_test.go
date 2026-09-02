package orders

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeLifecycleRepository struct {
	state   LifecycleState
	err     error
	update  *TransitionUpdate
	events  []string
	commit  bool
	release bool
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
	return t.repository.state, nil
}

func (t fakeLifecycleTransaction) UpdateOrder(_ context.Context, _ string, update TransitionUpdate) error {
	t.repository.update = &update
	return nil
}

func (t fakeLifecycleTransaction) CommitInventory(context.Context, string) error {
	t.repository.commit = true
	return nil
}

func (t fakeLifecycleTransaction) ReleaseInventory(context.Context, string) error {
	t.repository.release = true
	return nil
}

func (t fakeLifecycleTransaction) RecordEvent(_ context.Context, _ string, eventType, _ string, _ map[string]any) error {
	t.repository.events = append(t.repository.events, eventType)
	return nil
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

func timePointer(value time.Time) *time.Time {
	return &value
}
