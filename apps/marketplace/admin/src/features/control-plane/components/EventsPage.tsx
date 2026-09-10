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
  const hasFilters = ["resource_type", "aggregate_id", "event_type"].some((key) => Boolean(params.get(key)));
  if (!shopID) return <section className="empty"><h2>Select a shop to view events</h2><p>Use Current shop above to inspect its domain history.</p><button onClick={() => onNavigate("Shops")}>Manage shops</button></section>;
  return <section className="events-page">
    <form className="events-filter" aria-label="Filter events" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const next = new URLSearchParams({ shop: shopID });
      for (const key of ["resource_type", "aggregate_id", "event_type"]) {
        const value = String(values.get(key) || "").trim();
        if (value) next.set(key, value);
      }
      onPageChange(1);
      setParams(next);
    }} key={params.toString()}>
      <div className="events-filter-fields">
        <label><span>Resource type</span><select name="resource_type" defaultValue={params.get("resource_type") || ""}><option value="">All resources</option><option value="order">Orders</option><option value="product">Products</option><option value="shipment">Shipments</option></select></label>
        <label><span>Resource ID</span><input name="aggregate_id" defaultValue={params.get("aggregate_id") || ""} placeholder="Exact resource ID" aria-describedby="events-filter-help" /></label>
        <label><span>Event type</span><select name="event_type" defaultValue={params.get("event_type") || ""}><option value="">All events</option>{EVENT_CATALOG.map(event => <option key={event.name}>{event.name}</option>)}</select></label>
      </div>
      <div className="events-filter-actions">
        <button className="btn btn-primary btn-sm">Apply filters</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!hasFilters} onClick={() => { onPageChange(1); setParams({ shop: shopID }); }}>Clear</button>
      </div>
      <small id="events-filter-help">Newest first. Resource ID requires an exact order, product, or shipment ID.</small>
    </form>
    <details className="events-context">
      <summary>How events and deliveries relate</summary>
      <p>Canonical events record domain changes. Webhook deliveries happen asynchronously and contain the actual signed request. Archived products keep their event history even after their resource detail is unavailable.</p>
    </details>
    {error && <p role="alert" className="error alert alert-error">{error}</p>}
    <EventTrail data={{ shop_id: shopID, events: (data?.data ?? []) as unknown as DomainEvent[] }} token={token} onOpen={onDetail} onReload={onRefresh} onRefresh={async () => {}} onNotice={onNotice} onError={setError} title="Shop events" headingLevel={2} showDescription={false} />
    {!data?.data?.length && <p className="events-empty-help">No events match these filters. Clear filters, create or edit a product, or simulate an order to begin. Changing delivery scenarios alone does not create a domain event.</p>}
    <footer className="events-footer">
      <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("Webhooks")}>Configure webhooks</button>
      <Pagination pagination={data?.pagination} page={listPage} onChange={onPageChange} />
    </footer>
  </section>;
}
