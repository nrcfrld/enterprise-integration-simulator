import { ShipmentActions } from "./ShipmentActions";
import type { DetailContentProps } from "./types";

export function ShipmentDetail({
  data,
  token,
  onReload,
  onRefresh,
  onNotice,
  onError,
}: DetailContentProps) {
  return (
    <>
      <p>
        Shipment status: <b>{data.status}</b>
      </p>
      <div className="order-detail-grid">
        <section>
          <p className="eyebrow">Tracking number</p>
          <h3>{data.tracking_number || "—"}</h3>
          <p>{data.shipping_provider || "—"}</p>
        </section>
        <section>
          <p className="eyebrow">Fulfillment method</p>
          <h3>{data.pickup_type || "—"}</h3>
          <p>Created {data.created_at || "—"}</p>
        </section>
        <section>
          <p className="eyebrow">Linked order</p>
          <h3>{data.order_number || "—"}</h3>
          <p>{data.order_status || "—"}</p>
        </section>
        <section>
          <p className="eyebrow">Delivery timestamps</p>
          <h3>Shipped: {data.shipped_at || "—"}</h3>
          <p>Delivered: {data.delivered_at || "—"}</p>
          <p>Failed: {data.failed_at || "—"}</p>
          <p>Returned: {data.returned_at || "—"}</p>
        </section>
      </div>
      {data.delivery_failure_reason && (
        <p className="page-hint">Failure reason: {data.delivery_failure_reason}</p>
      )}
      <ShipmentActions
        shipmentID={data.id}
        status={data.status}
        token={token}
        onReload={onReload}
        onRefresh={onRefresh}
        onNotice={onNotice}
        onError={onError}
        showFinalState
      />
    </>
  );
}
