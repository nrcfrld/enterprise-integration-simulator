import { RelatedResource } from "./RelatedResource";
import { ShipmentActions } from "./ShipmentActions";
import type { DetailContentProps, ShipmentSummary } from "./types";

export function OrderFulfillment(props: DetailContentProps) {
  const { data, onOpen } = props;
  const packages = data.packages ?? [];
  const shipments = data.shipments ?? (data.shipment ? [data.shipment] : []);
  const shipmentView = (shipment: ShipmentSummary) => <div key={shipment.id} className="timeline" role="group" aria-label={`Shipment ${shipment.tracking_number || shipment.id}`}>
    <p><RelatedResource type="shipment" id={shipment.id} label={shipment.tracking_number || shipment.id} onOpen={onOpen} /> · {shipment.shipping_provider} · {shipment.status}</p>
    <ShipmentActions shipmentID={shipment.id} status={shipment.status} {...props} />
  </div>;
  return <section aria-label="Order fulfillment">
    <h3>Packages, shipments, and warehouse</h3>
    <p>One warehouse supplies this order. A package allocates some or all order items; its shipment carries tracking and delivery status. Multiple packages and shipments share this origin. All shipments must reach delivery before the order is delivered.</p>
    <p>Warehouse: <RelatedResource type="warehouse" id={data.fulfillment?.warehouse_id} label={[data.fulfillment?.warehouse_name, data.fulfillment?.warehouse_code].filter(Boolean).join(" · ")} onOpen={onOpen} /></p>
    <div className="reference-table-wrap"><table className="table"><caption>Order item allocation</caption><thead><tr><th>Item / order item ID</th><th>Ordered</th><th>Allocated</th><th>Remaining to allocate</th></tr></thead><tbody>{data.items?.map(item => <tr key={item.id || item.sku}><td>{item.product_name} · {item.sku}<br /><code>{item.id}</code></td><td>{item.quantity}</td><td>{item.allocated_quantity ?? "—"}</td><td>{item.remaining_quantity ?? "—"}</td></tr>)}</tbody></table></div>
    <h4>Packages ({packages.length}) · Shipments ({shipments.length})</h4>
    {packages.length ? packages.map(pkg => <section key={pkg.id}>
      <p>Package <RelatedResource type="package" id={pkg.id} onOpen={onOpen} /> · {pkg.status}</p>
      <ul>{pkg.items?.map(item => <li key={item.id || item.sku}>{item.product_name} · {item.sku} · {item.quantity} units</li>)}</ul>
      {shipments.some(shipment => shipment.package_id === pkg.id) ? shipments.filter(shipment => shipment.package_id === pkg.id).map(shipmentView) : <p>No shipment yet. Create one through the provider API using package_id: <code>{pkg.id}</code>.</p>}
    </section>) : <p>No packages allocated yet. Allocate selected quantities in Packages, or omit package_id in a shipment request to automatically package the remaining items.</p>}
    {shipments.filter(shipment => !packages.some(pkg => pkg.id === shipment.package_id)).map(shipmentView)}
  </section>;
}
