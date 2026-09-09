import { WebhookSecretDialog } from "./WebhookSecretDialog";
import { EVENT_CATALOG, eventMapping } from "@/shared/events/catalog";
import { PackageAllocationFields } from "./PackageAllocationFields";
import { WebhookVerification } from "@/features/developer-portal/components/WebhookVerification";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { controlPlaneCollection } from "@/shared/api/controlPlaneCollection";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type {
  Shop,
  CreatedCredential,
  FormInitial,
  FormKind,
  ProductSummary,
  WarehouseSummary,
} from "@/shared/types/controlPlane";
import { MassOrderFields, type MassOrderConfig } from "./MassOrderFields";
import { runMassOrders, type MassOrderProgress } from "../lib/massOrders";
import { AccessibleDialog } from "./AccessibleDialog";

const request = <T,>(...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<T>(...args);
const webhookEvents = EVENT_CATALOG.map(event => event.name);
const webhookEventGroups = [
  {
    label: "Order lifecycle",
    events: webhookEvents.filter((eventName) => eventName.startsWith("order.")),
  },
  {
    label: "Shipment failures and returns",
    events: webhookEvents.filter(eventName => eventName.startsWith("shipment.")),
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
  shop?: Shop;
  kind: FormKind;
  initial?: FormInitial;
  shopID: string;
  token: string | null | undefined;
  onClose: () => void;
  onSaved: (message: string, credential?: CreatedCredential, created?: { kind: "shop" | "order"; id: string; shop?: Shop }) => void | Promise<void>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

interface SecretResponse extends Partial<CreatedCredential> {
  client_secret?: string;
  secret?: string;
}

function inputValue(value: unknown): string | number {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

export function ControlForm({ shop, kind, initial, shopID, token, onClose, onSaved, returnFocusRef }: ControlFormProps) {
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
  const [orderMode, setOrderMode] = useState<"random" | "custom" | "mass">("random");
  const [massOrder, setMassOrder] = useState<MassOrderConfig>({
    productID: "",
    orderCount: 50,
    concurrency: 20,
    quantity: 1,
  });
  const [massProgress, setMassProgress] = useState<MassOrderProgress | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const initialFocusRef = useRef<HTMLHeadingElement>(null);
  const [choiceFilter, setChoiceFilter] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<{ id: string; secret: string; url: string }>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fields =
    ({
      shop: [["name", "Shop name"], ["provider_profile", "Marketplace behavior"]],
      package: [],
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
    if (kind !== "order" || orderMode === "random" || !shopID) return;
    setProductsLoading(true);
    controlPlaneCollection<ProductSummary>(`/control/v1/shops/${shopID}/products?limit=100`, token)
      .then((records) => {
        setProducts(records);
        setMassOrder((current) => ({
          ...current,
          productID: current.productID || records.find((product) => product.stock > 0)?.id || "",
        }));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setProductsLoading(false));
  }, [kind, orderMode, shopID, token]);
  useEffect(() => {
    if (kind !== "product" || !shopID || initial) return;
    setWarehousesLoading(true);
    controlPlaneCollection<WarehouseSummary>(`/control/v1/shops/${shopID}/warehouses?limit=100`, token)
      .then((records) => {
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
        } else if (orderMode === "custom") {
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
        } else {
          if (!massOrder.productID) throw new Error("Choose a target product.");
          if (!Number.isInteger(massOrder.orderCount) || massOrder.orderCount < 2 || massOrder.orderCount > 250) {
            throw new Error("Number of orders must be between 2 and 250.");
          }
          if (!Number.isInteger(massOrder.concurrency) || massOrder.concurrency < 2 || massOrder.concurrency > 50 || massOrder.concurrency > massOrder.orderCount) {
            throw new Error("Concurrent workers must be between 2 and 50, and cannot exceed the order count.");
          }
          if (!Number.isInteger(massOrder.quantity) || massOrder.quantity < 1 || massOrder.quantity > 1000) {
            throw new Error("Quantity per order must be between 1 and 1000.");
          }
          const startedAt = performance.now();
          setMassProgress({ completed: 0, created: 0, rejected: 0, total: massOrder.orderCount });
          const result = await runMassOrders({
            total: massOrder.orderCount,
            concurrency: massOrder.concurrency,
            onProgress: setMassProgress,
            createOrder: () => request(path, token, {
              method: "POST",
              body: JSON.stringify({
                items: [{ product_id: massOrder.productID, quantity: massOrder.quantity }],
              }),
            }),
          });
          const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
          await onSaved(
            `Mass simulation finished in ${elapsedSeconds}s: ${result.created} created and ${result.rejected} rejected across ${massOrder.concurrency} concurrent workers.`,
          );
          return;
        }
      }
      if (kind === "package") {
        if (!Array.isArray(values.package_items) || !values.package_items.length) throw new Error("Select an order and at least one remaining item quantity.");
        path = `/control/v1/shops/${shopID}/packages`;
        body = { order_id: values.order_id, items: values.package_items };
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
      if ((kind === "shop" || kind === "order") && result.id) {
        await onSaved(`${kind} created`, undefined, { kind, id: result.id, ...(kind === "shop" ? { shop: result as Shop } : {}) });
        return;
      }
      if (kind === "package") { await onSaved(`Package ${result.id} allocated for order ${values.order_id}. Use this package_id in the provider shipment request.`); return; }
      if (kind === "webhook" && !initial && result.secret && shop?.provider_profile !== "TOKOPEDIA_LIKE") {
        setWebhookSecret({ id: result.id || "", secret: result.secret, url: String(values.url) });
        return;
      }
      if (kind === "credential") {
        if (!result.id || !result.client_id || !result.client_secret) {
          throw new Error("The credential was created, but its one-time values were not returned. Revoke it before creating another credential.");
        }
        await onSaved("Credential created", {
          id: result.id,
          client_id: result.client_id,
          client_secret: result.client_secret,
          access_token: result.access_token,
        });
        return;
      }
      await onSaved(
        initial && kind === "product"
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
  if (webhookSecret) return <WebhookSecretDialog webhook={webhookSecret} shop={shop} shopID={shopID}
    returnFocusRef={returnFocusRef} onAcknowledge={() => void onSaved("Webhook registration created")} />;
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
  const titleID = `control-form-${kind}-title`;
  return (
    <AccessibleDialog
      ariaLabelledby={titleID}
      backdropClassName="modal-backdrop modal modal-open"
      className="modal-card modal-box"
      closeOnEscape={!submitting}
      initialFocusRef={initialFocusRef}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <form onSubmit={submit}>
        {shop && kind !== "shop" && kind !== "user" && <p className="form-help">{shop.name} · {shop.provider_profile} · {shop.id}</p>}
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Control plane action</p>
            <h2 id={titleID} ref={initialFocusRef} tabIndex={-1}>{title}</h2>
          </div>
          <button type="button" className="icon-button btn btn-circle btn-ghost btn-sm" aria-label="Close form" disabled={submitting} onClick={onClose}>
            ×
          </button>
        </div>
        {kind === "package" && <PackageAllocationFields shopID={shopID} token={token} onChange={(orderID, items) => setValues(current => ({ ...current, order_id: orderID, package_items: items }))} />}
        {(products.length > 20 || warehouses.length > 20) && <label>Filter product or warehouse choices<input type="search" value={choiceFilter} onChange={event => setChoiceFilter(event.target.value)} placeholder="Name, SKU, code, or ID" /></label>}
        {kind === "order" && (
          <>
            <p>
              Orders create <code>order.created</code>; matching enabled webhook
              registrations receive the event asynchronously.
            </p>
            <div
              className="order-mode"
              role="group"
              aria-label="Order mode"
            >
              <button
                type="button"
                className={`btn btn-sm ${orderMode === "random" ? "selected btn-primary" : "quiet btn-ghost"}`}
                aria-pressed={orderMode === "random"}
                disabled={submitting}
                onClick={() => setOrderMode("random")}
              >
                Random order
              </button>
              <button
                type="button"
                className={`btn btn-sm ${orderMode === "custom" ? "selected btn-primary" : "quiet btn-ghost"}`}
                aria-pressed={orderMode === "custom"}
                disabled={submitting}
                onClick={() => setOrderMode("custom")}
              >
                Custom order
              </button>
              <button
                type="button"
                className={`btn btn-sm ${orderMode === "mass" ? "selected btn-primary" : "quiet btn-ghost"}`}
                aria-pressed={orderMode === "mass"}
                disabled={submitting}
                onClick={() => setOrderMode("mass")}
              >
                Mass order
              </button>
            </div>
            {orderMode === "random" ? (
              <p className="form-help">
                The simulator chooses one active product and a generated
                customer snapshot.
              </p>
            ) : orderMode === "mass" ? (
              <MassOrderFields
                config={massOrder}
                products={products}
                loading={productsLoading}
                progress={massProgress}
                disabled={submitting}
                onChange={setMassOrder}
              />
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
                      aria-label={`Product for item ${index + 1}`}
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
                      {products.filter(product => `${product.name} ${product.sku} ${product.id}`.toLowerCase().includes(choiceFilter.toLowerCase()) || values.items.some(item => item.product_id === product.id)).map((product) => (
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
                        aria-label={`Remove item ${index + 1}`}
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
                      aria-label={`Warehouse for initial inventory allocation ${index + 1}`}
                      required
                      value={allocation.warehouse_id}
                      onChange={(event) => setValues((current) => ({ ...current, warehouse_inventory: current.warehouse_inventory.map((item, itemIndex) => itemIndex === index ? { ...item, warehouse_id: event.target.value } : item) }))}
                    >
                      <option value="">Choose warehouse</option>
                      {warehouses.filter(warehouse => `${warehouse.name} ${warehouse.code} ${warehouse.id}`.toLowerCase().includes(choiceFilter.toLowerCase()) || values.warehouse_inventory.some(item => item.warehouse_id === warehouse.id)).map((warehouse) => (
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
                      <button type="button" className="quiet btn btn-ghost btn-sm" aria-label={`Remove warehouse allocation ${index + 1}`} onClick={() => setValues((current) => ({ ...current, warehouse_inventory: current.warehouse_inventory.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
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
        {kind === "product" && initial && <p className="form-help">To change stock, open View product → Inventory by warehouse, or Warehouses &amp; Inventory → View inventory. Edit product changes catalog fields only.</p>}
        {kind === "order" && <p className="form-help">Each order reserves all lines from one ACTIVE warehouse. Aggregate product stock can be sufficient while no single warehouse can fulfill the order. Inspect warehouse inventory if allocation fails.</p>}
        {kind === "warehouse" && (
          <p className="form-help">Larger allocation priority wins; ties use warehouse code alphabetically. One ACTIVE warehouse must have enough available inventory for every order line. Stock cannot be combined across warehouses to create an order.</p>
        )}
        {kind === "webhook" && (
          <>
            <p className="webhook-form-intro">
              Choose the events this endpoint should receive. It does not emit
              events itself.
            </p>
            <WebhookVerification provider={shop?.provider_profile} />
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
              {shop?.provider_profile !== "TOKOPEDIA_LIKE" && <label>
                {initial ? "Replace webhook secret (optional)" : "Webhook secret (optional)"}
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
              </label>}
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
                          aria-label={eventName}
                          aria-describedby={`event-help-${eventName}`}
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
                        <span>{eventName}<small id={`event-help-${eventName}`}>{eventMapping(eventName, shop?.provider_profile)} · {EVENT_CATALOG.find(event => event.name === eventName)?.trigger}</small></span>
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
          <button type="button" className="quiet btn btn-ghost" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={submitting}>
            {submitting
              ? orderMode === "mass" && massProgress
                ? `Creating ${massProgress.completed}/${massProgress.total}…`
                : "Saving…"
              : initial
                ? kind === "warehouse"
                  ? "Save warehouse"
                  : kind === "product"
                    ? "Save product"
                    : "Save settings"
                : orderMode === "mass"
                  ? "Run mass simulation"
                  : "Create"}{" "}
            {!submitting && <span>→</span>}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  );
}
