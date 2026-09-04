import type { DetailData } from "./types";

export function ProductDetail({ data }: { data: DetailData }) {
  return (
    <>
      <p>
        Status: <b>{data.status}</b> · Stock <b>{data.stock ?? 0}</b>
      </p>
      <div className="order-detail-grid">
        <section>
          <p className="eyebrow">Product</p>
          <h3>{data.name || "Unnamed product"}</h3>
          <p>{data.sku || "No SKU"}</p>
        </section>
        <section>
          <p className="eyebrow">Catalogue</p>
          <h3>{data.category || "Uncategorised"}</h3>
          <p>{data.description || "No description supplied."}</p>
        </section>
        <section>
          <p className="eyebrow">Price</p>
          <h3>{data.price ?? 0}</h3>
          <p>Stored in the configured minor currency unit.</p>
        </section>
      </div>
    </>
  );
}
