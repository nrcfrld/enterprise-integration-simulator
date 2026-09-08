package orders

import "time"

// CancellationOption describes the actors and reasons currently permitted by
// the domain policy. System cancellations remain payment/deadline simulations.
type CancellationOption struct {
	Actor   string   `json:"actor"`
	Reasons []string `json:"reasons"`
}

// ConsoleActions projects the authoritative lifecycle rules into discoverable
// control-plane actions. Handlers still revalidate under the transaction lock.
func ConsoleActions(state LifecycleState, now time.Time) ([]string, []CancellationOption) {
	actions := make([]string, 0, 5)
	if CanTransition(state.Status, Paid) && state.PaymentStatus == "PENDING" && (state.PaymentExpires == nil || !now.After(*state.PaymentExpires)) {
		actions = append(actions, "pay")
	}
	if state.Status == Unpaid && state.PaymentStatus == "PENDING" {
		actions = append(actions, "payment_failed")
	}
	for _, candidate := range []struct{ action, target string }{{"process", Processing}, {"ready_to_ship", ReadyToShip}, {"complete", Completed}} {
		if CanTransition(state.Status, candidate.target) {
			actions = append(actions, candidate.action)
		}
	}
	cancellations := make([]CancellationOption, 0, 2)
	for _, actor := range []string{Customer, Seller} {
		if !CanCancel(state.Provider, state.Status, actor) {
			continue
		}
		reasons := make([]string, 0, 3)
		for _, reason := range []string{"CHANGE_OF_MIND", "DUPLICATE_ORDER", "ADDRESS_ISSUE", "OUT_OF_STOCK", "SELLER_UNFULFILLABLE"} {
			if ValidCancellationReason(actor, reason) {
				reasons = append(reasons, reason)
			}
		}
		cancellations = append(cancellations, CancellationOption{Actor: actor, Reasons: reasons})
	}
	return actions, cancellations
}
