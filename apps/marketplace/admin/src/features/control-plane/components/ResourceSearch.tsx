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
  return <form className="table-toolbar" key={params.toString()} onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams(params);
    next.set("shop", shopID); next.delete("page");
    for (const key of ["q", "status"]) { const value = String(values.get(key) || "").trim(); if (value) next.set(key, value); else next.delete(key); }
    setParams(next);
  }}>
    <label>{labels[page]}<input type="search" name="q" defaultValue={params.get("q") || ""} /></label>
    <label>Status<select name="status" defaultValue={params.get("status") || ""}><option value="">All statuses</option>{statuses[page].map(status => <option key={status}>{status}</option>)}</select></label>
    <button>Search all records</button>
    <button type="button" onClick={() => { const next = new URLSearchParams(params); for (const key of ["q", "status", "page"]) next.delete(key); setParams(next); }}>Clear search</button>
    <small>Search covers all pages in this shop. Text matches are case-insensitive; status uses canonical values.</small>
  </form>;
}
