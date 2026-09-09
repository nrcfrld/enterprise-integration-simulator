import { useInRouterContext } from "react-router-dom";
import { ResourceSearch } from "./ResourceSearch";
import { CredentialRevocation } from "./CredentialRevocation";
import { useState } from "react";
import type { ControlPage } from "@/app/navigation";
import { RelatedResource } from "./details/RelatedResource";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type {
  ControlPlaneData,
  ControlRole,
  DetailRequest,
  FormKind,
  FormRequest,
  PaginationMetadata,
  ResourceRecord,
  Shop,
} from "@/shared/types/controlPlane";

const request = <T,>(...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<T>(...args);

type ResourcePageName =
  | "Products"
  | "Warehouses"
  | "Credentials"
  | "Orders"
  | "Packages"
  | "Shipments"
  | "Deliveries"
  | "Users";

interface ResourcePageProps {
  onTry?: (endpointID: string) => void;
  shop?: Shop;
  page: ResourcePageName;
  onNavigate?: (page: ControlPage) => void;
  data: ControlPlaneData | null;
  shopID: string;
  token: string | null | undefined;
  role: ControlRole;
  onForm: (form: FormRequest) => void;
  onDetail: (detail: DetailRequest) => void;
  onRefresh: () => void | Promise<void>;
  onNotice: (text: string) => void;
  onSeed: () => void | Promise<void>;
  isSeeding: boolean;
  listPage: number;
  onPageChange: (page: number) => void;
}

export function ResourcePage({
  onTry,
  shop,
  page,
  onNavigate,
  data,
  shopID,
  token,
  role,
  onForm,
  onDetail,
  onRefresh,
  onNotice,
  onSeed,
  isSeeding,
  listPage,
  onPageChange,
}: ResourcePageProps) {
  const inRouter = useInRouterContext();
  const [revokingID, setRevokingID] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const rows = Array.isArray(data?.data) ? data.data : [];
  const actions: Partial<Record<ResourcePageName, readonly [FormKind, string] | null>> = {
    Products: ["product", "New product"],
    Warehouses: ["warehouse", "New warehouse"],
    Orders: ["order", "Simulate order"],
    Packages: ["package", "Allocate package"],
    Credentials: ["credential", "New credential"],
    Users: role === "ADMIN" ? ["user", "New user"] : null,
  };
  const action = actions[page];
  const mutate = async (path: string, method: string, notice: string) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await request<unknown>(path, token, { method });
      await onRefresh();
      onNotice(notice);
    } catch (reason) {
      setError(`${notice.replace(/ (queued for retry|archived|revoked)$/, " action")} failed: ${reason instanceof Error ? reason.message : "Request failed"}. Try the action again after resolving the error.`);
    } finally { setPending(false); }
  };
  const retry = (id: string) => mutate(`/control/v1/deliveries/${id}/retry`, "POST", "Delivery queued for retry");
  const archiveProduct = (product: ResourceRecord) => {
    if (pending || !window.confirm(`Archive ${product.name}? Existing order history will be preserved.`)) return;
    return mutate(`/control/v1/shops/${shopID}/products/${product.id}`, "DELETE", "Product archived");
  };
  if (!shopID && page !== "Users") return <section className="empty">
    <h2>Select a shop to view {page.toLowerCase()}</h2>
    <p>Use Current shop above or create a shop to begin.</p>
    <button onClick={() => onForm({ kind: "shop" })}>Create shop</button>
    {onNavigate && <button onClick={() => onNavigate("Shops")}>Manage shops</button>}
  </section>;
  const emptyHelp: Record<ResourcePageName, string> = {
    Products: "No products yet. Add a product with warehouse stock to simulate an order.",
    Warehouses: "No warehouses yet. Add a warehouse to hold inventory and fulfill orders.",
    Orders: "No orders yet. Simulate an order after adding products and stock.",
    Credentials: "No credentials yet. Create one and save its one-time secret to sign API requests.",
    Packages: "No packages yet. Allocate items from a READY_TO_SHIP order, or let a public shipment request allocate them automatically.",
    Shipments: "No shipments yet. Create one through the provider API Simulator for a READY_TO_SHIP order or explicit package.",
    Deliveries: "No deliveries yet. Enable a webhook subscribed to your event, then simulate an order or replay an event. Delivery creation is asynchronous; refresh to check again.",
    Users: "No users on this page. Administrators can create an operator account.",
  };
  return (
    <>
      {revokingID && shop && <CredentialRevocation id={revokingID} shop={shop} token={token} onClose={() => setRevokingID(undefined)} onRevoked={async () => { await onRefresh(); onNotice("Credential revoked. Update your client and verify delivery before resuming."); }} />}
      {error && <p role="alert" className="error alert alert-error">{error}</p>}
      {pending && <p role="status">Saving action…</p>}
      <div className="page-hint alert alert-info">
        {page === "Orders"
          ? "Orders trigger the event timeline. Inspect one to see every resulting webhook delivery."
          : page === "Shipments"
            ? "Shipments are created through the public API. Advance each fulfillment record one valid state at a time."
            : page === "Warehouses"
              ? "Warehouses are fulfillment origins. Their inventory is reserved when an order is created and consumed only when its shipment is marked shipped."
          : page === "Credentials"
            ? "Credentials are for the external integrator; the secret is visible only when it is created."
            : "Manage records for the selected shop."}
      </div>
      {page === "Products" && onNavigate && <button className="btn btn-ghost" onClick={() => onNavigate("Warehouses")}>Manage warehouse inventory</button>}
      {page === "Credentials" && onNavigate && <button className="btn btn-ghost" onClick={() => onNavigate("Documentation")}>Return to request simulator</button>}
      {inRouter && ["Orders", "Products", "Shipments", "Deliveries"].includes(page) && <ResourceSearch page={page} shopID={shopID} />}
      <div className="table-toolbar">
        {action && (
          <button className="btn btn-primary" onClick={() => onForm({ kind: action[0] })}>
            + {action[1]}
          </button>
        )}
        {page === "Products" && shopID && (
          <button className="danger btn btn-error btn-soft" disabled={isSeeding} onClick={() => void onSeed()}>
            {isSeeding ? "Resetting…" : "Reset to seed"}
          </button>
        )}
        <span>
          {rows.length} record{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="table-wrap card bg-base-100">
        {rows.length ? (
          <table className="records-table table table-zebra">
            <thead>
              <tr>
                {columns(rows[0], page).map((key) => (
                  <th key={key}>{columnLabel(key)}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns(rows[0], page).map((key) => (
                    <td key={key} data-label={columnLabel(key)}>
                      {(page === "Packages" || page === "Shipments") && key === "order_number" ? <RelatedResource type="order" id={String(row.order_id || "")} label={String(row.order_number || row.order_id || "")} onOpen={onDetail} />
                        : (page === "Packages" || page === "Shipments") && key === "warehouse_name" ? <RelatedResource type="warehouse" id={String(row.warehouse_id || "")} label={String(row.warehouse_name || "")} onOpen={onDetail} />
                        : page === "Shipments" && key === "package_id" ? <RelatedResource type="package" id={String(row.package_id || "")} onOpen={onDetail} /> : <RecordValue name={key} value={row[key]} onError={setError} onNotice={onNotice} />}
                    </td>
                  ))}
                  <td className="row-actions" data-label="Actions">
                    {page === "Products" && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => onDetail({ type: "product", id: row.id, shopID })}>View product</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onForm({ kind: "product", initial: row })}>Edit product</button>
                        <button className="danger btn btn-error btn-soft btn-sm" disabled={pending} onClick={() => void archiveProduct(row)}>Archive</button>
                      </>
                    )}
                    {page === "Orders" && (
                      <button
                        onClick={() => onDetail({ type: "order", id: row.id })}
                      >
                        View order
                      </button>
                    )}
                    {page === "Shipments" && (
                      <button onClick={() => onDetail({ type: "shipment", id: row.id })}>
                        View shipment
                      </button>
                    )}
                    {page === "Packages" && (
                      <button onClick={() => onDetail({ type: "package", id: row.id })}>
                        View package
                      </button>
                    )}
                    {page === "Warehouses" && (
                      <>
                        <button onClick={() => onDetail({ type: "warehouse", id: row.id })}>
                          View inventory
                        </button>
                        <button className="quiet" onClick={() => onForm({ kind: "warehouse", initial: row })}>
                          Edit warehouse
                        </button>
                      </>
                    )}
                    {page === "Deliveries" && (
                      <>
                        <button
                          onClick={() =>
                            onDetail({ type: "delivery", id: row.id })
                          }
                        >
                          Attempts
                        </button>
                        {row.webhook_deleted ? <span>Webhook deleted · history retained</span> : <button disabled={pending} onClick={() => void retry(row.id)}>Retry</button>}
                      </>
                    )}
                    {page === "Credentials" && row.status === "ACTIVE" && (
                      <button
                        disabled={pending}
                        onClick={() => setRevokingID(row.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty"><p>{emptyHelp[page]}</p>{["Orders", "Products", "Shipments", "Deliveries"].includes(page) && <p>If searching, clear the search to see other records in this shop.</p>}
            {onNavigate && page === "Shipments" && <button onClick={() => onTry ? onTry(shop?.provider_profile === "TOKOPEDIA_LIKE" ? "tokopedia-create-shipment" : "shopee-create-shipment") : onNavigate("Documentation")}>Open API Simulator</button>}
            {onNavigate && page === "Deliveries" && <button onClick={() => onNavigate("Webhooks")}>Configure webhooks</button>}
            {onNavigate && page === "Packages" && <button onClick={() => onNavigate("Orders")}>View orders</button>}
          </div>
        )}
      </div>
      <Pagination pagination={data?.pagination} page={listPage} onChange={onPageChange} />
    </>
  );
}

interface PaginationProps {
  pagination?: PaginationMetadata;
  page: number;
  onChange: (page: number) => void;
}

export function Pagination({ pagination, page, onChange }: PaginationProps) {
  const current = pagination?.page || page;
  const totalPages = pagination?.total_pages || 1;
  const total = pagination?.total ?? 0;
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <p>
        Page {current} of {totalPages} <span>· {total} records</span>
      </p>
      <div>
        <button className="quiet btn btn-ghost btn-sm" disabled={current <= 1} onClick={() => onChange(current - 1)}>
          Previous
        </button>
        <button className="btn btn-primary btn-sm" disabled={current >= totalPages} onClick={() => onChange(current + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}
function columns(row: Record<string, unknown>, page: string) {
  if (page === "Products") return ["sku", "name", "category", "price", "status", "stock"];
  if (page === "Warehouses") return ["code", "name", "status", "priority", "product_count", "available_quantity"];
  if (page === "Deliveries") return ["event_type", "endpoint", "status", "attempt_count", "next_attempt_at", "failure_reason"];
  if (page === "Shipments") return ["order_number", "package_id", "warehouse_name", "tracking_number", "status", "created_at"];
  if (page === "Packages") return ["order_number", "status", "item_count", "unit_count", "warehouse_name", "warehouse_code", "created_at"];
  if (page === "Orders") return ["id", "order_number", "status", "total_amount", "created_at"];
  if (page === "Credentials") return ["client_id", "status", "created_at", "revoked_at"];
  if (page === "Users") return ["email", "role", "status", "created_at"];
  return Object.keys(row).filter(key => typeof row[key] !== "object");
}

function columnLabel(key: string) {
  return ({ stock: "available stock", item_count: "Lines", unit_count: "Units", id: "API ID" } as Record<string, string>)[key] || key.replaceAll("_", " ");
}
function RecordValue({ name, value, onError, onNotice }: { name: string; value: unknown; onError: (text: string) => void; onNotice: (text: string) => void }) {
  if (value == null) return <>—</>;
  const text = String(value);
  if (name.endsWith("_at") && !Number.isNaN(Date.parse(text))) return <time dateTime={text} title={text}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(text))} UTC</time>;
  if (name === "id" || name.endsWith("_id")) return <><code>{text}</code> <button className="btn btn-ghost btn-xs" aria-label={`Copy ${name.replaceAll("_", " ")} ${text}`} onClick={() => { void navigator.clipboard.writeText(text).then(() => onNotice("ID copied"), () => onError("Could not copy. Select and copy the displayed ID.")); }}>Copy</button></>;
  return <>{text}</>;
}
