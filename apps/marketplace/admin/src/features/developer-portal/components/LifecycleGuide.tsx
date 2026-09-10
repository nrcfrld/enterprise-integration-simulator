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
  return <section className="guide-overview lifecycle-guide" aria-label="Order lifecycle and actors">
    <header className="guide-heading">
      <h2>Understand the order lifecycle</h2>
      <p>Shopee uses canonical status names. Tokopedia maps several statuses into provider-specific values. Check the current order and shipment before choosing an action.</p>
    </header>
    <ol className="lifecycle-path" aria-label="Typical successful order lifecycle">
      <li><b>UNPAID</b><small>Payment pending</small></li>
      <li><b>PAID</b><small>Merchant can process</small></li>
      <li><b>PROCESSING</b><small>Prepare the order</small></li>
      <li><b>READY_TO_SHIP</b><small>Package and ship</small></li>
      <li><b>SHIPPED</b><small>Carrier movement</small></li>
      <li><b>COMPLETED</b><small>Terminal success</small></li>
    </ol>
    <div className="guide-disclosures">
      <details>
        <summary><span>Provider status map</span><small>Canonical, Shopee-like, and Tokopedia-like states</small></summary>
        <div className="guide-details__content">
          <p>Pack means seller processing; handover means ready for collection. Neither action creates a physical shipment.</p>
          <div className="reference-table-wrap"><table className="reference-table"><caption>Canonical / Shopee → Tokopedia status and next step</caption><thead><tr><th>Canonical / Shopee</th><th>Tokopedia API</th><th>Actor and prerequisite</th></tr></thead><tbody>{mappings.map(([canonical, provider, next]) => <tr key={canonical}><td>{canonical}</td><td>{provider}</td><td>{next}</td></tr>)}</tbody></table></div>
          <p>IN_TRANSIT represents both SHIPPED and IN_DELIVERY; CANCEL represents both CANCELLED and RETURNED. Fetch order and shipment details before choosing a next action.</p>
        </div>
      </details>
      <details>
        <summary><span>Payment and cancellation rules</span><small>Actors, prerequisites, expiry, and released reservations</small></summary>
        <div className="guide-details__content">
          <h3>Payment is a separate state</h3>
          <p>Admin uses <code>operations.payment_status</code>: PENDING, PAID, FAILED, or EXPIRED. The legacy <code>payment.status</code> only indicates whether <code>paid_at</code> exists. Failure or expiry cancels the order and releases reservations.</p>
          <h3>Cancellation actors</h3>
          <p>Shopee CUSTOMER cancellation is allowed in UNPAID or PAID; SELLER cancellation in PAID or PROCESSING. Tokopedia CUSTOMER/SELLER cancellation is allowed through READY_TO_SHIP. Public cancel endpoints model CUSTOMER cancellation; Admin can explicitly select customer or seller reasons.</p>
          <p>SYSTEM cancellation comes from simulated payment failure or deadline workers. Deadlines are checked asynchronously, and an expired payment cannot succeed before the worker updates the order.</p>
        </div>
      </details>
      <details>
        <summary><span>Webhook status vocabulary</span><small>Why event status may differ from current API state</small></summary>
        <div className="guide-details__content">
          <p>Tokopedia’s numeric type describes the event category, not the order status. A webhook’s SHIPPED or IN_DELIVERY therefore differs from the API’s IN_TRANSIT.</p>
          <p>Verify and durably deduplicate the event, then fetch current provider state. Delayed events may describe an older state.</p>
        </div>
      </details>
    </div>
  </section>;
}
