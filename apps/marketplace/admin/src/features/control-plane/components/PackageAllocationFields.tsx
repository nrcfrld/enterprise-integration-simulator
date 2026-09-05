import { useEffect, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ListResponse, ResourceRecord } from "@/shared/types/controlPlane";
import type { DetailData } from "./details/types";

export interface PackageLine { order_item_id: string; quantity: number }
export function PackageAllocationFields({ shopID, token, onChange }: { shopID: string; token: string | null | undefined; onChange: (orderID: string, items: PackageLine[]) => void }) {
  const [orders, setOrders] = useState<ResourceRecord[]>([]);
  const [orderID, setOrderID] = useState("");
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setDetail(null);
    const load = async () => {
      if (orderID) {
        const result = await controlPlaneRequest<DetailData>(`/control/v1/orders/${orderID}`, token);
        if (active) setDetail(result);
      } else {
        const all: ResourceRecord[] = [];
        for (let page = 1; ; page++) {
          const result = await controlPlaneRequest<ListResponse<ResourceRecord>>(`/control/v1/shops/${shopID}/orders?page=${page}&limit=100`, token);
          if (!active) return;
          all.push(...result.data.filter(order => order.status === "READY_TO_SHIP"));
          if (!result.pagination || page >= result.pagination.total_pages) break;
        }
        if (active) setOrders(all);
      }
    };
    void load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load allocation choices"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderID, retry, shopID, token]);
  const selectOrder = (id: string) => { setOrderID(id); setQuantities({}); setDetail(null); onChange(id, []); };
  return <fieldset>
    <legend>Allocate order quantities to a package</legend>
    <p>Only READY_TO_SHIP orders can be allocated. Every package uses the order’s single warehouse. Set quantities above zero for the lines to include.</p>
    <label>Order<select required value={orderID} onChange={event => selectOrder(event.target.value)}><option value="">Select a ready-to-ship order</option>{orders.map(order => <option key={order.id} value={order.id}>{String(order.order_number || order.id)} · {order.id}</option>)}</select></label>
    {loading && <p role="status">Loading allocation choices…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry allocation choices</button></p>}
    {!loading && !error && !orderID && !orders.length && <p>No eligible orders. Verify payment and move an order to READY_TO_SHIP first.</p>}
    {detail && <>
      <p>Warehouse: {detail.fulfillment?.warehouse_name} · {detail.fulfillment?.warehouse_code}</p>
      {detail.items?.map(item => <label key={item.id}>Quantity for {item.product_name} ({item.sku})<small>Order item ID: {item.id} · Ordered: {item.quantity} · Allocated: {item.allocated_quantity} · Remaining: {item.remaining_quantity}</small><input type="number" min={0} max={item.remaining_quantity ?? 0} step={1} disabled={!item.id || !item.remaining_quantity} value={quantities[item.id || ""] ?? 0} onChange={event => {
        const next = { ...quantities, [item.id!]: Number(event.target.value) };
        setQuantities(next);
        onChange(orderID, Object.entries(next).filter(([, quantity]) => quantity > 0).map(([order_item_id, quantity]) => ({ order_item_id, quantity })));
      }} /></label>)}
      {!detail.items?.some(item => (item.remaining_quantity ?? 0) > 0) && <p>All items are allocated. Open an existing package and use its package_id to create a shipment.</p>}
    </>}
  </fieldset>;
}
