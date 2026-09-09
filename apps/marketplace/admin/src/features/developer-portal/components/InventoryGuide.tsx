export function InventoryGuide() {
  return <section>
    <h2>Inventory and warehouse allocation</h2>
    <p>Manage physical counts in Warehouses &amp; Inventory → View inventory. Product detail links to each warehouse. Product stock is aggregate available inventory across warehouses, including inactive warehouses; it does not guarantee that an order can be allocated.</p>
    <p><b>Available = on hand − reserved.</b> Creating an order reserves units at one warehouse: on hand stays the same, reserved rises, and available falls. Payment keeps the reservation. Cancellation or payment expiry releases unshipped reservations. Marking a package’s shipment SHIPPED reduces both on hand and reserved, so available does not fall a second time.</p>
    <p>The allocator selects the ACTIVE warehouse with the largest priority that can fulfill every order line. Ties use warehouse code alphabetically. It cannot combine stock from multiple warehouses for one order.</p>
    <h3>Worked example</h3>
    <p>Warehouse A (priority 20) has 5 mugs and 0 plates available; B (priority 10) has 2 mugs and 3 plates. An order for 2 mugs and 1 plate selects B, because A cannot supply the plate. An order for 4 mugs and 1 plate fails even though aggregate stock is 7 mugs and 3 plates: no single warehouse has both quantities.</p>
    <p>With 10 on hand and 2 reserved, available is 8. Saving on hand as 15 replaces the physical count and makes 13 available. It does not add 15. Never enter a count below reserved units. Return-to-sender completion does not automatically restock physical inventory; inspect the returned goods, then adjust the warehouse count.</p>
    <p>Public warehouse APIs are read-only. List warehouses, copy a returned warehouse ID, then inspect its on_hand_quantity, reserved_quantity, and available_quantity in the request simulator.</p>
    <p>The Admin inventory editor checks the loaded inventory version when saving. If a shipment changes stock before Save, the server returns 409 INVENTORY_CONFLICT and the editor reloads while keeping your unsaved count. Use latest count, review what changed, then re-enter your adjustment. This is separate from public API authentication and request idempotency.</p>
  </section>;
}
