export function InventoryGuide() {
  return <section className="guide-overview inventory-guide">
    <header className="guide-heading">
      <h2>How warehouse allocation works</h2>
      <p>An order reserves every line from one active warehouse. Product stock is an aggregate, so a high total does not guarantee that one warehouse can fulfill the order.</p>
    </header>
    <dl className="guide-facts" aria-label="Warehouse allocation summary">
      <div><dt>Available stock</dt><dd><code>on hand − reserved</code></dd></div>
      <div><dt>Warehouse selection</dt><dd>Highest priority that fits every line</dd></div>
      <div><dt>Public API</dt><dd>Read-only inventory access</dd></div>
    </dl>
    <div className="guide-disclosures">
      <details>
        <summary><span>Reservation lifecycle</span><small>What changes on order, payment, cancellation, and shipment</small></summary>
        <div className="guide-details__content">
          <p>Creating an order reserves units at one warehouse: on hand stays the same, reserved rises, and available falls. Payment keeps the reservation. Cancellation or payment expiry releases unshipped reservations.</p>
          <p>When a package shipment becomes SHIPPED, both on hand and reserved fall, so available does not fall a second time.</p>
        </div>
      </details>
      <details>
        <summary><span>Worked allocation example</span><small>Why aggregate stock can still fail</small></summary>
        <div className="guide-details__content">
          <p>Warehouse A (priority 20) has 5 mugs and no plates; B (priority 10) has 2 mugs and 3 plates. An order for 2 mugs and 1 plate selects B because A cannot supply the plate.</p>
          <p>An order for 4 mugs and 1 plate fails even though aggregate stock is 7 mugs and 3 plates: no single warehouse has both quantities. Priority ties use warehouse code alphabetically.</p>
        </div>
      </details>
      <details>
        <summary><span>Editing counts and handling returns</span><small>Replacement counts, conflicts, and restocking</small></summary>
        <div className="guide-details__content">
          <p>Saving on hand replaces the physical count; it does not add to it. With 10 on hand and 2 reserved, saving 15 makes 13 available. Never enter a count below reserved units.</p>
          <p>Return-to-sender completion does not restock inventory automatically. Inspect the goods, then adjust the warehouse count.</p>
          <p>If stock changes before Save, the Admin editor returns <code>409 INVENTORY_CONFLICT</code> and reloads while preserving the unsaved count. Review the latest value, then re-enter the adjustment.</p>
        </div>
      </details>
    </div>
  </section>;
}
