import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EVENT_CATALOG } from "@/shared/events/catalog";
import type { ControlPage } from "@/app/navigation";
import type { ControlPlaneData, DetailRequest } from "@/shared/types/controlPlane";
import { EventTrail } from "./details/EventTrail";
import type { DomainEvent } from "./details/types";
import { Pagination } from "./ResourcePage";

export function EventsPage({ data, shopID, token, onDetail, onRefresh, onNotice, onNavigate, listPage, onPageChange }: {
  data: ControlPlaneData | null;
  shopID: string;
  token: string | null | undefined;
  onDetail: (detail: DetailRequest) => void;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  onNavigate: (page: ControlPage) => void;
  listPage: number;
  onPageChange: (page: number) => void;
}) {
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState("");
  if (!shopID) return <section className="empty"><h2>Select a shop to view events</h2><p>Use Current shop above to inspect its domain history.</p><button onClick={() => onNavigate("Shops")}>Manage shops</button></section>;
  return <>
    <form className="table-toolbar" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const next = new URLSearchParams();
      for (const key of ["resource_type", "aggregate_id", "event_type"]) {
        const value = String(values.get(key) || "").trim();
        if (value) next.set(key, value);
      }
      onPageChange(1);
      setParams(next);
    }} key={params.toString()}>
      <label>Resource type<select name="resource_type" defaultValue={params.get("resource_type") || ""}><option value="">All resources</option><option value="order">Orders</option><option value="product">Products</option><option value="shipment">Shipments</option></select></label>
      <label>Resource ID<input name="aggregate_id" defaultValue={params.get("aggregate_id") || ""} placeholder="Exact order, product, or shipment ID" /></label>
      <label>Event type<select name="event_type" defaultValue={params.get("event_type") || ""}><option value="">All events</option>{EVENT_CATALOG.map(event => <option key={event.name}>{event.name}</option>)}</select></label>
      <button>Apply filters</button><button type="button" className="quiet" onClick={() => { onPageChange(1); setParams({}); }}>Clear filters</button>
    </form>
    <p>Newest events first. Resource ID matches the exact aggregate; open an order to see its related shipment events together. Archived products retain their event history and payload even when their resource detail is no longer available.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <EventTrail data={{ shop_id: shopID, events: (data?.data ?? []) as unknown as DomainEvent[] }} token={token} onOpen={onDetail} onReload={onRefresh} onRefresh={async () => {}} onNotice={onNotice} onError={setError} title="Shop events" />
    {!data?.data?.length && <p>No events match these filters. Clear filters, create or edit a product, or simulate an order to begin. Changing delivery scenarios alone does not create a domain event.</p>}
    <button className="btn btn-ghost" onClick={() => onNavigate("Webhooks")}>Configure webhooks</button>
    <Pagination pagination={data?.pagination} page={listPage} onChange={onPageChange} />
  </>;
}
