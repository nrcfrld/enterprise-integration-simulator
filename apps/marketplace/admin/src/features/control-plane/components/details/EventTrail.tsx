import { useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { RelatedResource } from "./RelatedResource";
import type { DetailContentProps } from "./types";

function formatEventTime(value: string) {
  if (Number.isNaN(Date.parse(value))) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export function EventTrail({ data, token, onOpen, onReload, onRefresh, onNotice, onError, title = "Events", headingLevel = 3, showDescription = true }: DetailContentProps & { title?: string; headingLevel?: 2 | 3; showDescription?: boolean }) {
  const [pending, setPending] = useState(false);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const EventHeading = headingLevel === 2 ? "h3" : "h4";
  const runEventAction = async (
    eventID: string,
    action: "replay" | "duplicate" | "delay",
  ) => {
    let body: string | undefined;
    let notice = action === "replay"
      ? "Event replay queued"
      : "Duplicate webhook delivery queued";

    if (action === "delay") {
      const raw = window.prompt("Delay this event by how many seconds?", "30");
      if (raw === null) return;
      const delaySeconds = Number(raw);
      if (!Number.isInteger(delaySeconds) || delaySeconds < 1) {
        onError("Delay must be a whole number of at least one second.");
        return;
      }
      body = JSON.stringify({ delay_seconds: delaySeconds });
      notice = `Event delivery delayed by ${delaySeconds}s`;
    }

    if (pending) return;
    setPending(true);
    onError("");
    try {
      await controlPlaneRequest<unknown>(
        `/control/v1/events/${eventID}/${action}`,
        token,
        { method: "POST", ...(body ? { body } : {}) },
      );
      await onReload();
      await onRefresh();
      onNotice(notice);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Request failed");
    } finally { setPending(false); }
  };

  return <section className="event-trail">
    {pending && <p role="status" className="event-pending">Queuing event delivery…</p>}
    {showDescription && <p className="event-trail-description">Canonical events record domain changes. Open a delivery to inspect its signed request and attempts.</p>}
      <header className="event-list-heading">
        <Heading>{title}</Heading>
        {data.events?.length ? <span>{data.events.length} on this page</span> : null}
      </header>
      {data.events?.length ? (
        <div className="event-list">
          {data.events.map((event) => (
          <article className="event-entry" key={event.id}>
            <div className="event-entry-main">
              <EventHeading>{event.event_type}</EventHeading>
              {event.aggregate_id && <p className="event-resource"><span>Resource</span>{event.aggregate_type === "product" && data.shop_id && onOpen ? <button className="link-button" onClick={() => onOpen({ type: "product", id: event.aggregate_id!, shopID: data.shop_id! })}>{event.aggregate_id}</button> : event.aggregate_type === "order" || event.aggregate_type === "shipment" ? <RelatedResource type={event.aggregate_type} id={event.aggregate_id} onOpen={onOpen} /> : <code>{event.aggregate_id}</code>}</p>}
              <p className="event-meta"><time dateTime={event.occurred_at} title={event.occurred_at}>{formatEventTime(event.occurred_at)} UTC</time><span>Event ID <code>{event.id}</code></span></p>
              <details className="event-payload"><summary>Canonical event payload</summary><pre>{event.payload === undefined ? "Payload not recorded" : JSON.stringify(event.payload, null, 2)}</pre><p>This domain payload is not the provider-transformed or signed HTTP body. Open a delivery attempt for the actual bytes.</p></details>
              {(event.deliveries ?? data.deliveries?.filter(delivery => delivery.event_id === event.id) ?? []).map(delivery => <p className="event-delivery" key={delivery.id}><span>Delivery</span><RelatedResource type="delivery" id={delivery.id} label={`${delivery.id} · ${delivery.status}`} onOpen={onOpen} /></p>)}
            </div>
            <div className="timeline-actions">
              <button className="btn btn-ghost btn-sm event-replay" disabled={pending} onClick={() => void runEventAction(event.id, "replay")}>Replay</button>
              <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => void runEventAction(event.id, "duplicate")}>Duplicate</button>
              <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => void runEventAction(event.id, "delay")}>Delay</button>
            </div>
          </article>
          ))}
        </div>
      ) : (
        <p className="empty compact">No events yet.</p>
      )}
  </section>;
}
