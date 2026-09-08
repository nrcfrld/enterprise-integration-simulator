import { EventTrail } from "./EventTrail";
import { RelatedResource } from "./RelatedResource";
import type { DetailContentProps } from "./types";

export function ProductDetail(props: DetailContentProps) {
  const { data, onOpen } = props;
  return <>
    <p>Status: <b>{data.status}</b> · Available stock: <b>{data.stock ?? 0}</b></p>
    <h3>{data.name || "Unnamed product"}</h3>
    <p>{data.sku || "No SKU"} · {data.category || "Uncategorised"}</p>
    <p>{data.description || "No description supplied."}</p>
    <p>Price: {data.price ?? 0} in the configured minor currency unit.</p>
    <h3>Inventory by warehouse</h3>
    <p>Available = on hand − reserved. Product stock includes all warehouses; only ACTIVE warehouses can receive new orders. One warehouse must have enough available stock for every order line. Larger priority wins; ties use warehouse code alphabetically.</p>
    <p>Open a warehouse below to replace its on-hand count. Order creation reserves stock; cancellation or payment expiry releases it. Shipping a package reduces both on hand and reserved, without reducing available twice.</p>
    {data.warehouse_inventory?.length ? <div className="table-wrap"><table className="records-table"><thead><tr><th>Warehouse</th><th>Status</th><th>Priority</th><th>On hand</th><th>Reserved</th><th>Available</th></tr></thead><tbody>{data.warehouse_inventory.map(item => <tr key={item.warehouse_id}><td><RelatedResource type="warehouse" id={item.warehouse_id} label={`${item.name} · ${item.code}`} onOpen={onOpen} /></td><td>{item.status}</td><td>{item.priority}</td><td>{item.on_hand_quantity}</td><td>{item.reserved_quantity}</td><td>{item.available_quantity}</td></tr>)}</tbody></table></div> : <p>No warehouse inventory available. Open Warehouses &amp; Inventory to add stock.</p>}
    <EventTrail {...props} title="Product events" />
  </>;
}
