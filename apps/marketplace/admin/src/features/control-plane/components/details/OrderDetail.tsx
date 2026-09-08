import { EventTrail } from "./EventTrail";
import { OrderActions } from "./OrderActions";
import { useState } from "react";
import { RelatedResource } from "./RelatedResource";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { OrderFulfillment } from "./OrderFulfillment";
import type { DetailContentProps } from "./types";

export function OrderDetail({
  data,
  onOpen,
  token,
  onReload,
  onRefresh,
  onNotice,
  onError,
}: DetailContentProps) {
  const [pending, setPending] = useState(false);
  const transition = async (action: string, body: Record<string, string> = {}) => {
    if (pending) return;
    setPending(true);
    onError("");
    try {
      await controlPlaneRequest<unknown>(
        `/control/v1/orders/${data.id}/actions/${action}`,
        token,
        { method: "POST", body: JSON.stringify(body) },
      );
      await onReload();
      await onRefresh();
      onNotice(`Order ${action} complete`);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Request failed");
    } finally { setPending(false); }
  };


  return (
    <>
      <p>
        Canonical order status: <b>{data.status}</b> · Provider API status: <b>{data.operations?.provider_status ?? "Unavailable"}</b>
      </p>
      <p>
        Payment status: <b>{data.operations?.payment_status ?? "Unavailable"}</b>
        {data.payment?.reference ? ` · ${data.payment.reference}` : ""}
      </p>
      <div className="page-hint">
        <b>{data.operations?.provider_profile || "SHOPEE_LIKE"}</b>
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
      {pending && <p role="status">Saving order action…</p>}
      <OrderActions data={data} pending={pending} onAction={transition} />
      <OrderFulfillment data={data} token={token} onOpen={onOpen} onReload={onReload} onRefresh={onRefresh} onNotice={onNotice} onError={onError} />
      <EventTrail data={data} onOpen={onOpen} token={token} onReload={onReload} onRefresh={onRefresh} onNotice={onNotice} onError={onError} title="Events from this order and its shipments" />
      <h3>2. Deliveries produced by matching registrations</h3>
      {data.deliveries?.length ? (
        data.deliveries.map((delivery) => (
          <div className="timeline" key={delivery.id}>
            <span>{delivery.status} · {delivery.attempt_count} attempt(s)</span>
            <small>Event {delivery.event_id}</small>
            <RelatedResource type="delivery" id={delivery.id} label="Inspect attempts" onOpen={onOpen} />
          </div>
        ))
      ) : (
        <p className="empty compact">
          No deliveries yet. Creation is asynchronous. Refresh to check again; if none appear, check that a webhook is enabled and subscribed to this event, then replay the event.
        </p>
      )}
    </>
  );
}
