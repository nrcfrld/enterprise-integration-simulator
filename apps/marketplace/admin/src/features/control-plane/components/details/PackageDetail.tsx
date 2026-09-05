import { RelatedResource } from "./RelatedResource";
import type { DetailContentProps, DetailData } from "./types";

export function PackageDetail({ data, onOpen }: { data: DetailData; onOpen?: DetailContentProps["onOpen"] }) {
  return (
    <>
      <p>
        Status: <b>{data.status}</b> · Order <RelatedResource type="order" id={data.order_id} onOpen={onOpen} />
      </p>
      <p>Package ID for shipment requests: <code>{data.id}</code></p>
      <h3>Shipments</h3>
      {data.shipments?.length ? data.shipments.map(shipment => <p key={shipment.id}><RelatedResource type="shipment" id={shipment.id} label={shipment.tracking_number || shipment.id} onOpen={onOpen} /> · {shipment.status}</p>) : <p>No shipment yet. Set package_id to this package’s ID when creating a provider shipment.</p>}
      <div className="order-detail-grid">
        <section className="order-items-summary">
          <p className="eyebrow">Allocated order items</p>
          {data.items?.length ? (
            data.items.map((item) => (
              <p key={item.id || item.sku}>
                <b>{item.product_name}</b> · {item.sku} · {item.quantity}
              </p>
            ))
          ) : (
            <p>No items allocated.</p>
          )}
        </section>
        <section>
          <p className="eyebrow">Fulfillment origin</p>
          <h3><RelatedResource type="warehouse" id={data.warehouse?.warehouse_id} label={data.warehouse?.warehouse_name || data.warehouse?.name} onOpen={onOpen} /></h3>
          <p>{data.warehouse?.warehouse_code || data.warehouse?.code || "No warehouse recorded"}</p>
        </section>
        <section>
          <p className="eyebrow">Created</p>
          <h3>{data.created_at || "—"}</h3>
        </section>
      </div>
    </>
  );
}
