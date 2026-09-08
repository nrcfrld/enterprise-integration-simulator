package orders

import (
	"reflect"
	"testing"
	"time"
)

func TestConsoleActionsFollowLifecycleAndCancellationPolicy(t *testing.T) {
	now := time.Now()
	expired := now.Add(-time.Second)
	for _, provider := range []string{ShopeeLike, TokopediaLike} {
		for _, status := range []string{Unpaid, Paid, Processing, ReadyToShip, Shipped, InDelivery, Delivered, Completed, Cancelled, Returned} {
			t.Run(provider+"/"+status, func(t *testing.T) {
				payment := "PAID"
				if status == Unpaid {
					payment = "PENDING"
				}
				actions, cancellations := ConsoleActions(LifecycleState{Status: status, Provider: provider, PaymentStatus: payment}, now)
				expected := map[string][]string{Unpaid: {"pay", "payment_failed"}, Paid: {"process"}, Processing: {"ready_to_ship"}, Delivered: {"complete"}}[status]
				if expected == nil {
					expected = []string{}
				}
				if !reflect.DeepEqual(actions, expected) {
					t.Fatalf("actions=%v, expected=%v", actions, expected)
				}
				for _, actor := range []string{Customer, Seller} {
					found := false
					for _, option := range cancellations {
						if option.Actor == actor {
							found = true
							for _, reason := range option.Reasons {
								if !ValidCancellationReason(actor, reason) {
									t.Fatalf("invalid reason %s %s", actor, reason)
								}
							}
						}
					}
					if found != CanCancel(provider, status, actor) {
						t.Fatalf("actor eligibility mismatch: %s", actor)
					}
				}
			})
		}
	}
	for _, payment := range []string{"PENDING", "FAILED", "EXPIRED"} {
		actions, _ := ConsoleActions(LifecycleState{Status: Unpaid, Provider: ShopeeLike, PaymentStatus: payment, PaymentExpires: &expired}, now)
		for _, action := range actions {
			if action == "pay" {
				t.Fatal("expired or failed payment offered as payable")
			}
		}
	}
}
