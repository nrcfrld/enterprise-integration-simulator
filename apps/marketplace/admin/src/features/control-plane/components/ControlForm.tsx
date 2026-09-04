import { type FormEvent, useEffect, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type {
  FormInitial,
  FormKind,
  ListResponse,
  ProductSummary,
  WarehouseSummary,
} from "@/shared/types/controlPlane";

const request = <T,>(...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<T>(...args);
const webhookEvents = [
  "order.created", "order.paid", "order.processing", "order.ready_to_ship",
  "order.shipped", "order.in_delivery", "order.delivered", "order.completed",
  "order.cancelled", "product.created", "product.updated", "product.deleted",
];
const webhookEventGroups = [
  {
    label: "Order lifecycle",
    events: webhookEvents.filter((eventName) => eventName.startsWith("order.")),
  },
  {
    label: "Product updates",
    events: webhookEvents.filter((eventName) => eventName.startsWith("product.")),
  },
];

interface OrderItemInput {
  product_id: string;
  quantity: number | string;
}

interface WarehouseInventoryInput {
  warehouse_id: string;
  on_hand_quantity: number | string;
}

interface FormValues extends Record<string, unknown> {
  status: string;
  provider_profile: string;
  role: string;
  enabled: boolean;
  subscribed_events: string[];
  customer_name: string;
  customer_phone: string;
  address_line: string;
  city: string;
  postal_code: string;
  items: OrderItemInput[];
  warehouse_inventory: WarehouseInventoryInput[];
}

interface ControlFormProps {
  kind: FormKind;
  initial?: FormInitial;
  shopID: string;
  token: string | null | undefined;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}

interface SecretResponse {
  client_secret?: string;
  secret?: string;
}

function inputValue(value: unknown): string | number {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

export function ControlForm({ kind, initial, shopID, token, onClose, onSaved }: ControlFormProps) {
  const supplied = (initial ?? {}) as Partial<FormValues>;
  const [values, setValues] = useState<FormValues>({
    status: "ACTIVE",
    provider_profile: "SHOPEE_LIKE",
    role: "OPERATOR",
    enabled: true,
    subscribed_events: webhookEvents.filter((event) =>
      event.startsWith("order."),
    ),
    customer_name: "",
    customer_phone: "",
    ...supplied,
    items: supplied.items ?? [{ product_id: "", quantity: 1 }],
    warehouse_inventory: supplied.warehouse_inventory ?? [{ warehouse_id: "", on_hand_quantity: 0 }],
    address_line: initial?.address?.address_line || supplied.address_line || "",
    city: initial?.address?.city || supplied.city || "Jakarta",
    postal_code: initial?.address?.postal_code || supplied.postal_code || "",
  });
  const [orderMode, setOrderMode] = useState("random");
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fields =
    ({
      shop: [["name", "Shop name"], ["provider_profile", "Marketplace behavior"]],
      package: [["order_id", "Order ID"], ["order_item_id", "Order item ID"], ["quantity", "Quantity", "number"]],
      product: [
        ["sku", "SKU"],
        ["name", "Name"],
        ["category", "Category"],
        ["description", "Description"],
        ["price", "Price (minor unit)", "number"],
        ["status", "Status"],
      ],
      warehouse: [
        ["code", "Warehouse code"],
        ["name", "Warehouse name"],
        ["address_line", "Address line"],
        ["city", "City"],
        ["postal_code", "Postal code"],
        ["status", "Status"],
        ["priority", "Allocation priority", "number"],
      ],
      user: [
        ["email", "Email", "email"],
        ["password", "Password", "password"],
        ["role", "Role"],
      ],
    } as Record<string, string[][]>)[kind] || [];
  const update = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));
  const updateOrderItem = (index: number, key: string, value: unknown) =>
    setValues((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  const removeOrderItem = (index: number) =>
    setValues((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  useEffect(() => {
    if (kind !== "order" || orderMode !== "custom" || !shopID) return;
    setProductsLoading(true);
    request<ListResponse<ProductSummary>>(`/control/v1/shops/${shopID}/products?limit=100`, token)
      .then((result) => setProducts(result.data || []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setProductsLoading(false));
  }, [kind, orderMode, shopID, token]);
  useEffect(() => {
    if (kind !== "product" || !shopID || initial) return;
    setWarehousesLoading(true);
    request<ListResponse<WarehouseSummary>>(`/control/v1/shops/${shopID}/warehouses?limit=100`, token)
      .then((result) => {
        const records = result.data || [];
        setWarehouses(records);
        setValues((current) => {
          const configured = current.warehouse_inventory?.some((item) => item.warehouse_id);
          if (configured || !records.length) return current;
          const defaultWarehouse = records.find((warehouse) => warehouse.code === "WH-DEFAULT") || records[0];
          return { ...current, warehouse_inventory: [{ warehouse_id: defaultWarehouse.id, on_hand_quantity: 0 }] };
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setWarehousesLoading(false));
  }, [initial, kind, shopID, token]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      let path = "";
      let method = "POST";
      let body: Record<string, unknown> = { ...values };
      if (kind === "shop") path = "/control/v1/shops";
      if (kind === "product") {
        if (initial) {
          path = `/control/v1/shops/${shopID}/products/${initial.id}`;
          method = "PATCH";
          body = { name: values.name, category: values.category, description: values.description, price: Number(values.price), status: values.status };
        } else {
          const warehouseInventory = values.warehouse_inventory.map((allocation) => ({
            warehouse_id: allocation.warehouse_id,
            on_hand_quantity: Number(allocation.on_hand_quantity),
          }));
          if (!warehouseInventory.length || warehouseInventory.some((allocation) => !allocation.warehouse_id || allocation.on_hand_quantity < 0)) {
            throw new Error("Choose at least one warehouse and enter a non-negative quantity.");
          }
          path = `/control/v1/shops/${shopID}/products`;
          body = {
            ...body,
            price: Number(values.price),
            stock: warehouseInventory.reduce((total, allocation) => total + allocation.on_hand_quantity, 0),
            warehouse_inventory: warehouseInventory,
          };
        }
      }
      if (kind === "warehouse") {
        path = initial ? `/control/v1/warehouses/${initial.id}` : `/control/v1/shops/${shopID}/warehouses`;
        method = initial ? "PATCH" : "POST";
        body = {
          code: values.code,
          name: values.name,
          status: values.status || "ACTIVE",
          priority: Number(values.priority || 0),
          address: {
            address_line: values.address_line.trim(),
            city: values.city.trim(),
            postal_code: values.postal_code.trim(),
          },
        };
      }
      if (kind === "order") {
        path = `/control/v1/shops/${shopID}/orders`;
        if (orderMode === "random") {
          body = {};
        } else {
          const items = values.items
            .filter((item) => item.product_id)
            .map((item) => ({
              product_id: item.product_id,
              quantity: Number(item.quantity),
            }));
          if (!items.length) throw new Error("Add at least one product.");
          if (!values.customer_name.trim())
            throw new Error("Customer name is required.");
          body = {
            items,
            customer: {
              name: values.customer_name.trim(),
              phone: values.customer_phone.trim(),
            },
            shipping_address: {
              address_line: values.address_line.trim(),
              city: values.city.trim(),
              postal_code: values.postal_code.trim(),
            },
          };
        }
      }
      if (kind === "package") {
        path = `/control/v1/shops/${shopID}/packages`;
        body = { order_id: values.order_id, items: [{ order_item_id: values.order_item_id, quantity: Number(values.quantity) }] };
      }
      if (kind === "credential") {
        path = `/control/v1/shops/${shopID}/credentials`;
        body = {};
      }
      if (kind === "webhook") {
        path = initial
          ? `/control/v1/shops/${shopID}/webhooks/${initial.id}`
          : `/control/v1/shops/${shopID}/webhooks`;
        method = initial ? "PATCH" : "POST";
        body = {
          url: values.url,
          secret: values.secret || "",
          enabled: Boolean(values.enabled),
          subscribed_events: values.subscribed_events,
        };
      }
      if (kind === "user") path = "/control/v1/users";
      const result = await request<SecretResponse>(path, token, {
        method,
        body: JSON.stringify(body),
      });
      const secret = result.client_secret || result.secret;
      await onSaved(
        secret
          ? `Created. Save this secret now: ${secret}`
          : initial && kind === "product"
            ? "Product updated"
            : initial
              ? "Webhook registration updated"
              : `${kind} created`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };
  const title =
    kind === "order"
      ? "Simulate an order event"
      : kind === "warehouse" && initial
        ? "Edit warehouse"
      : kind === "product" && initial
        ? "Edit product"
      : kind === "credential"
        ? "Create API credential"
        : kind === "webhook"
          ? initial
            ? "Edit webhook registration"
            : "Register webhook destination"
          : `Create ${kind}`;
  return (
    <div className="modal-backdrop modal modal-open" role="presentation">
      <form className="modal-card modal-box" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Control plane action</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button btn btn-circle btn-ghost btn-sm" onClick={onClose}>
            ×
          </button>
        </div>
        {kind === "order" && (
          <>
            <p>
              Orders create <code>order.created</code>; matching enabled webhook
              registrations receive the event asynchronously.
            </p>
            <div
              className="order-mode"
              role="radiogroup"
              aria-label="Order mode"
            >
              <button
                type="button"
                className={`btn btn-sm ${orderMode === "random" ? "selected btn-primary" : "quiet btn-ghost"}`}
                onClick={() => setOrderMode("random")}
              >
                Random order
              </button>
              <button
                type="button"
                className={`btn btn-sm ${orderMode === "custom" ? "selected btn-primary" : "quiet btn-ghost"}`}
                onClick={() => setOrderMode("custom")}
              >
                Custom order
              </button>
            </div>
            {orderMode === "random" ? (
              <p className="form-help">
                The simulator chooses one active product and a generated
                customer snapshot.
              </p>
            ) : (
              <div className="custom-order-fields">
                <div className="order-items-heading">
                  <b>Items</b>
                  <button
                    type="button"
                    className="quiet btn btn-ghost btn-sm"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        items: [
                          ...current.items,
                          { product_id: "", quantity: 1 },
                        ],
                      }))
                    }
                  >
                    + Add item
                  </button>
                </div>
                {values.items.map((item, index) => (
                  <div
                    className="order-item-row"
                    key={`${index}-${item.product_id}`}
                  >
                    <select
                      className="select select-bordered"
                      required
                      value={item.product_id}
                      disabled={productsLoading}
                      onChange={(event) =>
                        updateOrderItem(index, "product_id", event.target.value)
                      }
                    >
                      <option value="">
                        {productsLoading
                          ? "Loading products…"
                          : "Choose product"}
                      </option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} · {product.sku} · stock {product.stock}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input input-bordered"
                      aria-label={`Quantity for item ${index + 1}`}
                      type="number"
                      min="1"
                      required
                      value={item.quantity}
                      onChange={(event) =>
                        updateOrderItem(index, "quantity", event.target.value)
                      }
                    />
                    {values.items.length > 1 && (
                      <button
                        type="button"
                        className="quiet btn btn-ghost btn-sm"
                        onClick={() => removeOrderItem(index)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <div className="field-grid">
                  <label>
                    Customer name
                    <input
                      required
                      value={values.customer_name}
                      onChange={(event) =>
                        update("customer_name", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Customer phone
                    <input
                      value={values.customer_phone}
                      onChange={(event) =>
                        update("customer_phone", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Address line
                    <input
                      value={values.address_line}
                      onChange={(event) =>
                        update("address_line", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    City
                    <input
                      value={values.city}
                      onChange={(event) => update("city", event.target.value)}
                    />
                  </label>
                  <label>
                    Postal code
                    <input
                      value={values.postal_code}
                      onChange={(event) =>
                        update("postal_code", event.target.value)
                      }
                    />
                  </label>
                </div>
              </div>
            )}
          </>
        )}
        {kind === "credential" && (
          <p>The client secret is shown exactly once after creation.</p>
        )}
        {kind === "product" && !initial && (
          <fieldset className="inventory-allocation">
            <legend>Initial inventory by warehouse</legend>
            <p className="form-help">Stock is stored physically in each warehouse. The product’s sellable stock is the total below.</p>
            {warehousesLoading ? (
              <p className="form-help">Loading warehouses…</p>
            ) : warehouses.length ? (
              <>
                {values.warehouse_inventory.map((allocation, index) => (
                  <div className="inventory-allocation-row" key={`${index}-${allocation.warehouse_id}`}>
                    <select
                      className="select select-bordered"
                      required
                      value={allocation.warehouse_id}
                      onChange={(event) => setValues((current) => ({ ...current, warehouse_inventory: current.warehouse_inventory.map((item, itemIndex) => itemIndex === index ? { ...item, warehouse_id: event.target.value } : item) }))}
                    >
                      <option value="">Choose warehouse</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id} disabled={values.warehouse_inventory.some((item, itemIndex) => itemIndex !== index && item.warehouse_id === warehouse.id)}>
                          {warehouse.name} · {warehouse.code}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input input-bordered"
                      aria-label={`Initial quantity for warehouse ${index + 1}`}
                      type="number"
                      min="0"
                      required
                      value={allocation.on_hand_quantity}
                      onChange={(event) => setValues((current) => ({ ...current, warehouse_inventory: current.warehouse_inventory.map((item, itemIndex) => itemIndex === index ? { ...item, on_hand_quantity: event.target.value } : item) }))}
                    />
                    {values.warehouse_inventory.length > 1 && (
                      <button type="button" className="quiet btn btn-ghost btn-sm" onClick={() => setValues((current) => ({ ...current, warehouse_inventory: current.warehouse_inventory.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                    )}
                  </div>
                ))}
                <div className="inventory-allocation-footer">
                  <button type="button" className="quiet btn btn-ghost btn-sm" disabled={values.warehouse_inventory.length >= warehouses.length} onClick={() => setValues((current) => ({ ...current, warehouse_inventory: [...current.warehouse_inventory, { warehouse_id: "", on_hand_quantity: 0 }] }))}>+ Add warehouse</button>
                  <b>Total sellable stock: {values.warehouse_inventory.reduce((total, allocation) => total + (Number(allocation.on_hand_quantity) || 0), 0)}</b>
                </div>
              </>
            ) : (
              <p className="error">Create a warehouse before adding a product.</p>
            )}
          </fieldset>
        )}
        {kind === "warehouse" && (
          <p className="form-help">This address identifies the fulfillment origin for operations. Allocation priority determines which active warehouse is considered first.</p>
        )}
        {kind === "webhook" && (
          <>
            <p className="webhook-form-intro">
              Choose the events this endpoint should receive. It does not emit
              events itself.
            </p>
            <div className="webhook-primary-fields">
              <label>
                Endpoint URL
                <input
                  className="input input-bordered"
                  required
                  type="url"
                  value={inputValue(values.url)}
                  placeholder="https://example.test/webhooks/marketplace"
                  onChange={(event) => update("url", event.target.value)}
                />
              </label>
              <label>
                Replace secret (optional)
                <input
                  className="input input-bordered"
                  value={inputValue(values.secret)}
                  placeholder={
                    initial
                      ? "Leave blank to keep the current secret"
                      : "Leave blank to generate one"
                  }
                  onChange={(event) => update("secret", event.target.value)}
                />
              </label>
            </div>
            <fieldset className="event-selector">
              <legend>Subscribed events</legend>
              {webhookEventGroups.map((group) => (
                <div className="event-selector-group" key={group.label}>
                  <span>{group.label}</span>
                  <div className="event-option-grid">
                    {group.events.map((eventName) => (
                      <label className="event-option" key={eventName}>
                        <input
                          className="checkbox checkbox-primary checkbox-sm"
                          type="checkbox"
                          checked={values.subscribed_events.includes(eventName)}
                          onChange={(event) =>
                            update(
                              "subscribed_events",
                              event.target.checked
                                ? [...values.subscribed_events, eventName]
                                : values.subscribed_events.filter(
                                    (item: string) => item !== eventName,
                                  ),
                            )
                          }
                        />
                        <span>{eventName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            {initial && (
              <label className="switch">
                <input
                  className="toggle toggle-primary"
                  type="checkbox"
                  checked={Boolean(values.enabled)}
                  onChange={(event) => update("enabled", event.target.checked)}
                />
                Deliver events to this endpoint
              </label>
            )}
          </>
        )}
        {fields.map(([key, label, type = "text"]) => (
          <label key={key}>
            {label}
            {key === "role" ? (
              <select
                className="select select-bordered"
                value={inputValue(values[key]) || "OPERATOR"}
                onChange={(event) => update(key, event.target.value)}
              >
                <option>OPERATOR</option>
                <option>ADMIN</option>
              </select>
            ) : key === "status" ? (
              <select
                className="select select-bordered"
                value={inputValue(values[key]) || "ACTIVE"}
                onChange={(event) => update(key, event.target.value)}
              >
                <option value="ACTIVE">ACTIVE — eligible for new orders</option>
                <option value="INACTIVE">INACTIVE — keep stock, stop new allocation</option>
              </select>
            ) : key === "provider_profile" ? (
              <select
                className="select select-bordered"
                value={inputValue(values[key]) || "SHOPEE_LIKE"}
                onChange={(event) => update(key, event.target.value)}
              >
                <option value="SHOPEE_LIKE">SHOPEE_LIKE — payment, SLA, cancellation policy</option>
                <option value="TOKOPEDIA_LIKE">TOKOPEDIA_LIKE — Tokopedia & Shop / TikTok Shop contract</option>
              </select>
            ) : (
              <input
                className="input input-bordered"
                type={type}
                required={key !== "description"}
                disabled={kind === "product" && initial && key === "sku"}
                value={inputValue(values[key])}
                onChange={(event) => update(key, event.target.value)}
              />
            )}
          </label>
        ))}
        {error && <p className="error alert alert-error" role="alert">{error}</p>}
        <div className="form-actions modal-action">
          <button type="button" className="quiet btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={submitting}>
            {submitting
              ? "Saving…"
              : initial
                ? kind === "warehouse"
                  ? "Save warehouse"
                  : kind === "product"
                    ? "Save product"
                    : "Save settings"
                : "Create"}{" "}
            {!submitting && <span>→</span>}
          </button>
        </div>
      </form>
    </div>
  );
}
