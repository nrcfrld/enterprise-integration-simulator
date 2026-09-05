import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { OrderFulfillment } from "./OrderFulfillment";
import type { DetailContentProps } from "./types";

const orderActions = [
  ["pay", "Verify payment"],
  ["payment_failed", "Fail payment"],
  ["process", "Process"],
  ["ready_to_ship", "Ready to ship"],
  ["complete", "Complete"],
  ["cancel", "Cancel"],
] as const;

export function OrderDetail({
  data,
  onOpen,
  token,
  onReload,
  onRefresh,
  onNotice,
  onError,
}: DetailContentProps) {
  const transition = async (action: string) => {
    onError("");
    try {
      await controlPlaneRequest<unknown>(
        `/control/v1/orders/${data.id}/actions/${action}`,
        token,
        { method: "POST", body: JSON.stringify({}) },
      );
      await onReload();
      await onRefresh();
      onNotice(`Order ${action} complete`);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Request failed");
    }
  };

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
    }
  };

  return (
    <>
      <p>
        Status: <b>{data.status}</b>
      </p>
      <p>
        Payment: <b>{data.payment?.status}</b>
        {data.payment?.reference ? ` · ${data.payment.reference}` : ""}
      </p>
      <div className="page-hint">
        <b>{data.operations?.provider_profile || "SHOPEE_LIKE"}</b> · Payment{" "}
        {data.operations?.payment_status || "PENDING"}
        {data.operations?.payment_expires_at
          ? ` · expires ${data.operations.payment_expires_at}`
          : ""}
        {data.operations?.seller_deadline_at
          ? ` · seller deadline ${data.operations.seller_deadline_at}`
          : ""}
        {data.operations?.payment_failure_reason
          ? ` · failure ${data.operations.payment_failure_reason}`
          : ""}
        {data.operations?.cancellation_actor
          ? ` · cancelled by ${data.operations.cancellation_actor}: ${data.operations.cancellation_reason}`
          : ""}
      </div>
      <div className="order-detail-grid">
        <section>
          <p className="eyebrow">Customer snapshot</p>
          <h3>{data.customer_data?.name || "Simulated customer"}</h3>
          <p>{data.customer_data?.phone || "No phone supplied"}</p>
        </section>
        <section>
          <p className="eyebrow">Shipping address</p>
          <h3>{data.shipping_address?.address_line || "Address unavailable"}</h3>
          <p>
            {[data.shipping_address?.city, data.shipping_address?.postal_code]
              .filter(Boolean)
              .join(" · ") || "No city or postal code supplied"}
          </p>
        </section>
        <section className="order-items-summary">
          <p className="eyebrow">Item snapshots</p>
          {data.items?.length ? (
            data.items.map((item) => (
              <p key={item.id || item.sku}>
                <b>{item.product_name}</b> · {item.quantity} × {item.price}
              </p>
            ))
          ) : (
            <p>No item snapshot found.</p>
          )}
        </section>

      </div>
      <div className="action-grid">
        {orderActions.map(([action, label]) => (
          <button key={action} onClick={() => void transition(action)}>{label}</button>
        ))}
      </div>
      <OrderFulfillment data={data} token={token} onOpen={onOpen} onReload={onReload} onRefresh={onRefresh} onNotice={onNotice} onError={onError} />
      <h3>1. Events created by this order</h3>
      {data.events?.length ? (
        data.events.map((event) => (
          <div className="timeline" key={event.id}>
            <div>
              <span>{event.event_type}</span>
              <small>{event.occurred_at}</small>
            </div>
            <div className="timeline-actions">
              <button onClick={() => void runEventAction(event.id, "replay")}>Replay</button>
              <button className="quiet" onClick={() => void runEventAction(event.id, "duplicate")}>Duplicate</button>
              <button className="quiet" onClick={() => void runEventAction(event.id, "delay")}>Delay</button>
            </div>
          </div>
        ))
      ) : (
        <p className="empty compact">No events yet.</p>
      )}
      <h3>2. Deliveries produced by matching registrations</h3>
      {data.deliveries?.length ? (
        data.deliveries.map((delivery) => (
          <div className="timeline" key={delivery.id}>
            <span>{delivery.status} · {delivery.attempt_count} attempt(s)</span>
            <small>Event {delivery.event_id}</small>
          </div>
        ))
      ) : (
        <p className="empty compact">
          No matching webhook registration existed when these events were published.
        </p>
      )}
    </>
  );
}
