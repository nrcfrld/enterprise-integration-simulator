import { useSearchParams } from "react-router-dom";

const labels: Record<string, string> = { Deliveries: "Event ID, registration ID or endpoint", Orders: "Order ID or number", Products: "Product ID, SKU or name", Shipments: "Tracking number, shipment ID or order" };
const statuses: Record<string, string[]> = {
  Deliveries: ["PENDING", "DELIVERED", "FAILED", "CANCELLED"],
  Orders: ["UNPAID", "PAID", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "IN_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "RETURNED"],
  Products: ["ACTIVE", "INACTIVE"],
  Shipments: ["CREATED", "SHIPPED", "IN_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNING", "RETURNED"],
};
export function ResourceSearch({ page, shopID }: { page: string; shopID: string }) {
  const [params, setParams] = useSearchParams();
  const hasSearch = ["q", "status", "page"].some(key => params.has(key));
  const helpID = `resource-search-help-${page.toLowerCase()}`;
  return <form className="resource-search" key={params.toString()} onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams(params);
    next.set("shop", shopID); next.delete("page");
    for (const key of ["q", "status"]) { const value = String(values.get(key) || "").trim(); if (value) next.set(key, value); else next.delete(key); }
    setParams(next);
  }}>
    <div className="resource-search-fields">
      <label><span>{labels[page]}</span><input aria-describedby={helpID} type="search" name="q" defaultValue={params.get("q") || ""} placeholder="Search by ID or name" /></label>
      <label><span>Status</span><select name="status" defaultValue={params.get("status") || ""}><option value="">All statuses</option>{statuses[page].map(status => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
    </div>
    <div className="resource-search-actions">
      <button className="btn btn-primary" type="submit">Search</button>
      <button className="btn btn-ghost" type="button" disabled={!hasSearch} onClick={() => { const next = new URLSearchParams(params); for (const key of ["q", "status", "page"]) next.delete(key); setParams(next); }}>Clear</button>
    </div>
    <small id={helpID}>Search covers every page in this shop.</small>
  </form>;
}
