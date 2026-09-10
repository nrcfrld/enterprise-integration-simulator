export function FulfillmentGuide() {
  return <details className="guide-details fulfillment-guide">
    <summary><span>Package and shipment workflow<small>Six steps from order lines to carrier movement</small></span></summary>
    <div className="guide-details__content">
      <p>An order reserves inventory at one warehouse. Packages allocate line quantities; shipments add tracking and pickup. Splitting packages does not split the order across warehouses.</p>
      <ol>
        <li>Read order detail. Use each line ID as <code>order_item_id</code>; allocated and remaining quantities show what is available to package.</li>
        <li>Verify payment. Shopee: process, then ready-to-ship. Tokopedia: pack, then handover.</li>
        <li>Allocate quantities through Shopee’s package API or Admin Packages. Tokopedia explicit allocations use Admin Packages.</li>
        <li>To ship an existing package, send its <code>package_id</code>, <code>shipping_provider</code>, and <code>pickup_type</code>.</li>
        <li>Create one shipment per package. Omit <code>package_id</code> only to package all remaining quantities automatically.</li>
        <li>Inspect packages and shipments in Admin Order Detail, then progress each shipment separately.</li>
      </ol>
      <p>Existing-package request: <code>{'{"package_id":"pkg_example_01","shipping_provider":"provider_express","pickup_type":"PICKUP"}'}</code></p>
    </div>
  </details>;
}
