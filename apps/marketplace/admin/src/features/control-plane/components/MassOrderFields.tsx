import type { ProductSummary } from "@/shared/types/controlPlane";
import type { MassOrderProgress } from "../lib/massOrders";

export interface MassOrderConfig {
  productID: string;
  orderCount: number;
  concurrency: number;
  quantity: number;
}

interface MassOrderFieldsProps {
  config: MassOrderConfig;
  products: ProductSummary[];
  loading: boolean;
  progress: MassOrderProgress | null;
  disabled: boolean;
  onChange: (config: MassOrderConfig) => void;
}

export function MassOrderFields({
  config,
  products,
  loading,
  progress,
  disabled,
  onChange,
}: MassOrderFieldsProps) {
  const selectedProduct = products.find((product) => product.id === config.productID);
  const capacity = selectedProduct
    ? Math.floor(selectedProduct.stock / Math.max(config.quantity, 1))
    : 0;
  const contentionExpected = Boolean(selectedProduct) && config.orderCount > capacity;
  const update = (key: keyof MassOrderConfig, value: string) => {
    if (key === "productID") {
      onChange({ ...config, productID: value });
      return;
    }
    const numericValue = Number(value);
    onChange({
      ...config,
      [key]: numericValue,
      ...(key === "orderCount" && numericValue >= 2
        ? { concurrency: Math.min(config.concurrency, numericValue) }
        : {}),
    });
  };

  return (
    <section className="mass-order-panel" aria-labelledby="mass-order-title">
      <header>
        <div>
          <h3 id="mass-order-title">Inventory contention test</h3>
          <p>Send overlapping orders for one product to verify atomic reservation and oversell protection.</p>
        </div>
        <span className="badge badge-outline">Concurrent</span>
      </header>

      <label className="mass-order-product">
        <span>Target product</span>
        <select
          className="select select-bordered"
          aria-label="Target product"
          required
          value={config.productID}
          disabled={loading || disabled}
          onChange={(event) => update("productID", event.target.value)}
        >
          <option value="">{loading ? "Loading products…" : "Choose one product"}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {product.sku} · available {product.stock}
            </option>
          ))}
        </select>
      </label>

      <div className="mass-order-grid">
        <label>
          <span>Number of orders</span>
          <input
            className="input input-bordered"
            aria-label="Number of orders"
            type="number"
            min="2"
            max="250"
            required
            value={config.orderCount}
            disabled={disabled}
            onChange={(event) => update("orderCount", event.target.value)}
          />
          <small>2–250 attempts</small>
        </label>
        <label>
          <span>Concurrent workers</span>
          <input
            className="input input-bordered"
            aria-label="Concurrent workers"
            type="number"
            min="2"
            max={Math.min(config.orderCount || 2, 50)}
            required
            value={config.concurrency}
            disabled={disabled}
            onChange={(event) => update("concurrency", event.target.value)}
          />
          <small>2–50 in flight</small>
        </label>
        <label>
          <span>Quantity per order</span>
          <input
            className="input input-bordered"
            aria-label="Quantity per order"
            type="number"
            min="1"
            max="1000"
            required
            value={config.quantity}
            disabled={disabled}
            onChange={(event) => update("quantity", event.target.value)}
          />
          <small>{config.orderCount * config.quantity} units requested</small>
        </label>
      </div>

      {selectedProduct && (
        <p className={`mass-order-guidance ${contentionExpected ? "will-contend" : ""}`}>
          <strong>{selectedProduct.stock} units available.</strong>{" "}
          {contentionExpected
            ? `At most ${capacity} order${capacity === 1 ? "" : "s"} should succeed; the rest should be rejected without overselling.`
            : `Current stock can satisfy every attempt. Request more than ${capacity} orders to force inventory rejection.`}
        </p>
      )}

      {progress && (
        <div className="mass-order-progress" role="status" aria-live="polite">
          <div>
            <span>Running requests</span>
            <strong>{progress.completed}/{progress.total}</strong>
          </div>
          <progress value={progress.completed} max={progress.total} />
          <small>{progress.created} created · {progress.rejected} rejected</small>
        </div>
      )}
    </section>
  );
}
