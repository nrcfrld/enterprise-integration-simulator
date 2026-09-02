// Package webhooks owns webhook event contract rules.
package webhooks

var supportedEvents = map[string]bool{
	"product.created": true, "product.updated": true, "product.deleted": true,
	"order.created": true, "order.paid": true, "order.processing": true,
	"order.ready_to_ship": true, "order.shipped": true, "order.in_delivery": true,
	"order.delivered": true, "order.completed": true, "order.cancelled": true,
	"order.payment_expired": true, "order.payment_failed": true, "order.sla_expired": true,
	"shipment.delivery_failed": true, "shipment.returning": true, "shipment.returned": true,
}

// SupportsEvent reports whether an event is part of the public webhook contract.
func SupportsEvent(eventType string) bool { return supportedEvents[eventType] }
