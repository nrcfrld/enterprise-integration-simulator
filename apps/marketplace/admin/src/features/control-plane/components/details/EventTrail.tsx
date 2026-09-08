import { useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { RelatedResource } from "./RelatedResource";
import type { DetailContentProps } from "./types";

export function EventTrail({ data, token, onOpen, onReload, onRefresh, onNotice, onError, title = "Events" }: DetailContentProps & { title?: string }) {
  const [pending, setPending] = useState(false);
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

  return <>
    {pending && <p role="status">Queuing event delivery…</p>}
    <p>Canonical events record domain changes. Deliveries are asynchronous: enable a matching webhook, then replay an event if needed. Open a delivery to inspect the actual signed request and attempts.</p>
      <h3>{title}</h3>
      {data.events?.length ? (
        data.events.map((event) => (
          <div className="timeline" key={event.id}>
            <div>
              <span>{event.event_type}</span>
              {event.aggregate_id && <p>Resource: {event.aggregate_type === "product" && data.shop_id && onOpen ? <button className="link-button" onClick={() => onOpen({ type: "product", id: event.aggregate_id!, shopID: data.shop_id! })}>{event.aggregate_id}</button> : event.aggregate_type === "order" || event.aggregate_type === "shipment" ? <RelatedResource type={event.aggregate_type} id={event.aggregate_id} onOpen={onOpen} /> : <code>{event.aggregate_id}</code>}</p>}
              <small>{event.occurred_at} · Event ID: <code>{event.id}</code></small>
              <details><summary>Canonical event payload</summary><pre>{event.payload === undefined ? "Payload not recorded" : JSON.stringify(event.payload, null, 2)}</pre><p>This stored domain payload is not the provider-transformed or signed HTTP body. Open a delivery attempt for the actual bytes.</p></details>
              {(event.deliveries ?? data.deliveries?.filter(delivery => delivery.event_id === event.id) ?? []).map(delivery => <p key={delivery.id}><RelatedResource type="delivery" id={delivery.id} label={`${delivery.id} · ${delivery.status}`} onOpen={onOpen} /></p>)}
            </div>
            <div className="timeline-actions">
              <button disabled={pending} onClick={() => void runEventAction(event.id, "replay")}>Replay</button>
              <button disabled={pending} className="quiet" onClick={() => void runEventAction(event.id, "duplicate")}>Duplicate</button>
              <button disabled={pending} className="quiet" onClick={() => void runEventAction(event.id, "delay")}>Delay</button>
            </div>
          </div>
        ))
      ) : (
        <p className="empty compact">No events yet.</p>
      )}
  </>;
}
