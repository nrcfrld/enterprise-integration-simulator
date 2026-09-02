package orders

import "strings"

const (
	ShopeeLike    = "SHOPEE_LIKE"
	TokopediaLike = "TOKOPEDIA_LIKE"
	Customer      = "CUSTOMER"
	Seller        = "SELLER"
	System        = "SYSTEM"
)

// NormaliseProvider returns the default marketplace order contract for an
// omitted profile. Generic catalogue APIs remain available, but Generic is no
// longer an order-provider profile.
func NormaliseProvider(provider string) string {
	provider = strings.ToUpper(strings.TrimSpace(provider))
	if provider == "" {
		return ShopeeLike
	}
	return provider
}

// SupportsProvider reports whether a configured provider profile is known.
func SupportsProvider(provider string) bool {
	switch NormaliseProvider(provider) {
	case ShopeeLike, TokopediaLike:
		return true
	default:
		return false
	}
}

// CanCancel applies provider-specific cancellation rules. SHOPEE_LIKE
// distinguishes customer, seller, and system initiated cancellations;
// TOKOPEDIA_LIKE currently uses the canonical transition rule.
func CanCancel(provider, status, actor string) bool {
	if NormaliseProvider(provider) != ShopeeLike {
		return CanTransition(status, Cancelled)
	}
	switch strings.ToUpper(actor) {
	case Customer:
		return status == Unpaid || status == Paid
	case Seller:
		return status == Paid || status == Processing
	case System:
		return status == Unpaid || status == Paid || status == Processing
	default:
		return false
	}
}

// ValidCancellationReason keeps cancellation audit data enumerable and useful
// to external integrators rather than accepting arbitrary free text.
func ValidCancellationReason(actor, reason string) bool {
	reason = strings.ToUpper(strings.TrimSpace(reason))
	allowed := map[string]map[string]bool{
		Customer: {"CHANGE_OF_MIND": true, "DUPLICATE_ORDER": true, "ADDRESS_ISSUE": true},
		Seller:   {"OUT_OF_STOCK": true, "SELLER_UNFULFILLABLE": true},
		System:   {"PAYMENT_EXPIRED": true, "PAYMENT_FAILED": true, "SELLER_SLA_EXPIRED": true},
	}
	return allowed[strings.ToUpper(actor)][reason]
}
