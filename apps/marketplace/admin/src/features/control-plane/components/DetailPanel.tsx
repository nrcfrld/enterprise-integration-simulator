import { useEffect, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";

const request = (...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<any>(...args);

export function DetailPanel({ detail, token, onClose, onRefresh, onNotice }: any) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [catalogProducts, setCatalogProducts] = useState<any[]>([]);
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<string, number>>({});
  const [newInventory, setNewInventory] = useState<any>({ product_id: "", on_hand_quantity: 0 });
  const detailPath =
    detail.type === "order"
      ? `/control/v1/orders/${detail.id}`
      : detail.type === "shipment"
        ? `/control/v1/shipments/${detail.id}`
        : detail.type === "package"
          ? `/control/v1/packages/${detail.id}`
          : detail.type === "warehouse"
            ? `/control/v1/warehouses/${detail.id}`
            : `/control/v1/deliveries/${detail.id}`;
  useEffect(() => {
    request(detailPath, token)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [detailPath, token]);
  useEffect(() => {
    if (detail.type !== "warehouse" || !data?.shop_id) return;
    request(`/control/v1/shops/${data.shop_id}/products?limit=100`, token)
      .then((result) => setCatalogProducts(result.data || []))
      .catch((err) => setError(err.message));
  }, [data?.shop_id, detail.type, token]);
  const saveInventory = async (productID: string, onHandQuantity: unknown) => {
    const quantity = Number(onHandQuantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setError("On-hand quantity must be a whole number of zero or more.");
      return;
    }
    setError("");
    try {
      await request(`/control/v1/warehouses/${detail.id}/inventory/${productID}`, token, {
        method: "PUT",
        body: JSON.stringify({ on_hand_quantity: quantity }),
      });
      setData(await request(detailPath, token));
      setInventoryDrafts((current) => ({ ...current, [productID]: quantity }));
      setNewInventory((current: any) => current.product_id === productID ? { product_id: "", on_hand_quantity: 0 } : current);
      await onRefresh();
      onNotice("Warehouse inventory updated");
    } catch (err: any) {
      setError(err.message);
    }
  };
  const transition = async (action: string) => {
    await request(`/control/v1/orders/${detail.id}/actions/${action}`, token, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setData(await request(`/control/v1/orders/${detail.id}`, token));
    await onRefresh();
    onNotice(`Order ${action} complete`);
  };
  const shipmentTransition = async (action: string) => {
    const shipmentID = detail.type === "shipment" ? detail.id : data?.shipment?.id;
    if (!shipmentID) {
      setError("Create a shipment through the public API after READY_TO_SHIP before moving it.");
      return;
    }
    setError("");
    try {
      let reason = "";
      if (action === "delivery_failed") {
        const entered = window.prompt("Why did this delivery fail?");
        if (entered === null) return;
        reason = entered.trim();
        if (!reason) {
          setError("A delivery failure reason is required.");
          return;
        }
      }
      await request(`/control/v1/shipments/${shipmentID}/actions/${action}`, token, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      setData(await request(detailPath, token));
      await onRefresh();
      onNotice(`Shipment ${action} complete`);
    } catch (err: any) {
      setError(err.message);
    }
  };
  const replay = async (id: string) => {
    await request(`/control/v1/events/${id}/replay`, token, { method: "POST" });
    setData(await request(`/control/v1/orders/${detail.id}`, token));
    await onRefresh();
    onNotice("Event replay queued");
  };
  const duplicate = async (id: string) => {
    await request(`/control/v1/events/${id}/duplicate`, token, {
      method: "POST",
    });
    setData(await request(`/control/v1/orders/${detail.id}`, token));
    await onRefresh();
    onNotice("Duplicate webhook delivery queued");
  };
  const delay = async (id: string) => {
    const raw = window.prompt("Delay this event by how many seconds?", "30");
    if (raw === null) return;
    const delaySeconds = Number(raw);
    if (!Number.isInteger(delaySeconds) || delaySeconds < 1) {
      setError("Delay must be a whole number of at least one second.");
      return;
    }
    await request(`/control/v1/events/${id}/delay`, token, {
      method: "POST",
      body: JSON.stringify({ delay_seconds: delaySeconds }),
    });
    setData(await request(`/control/v1/orders/${detail.id}`, token));
    await onRefresh();
    onNotice(`Event delivery delayed by ${delaySeconds}s`);
  };
  const shipmentActions: Record<string, string[][]> = {
    CREATED: [["ship", "Mark as shipped"]],
    SHIPPED: [["in_delivery", "Start delivery"]],
    IN_DELIVERY: [
      ["deliver", "Mark as delivered"],
      ["delivery_failed", "Report delivery failure"],
    ],
    DELIVERY_FAILED: [["return_to_sender", "Start return to seller"]],
    RETURNING: [["complete_return", "Mark as returned"]],
  };
  const nextShipmentAction: string[][] | undefined = shipmentActions[
    detail.type === "shipment" ? data?.status : data?.shipment?.status
  ];
  return (
    <div className="modal-backdrop">
      <section className="modal-card detail-card">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">
              {detail.type === "order"
                ? "Order event trail"
                : detail.type === "shipment"
                  ? "Shipment fulfillment"
                  : detail.type === "package"
                    ? "Package allocation"
                    : detail.type === "warehouse"
                      ? "Warehouse inventory"
                      : "Webhook delivery"}
            </p>
            <h2>{data?.tracking_number || data?.order_number || data?.id || "Loading…"}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {data && detail.type === "order" && (
          <>
            <p>
              Status: <b>{data.status}</b>
            </p>
            <p>
              Payment: <b>{data.payment?.status}</b>
              {data.payment?.reference ? ` · ${data.payment.reference}` : ""}
            </p>
            <div className="page-hint">
              <b>{data.operations?.provider_profile || "SHOPEE_LIKE"}</b> · Payment {data.operations?.payment_status || "PENDING"}
              {data.operations?.payment_expires_at ? ` · expires ${data.operations.payment_expires_at}` : ""}
              {data.operations?.seller_deadline_at ? ` · seller deadline ${data.operations.seller_deadline_at}` : ""}
              {data.operations?.payment_failure_reason ? ` · failure ${data.operations.payment_failure_reason}` : ""}
              {data.operations?.cancellation_actor ? ` · cancelled by ${data.operations.cancellation_actor}: ${data.operations.cancellation_reason}` : ""}
            </div>
            <div className="order-detail-grid">
              <section>
                <p className="eyebrow">Customer snapshot</p>
                <h3>{data.customer_data?.name || "Simulated customer"}</h3>
                <p>{data.customer_data?.phone || "No phone supplied"}</p>
              </section>
              <section>
                <p className="eyebrow">Shipping address</p>
                <h3>
                  {data.shipping_address?.address_line || "Address unavailable"}
                </h3>
                <p>
                  {[
                    data.shipping_address?.city,
                    data.shipping_address?.postal_code,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No city or postal code supplied"}
                </p>
              </section>
              <section className="order-items-summary">
                <p className="eyebrow">Item snapshots</p>
                {data.items?.length ? (
                  data.items.map((item: any) => (
                    <p key={item.id || item.sku}>
                      <b>{item.product_name}</b> · {item.quantity} ×{" "}
                      {item.price}
                    </p>
                  ))
                ) : (
                  <p>No item snapshot found.</p>
                )}
              </section>
              <section>
                <p className="eyebrow">Shipment</p>
                {data.shipment ? (
                  <>
                    <h3>{data.shipment.shipping_provider}</h3>
                    <p>
                      {data.shipment.tracking_number} · {data.shipment.status}
                    </p>
                  </>
                ) : (
                  <p>Create it through the public API after the order is READY_TO_SHIP.</p>
                )}
              </section>
              <section>
                <p className="eyebrow">Fulfillment origin</p>
                {data.fulfillment ? (
                  <>
                    <h3>{data.fulfillment.warehouse_name || data.fulfillment.warehouse_code}</h3>
                    <p>{data.fulfillment.warehouse_code} · {data.fulfillment.warehouse_id}</p>
                  </>
                ) : (
                  <p>No warehouse allocation is recorded.</p>
                )}
              </section>
            </div>
            <div className="action-grid">
              {[
                ["pay", "Verify payment"],
                ["payment_failed", "Fail payment"],
                ["process", "Process"],
                ["ready_to_ship", "Ready to ship"],
                ["complete", "Complete"],
                ["cancel", "Cancel"],
              ].map(([key, label]) => (
                <button key={key} onClick={() => transition(key)}>
                  {label}
                </button>
              ))}
            </div>
            {data.shipment && nextShipmentAction && (
              <div className="action-grid">
                {nextShipmentAction.map(([action, label]) => (
                  <button key={action} onClick={() => shipmentTransition(action)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <h3>1. Events created by this order</h3>
            {data.events?.length ? (
              data.events.map((event: any) => (
                <div className="timeline" key={event.id}>
                  <div>
                    <span>{event.event_type}</span>
                    <small>{event.occurred_at}</small>
                  </div>
                  <div className="timeline-actions">
                    <button onClick={() => replay(event.id)}>Replay</button>
                    <button
                      className="quiet"
                      onClick={() => duplicate(event.id)}
                    >
                      Duplicate
                    </button>
                    <button className="quiet" onClick={() => delay(event.id)}>
                      Delay
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty compact">No events yet.</p>
            )}
            <h3>2. Deliveries produced by matching registrations</h3>
            {data.deliveries?.length ? (
              data.deliveries.map((delivery: any) => (
                <div className="timeline" key={delivery.id}>
                  <span>
                    {delivery.status} · {delivery.attempt_count} attempt(s)
                  </span>
                  <small>Event {delivery.event_id}</small>
                </div>
              ))
            ) : (
              <p className="empty compact">
                No matching webhook registration existed when these events were
                published.
              </p>
            )}
          </>
        )}
        {data && detail.type === "shipment" && (
          <>
            <p>
              Shipment status: <b>{data.status}</b>
            </p>
            <div className="order-detail-grid">
              <section>
                <p className="eyebrow">Tracking number</p>
                <h3>{data.tracking_number}</h3>
                <p>{data.shipping_provider}</p>
              </section>
              <section>
                <p className="eyebrow">Fulfillment method</p>
                <h3>{data.pickup_type}</h3>
                <p>Created {data.created_at || "—"}</p>
              </section>
              <section>
                <p className="eyebrow">Linked order</p>
                <h3>{data.order_number}</h3>
                <p>{data.order_status}</p>
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
            {nextShipmentAction ? (
              <div className="action-grid">
                {nextShipmentAction.map(([action, label]) => (
                  <button key={action} onClick={() => shipmentTransition(action)}>
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="page-hint">This shipment has reached its final delivery state.</p>
            )}
          </>
        )}
        {data && detail.type === "package" && (
          <>
            <p>Status: <b>{data.status}</b> · Order {data.order_id}</p>
            <div className="order-detail-grid">
              <section className="order-items-summary">
                <p className="eyebrow">Allocated order items</p>
                {data.items?.map((item: any) => (
                  <p key={item.id}><b>{item.product_name}</b> · {item.sku} · {item.quantity}</p>
                )) || <p>No items allocated.</p>}
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
        )}
        {data && detail.type === "warehouse" && (
          <>
            <p>
              Status: <b>{data.status}</b> · Priority <b>{data.priority}</b>
            </p>
            <div className="order-detail-grid">
              <section>
                <p className="eyebrow">Warehouse</p>
                <h3>{data.name}</h3>
                <p>{data.code}</p>
              </section>
              <section>
                <p className="eyebrow">Address</p>
                <h3>{data.address?.address_line || "Not supplied"}</h3>
                <p>{[data.address?.city, data.address?.postal_code].filter(Boolean).join(" · ") || "—"}</p>
              </section>
            </div>
            <h3>Inventory</h3>
            {data.inventory?.length ? (
              <div className="table-wrap">
                <table className="records-table">
                  <thead><tr><th>SKU</th><th>Product</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Adjust</th></tr></thead>
                  <tbody>{data.inventory.map((item: any) => <tr key={item.product_id}><td>{item.sku}</td><td>{item.product_name}</td><td>{item.on_hand_quantity}</td><td>{item.reserved_quantity}</td><td>{item.available_quantity}</td><td><form className="inventory-adjustment" onSubmit={(event) => { event.preventDefault(); saveInventory(item.product_id, inventoryDrafts[item.product_id] ?? item.on_hand_quantity); }}><input aria-label={`On hand quantity for ${item.product_name}`} type="number" min={item.reserved_quantity} value={inventoryDrafts[item.product_id] ?? item.on_hand_quantity} onChange={(event) => setInventoryDrafts((current) => ({ ...current, [item.product_id]: Number(event.target.value) }))} /><button>Save</button></form></td></tr>)}</tbody>
                </table>
              </div>
            ) : (
              <p className="empty compact">No product inventory is assigned to this warehouse.</p>
            )}
            <form className="inventory-addition" onSubmit={(event) => { event.preventDefault(); saveInventory(newInventory.product_id, newInventory.on_hand_quantity); }}>
              <label>Add a product to this warehouse<select required value={newInventory.product_id} onChange={(event) => setNewInventory((current: any) => ({ ...current, product_id: event.target.value }))}><option value="">Choose product</option>{catalogProducts.filter((product) => !data.inventory?.some((item: any) => item.product_id === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
              <label>On-hand quantity<input type="number" min="0" required value={newInventory.on_hand_quantity} onChange={(event) => setNewInventory((current: any) => ({ ...current, on_hand_quantity: event.target.value }))} /></label>
              <button disabled={!newInventory.product_id}>Add inventory</button>
            </form>
          </>
        )}
        {data && detail.type === "delivery" && (
          <>
            <p>
              Status: <b>{data.status}</b> · {data.attempt_count} attempts
            </p>
            {data.attempts?.map((attempt: any) => (
              <div className="timeline" key={attempt.id}>
                <span>
                  Attempt {attempt.attempt}: {attempt.status}
                </span>
                <small>
                  {attempt.response_status || "network failure"} ·{" "}
                  {attempt.duration_ms}ms
                </small>
                <pre>{attempt.response_body || "No response body"}</pre>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
