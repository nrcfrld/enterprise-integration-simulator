const mappings = [
  ["UNPAID", "UNPAID", "Payment pending; simulate payment or failure. Expiry is handled by the worker."],
  ["PAID", "ON_HOLD", "Merchant: Shopee ship-order / Tokopedia pack → PROCESSING."],
  ["PROCESSING", "AWAITING_SHIPMENT", "Merchant: Shopee ready-to-ship / Tokopedia handover → READY_TO_SHIP."],
  ["READY_TO_SHIP", "AWAITING_COLLECTION", "Allocate packages and create shipments through the API before carrier movement."],
  ["SHIPPED", "IN_TRANSIT", "Carrier simulation: ship → in_delivery on each shipment."],
  ["IN_DELIVERY", "IN_TRANSIT", "Carrier simulation: deliver or report failure; a failed shipment may return to sender."],
  ["DELIVERED", "DELIVERED", "Simulate customer confirmation → COMPLETED."],
  ["COMPLETED", "COMPLETED", "Terminal. No more order transitions."],
  ["CANCELLED", "CANCEL", "Terminal. Remaining reservations released."],
  ["RETURNED", "CANCEL", "Terminal return outcome; inspect shipment return history, not a pre-shipment cancellation."],
];

export function LifecycleGuide() {
  return <section aria-label="Order lifecycle and actors">
    <h2>Who changes an order, and what each status means</h2>
    <p>Admin displays canonical order status. Shopee order_status uses that same vocabulary. Tokopedia order_status maps it as shown below. Pack means seller processing; handover means ready for collection. Neither action creates a physical shipment.</p>
    <div className="reference-table-wrap"><table className="reference-table"><caption>Canonical / Shopee → Tokopedia status and next step</caption><thead><tr><th>Canonical / Shopee</th><th>Tokopedia API</th><th>Actor and prerequisite</th></tr></thead><tbody>{mappings.map(([canonical, provider, next]) => <tr key={canonical}><td>{canonical}</td><td>{provider}</td><td>{next}</td></tr>)}</tbody></table></div>
    <p>IN_TRANSIT represents both SHIPPED and IN_DELIVERY; CANCEL represents both CANCELLED and RETURNED. Do not infer a single canonical state from these many-to-one values. Fetch order and shipment details before choosing a next action.</p>
    <h3>Payment is a separate state</h3>
    <p>Admin uses operations.payment_status: PENDING, PAID, FAILED or EXPIRED. The legacy payment.status field only indicates whether paid_at exists (UNPAID / PAID); it cannot distinguish failure from expiry. Payment failure or expiry cancels the order and releases reservations. Payment commits a reservation; shipment movement consumes physical stock.</p>
    <h3>Cancellation actors</h3>
    <p>Shopee CUSTOMER cancellation is allowed in UNPAID or PAID; SELLER cancellation in PAID or PROCESSING. Tokopedia CUSTOMER/SELLER cancellation is allowed before shipment, through READY_TO_SHIP. Both public cancel endpoints model CUSTOMER cancellation with CHANGE_OF_MIND, DUPLICATE_ORDER or ADDRESS_ISSUE. Admin explicitly selects customer or seller; seller reasons are OUT_OF_STOCK or SELLER_UNFULFILLABLE.</p>
    <p>SYSTEM cancellation is produced by simulated payment failure or the payment/seller deadline worker. A Shopee seller deadline applies after payment and while PAID or PROCESSING. Deadlines are checked asynchronously; an expired payment cannot succeed even before the worker updates the order.</p>
    <h3>Webhook vocabulary</h3>
    <p>Shopee response.data and Tokopedia data retain canonical payload fields and statuses when present. Tokopedia’s numeric type describes the event category, not the order status. A webhook’s SHIPPED or IN_DELIVERY therefore differs from the API’s IN_TRANSIT. Verify and durably deduplicate the event, then fetch current provider state; delayed events may describe an older state.</p>
  </section>;
}
