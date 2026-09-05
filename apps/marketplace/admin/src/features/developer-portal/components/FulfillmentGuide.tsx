export function FulfillmentGuide() {
  return <section className="reference-callout">
    <h3>Order → Package → Shipment, from one warehouse</h3>
    <p>An order reserves inventory at one warehouse. A package allocates order-line quantities; a shipment adds tracking and pickup for that package. Splitting an order into packages does not split it across warehouses.</p>
    <ol>
      <li>Read order detail. Shopee uses item_list; Tokopedia uses line_items. Use each line’s id as order_item_id. allocated_quantity and remaining_quantity show how much is still available to package.</li>
      <li>Verify payment in Admin. Shopee: process, then ready-to-ship. Tokopedia: pack, then handover. The canonical order is now READY_TO_SHIP (Tokopedia AWAITING_COLLECTION).</li>
      <li>Allocate selected quantities through Shopee’s package API or Admin Packages. Tokopedia has no public package-allocation endpoint; use Admin Packages for explicit allocations. You can divide a line of quantity 2 into two packages of quantity 1.</li>
      <li>Choose “Ship an existing package” and send its package_id with shipping_provider and pickup_type: PICKUP. Shopee allocation responses offer a direct shipment handoff. For Admin allocations, copy the Package ID or read package_list[].package_id from provider order detail.</li>
      <li>Create a shipment for each package before advancing shipment movement. To package all remaining quantities automatically, omit package_id instead. Omission fails when all quantities have already been allocated.</li>
      <li>Inspect all packages and shipments in Admin Order Detail, or shipment_list in provider order detail. Follow package, shipment, and warehouse links in Admin. Progress each shipment separately; delivering only the first package does not deliver the whole order.</li>
    </ol>
    <p>Existing-package request example: <code>{'{"package_id":"pkg_example_01","shipping_provider":"provider_express","pickup_type":"PICKUP"}'}</code>. Replace the example ID with a returned ID from this order.</p>
  </section>;
}
