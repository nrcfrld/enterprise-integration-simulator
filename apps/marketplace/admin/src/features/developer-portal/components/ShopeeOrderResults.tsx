interface ShopeeOrder {
  order_id: string;
  order_sn: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function ordersFromResponse(body: string): ShopeeOrder[] {
  try {
    const value: unknown = JSON.parse(body);
    if (!isRecord(value) || value.error !== "" || !isRecord(value.response)) return [];
    const rows: unknown = value.response.order_list;
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is ShopeeOrder =>
      isRecord(row) && typeof row.order_id === "string" && row.order_id.trim() !== ""
      && typeof row.order_sn === "string",
    );
  } catch {
    return [];
  }
}

export function ShopeeOrderResults({ body, onSelect }: {
  body: string;
  onSelect: (orderID: string) => void;
}) {
  const orders = ordersFromResponse(body);
  if (!orders.length) return null;

  return (
    <section aria-label="Open a returned Shopee order">
      <h4>Open an order</h4>
      <p>Use this order opens the detail request with its order_id. The order_sn is its display number.</p>
      <ul>
        {orders.map((order) => (
          <li key={order.order_id}>
            <p>Order number: <b>{order.order_sn}</b><br />API order_id: <code>{order.order_id}</code></p>
            <button type="button" className="quiet" aria-label={`Use this order: ${order.order_sn}`} onClick={() => onSelect(order.order_id)}>Use this order</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
