// Package orders owns order lifecycle invariants.
package orders

const (
	Unpaid      = "UNPAID"
	Paid        = "PAID"
	Processing  = "PROCESSING"
	ReadyToShip = "READY_TO_SHIP"
	Shipped     = "SHIPPED"
	InDelivery  = "IN_DELIVERY"
	Delivered   = "DELIVERED"
	Completed   = "COMPLETED"
	Cancelled   = "CANCELLED"
	Returned    = "RETURNED"
)

// transitions is the single authoritative order state machine. Transport
// handlers may choose who is allowed to request a transition, but they must
// never implement their own lifecycle rules.
var transitions = map[string]map[string]bool{
	Unpaid:      {Paid: true, Cancelled: true},
	Paid:        {Processing: true, Cancelled: true},
	Processing:  {ReadyToShip: true, Cancelled: true},
	ReadyToShip: {Shipped: true, Cancelled: true},
	Shipped:     {InDelivery: true},
	InDelivery:  {Delivered: true, Returned: true},
	Delivered:   {Completed: true},
}

// CanTransition reports whether an order lifecycle change is valid.
func CanTransition(from, to string) bool { return transitions[from][to] }
