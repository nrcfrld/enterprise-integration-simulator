import type { DetailData } from "./types";

export function PackageDetail({ data }: { data: DetailData }) {
  return (
    <>
      <p>
        Status: <b>{data.status}</b> · Order {data.order_id}
      </p>
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
          <h3>{data.warehouse?.warehouse_name || data.warehouse?.name || "—"}</h3>
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
