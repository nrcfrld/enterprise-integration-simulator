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
  page: ResourcePageName;
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
  page,
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
  const retry = async (id: string) => {
    await request<unknown>(`/control/v1/deliveries/${id}/retry`, token, {
      method: "POST",
    });
    await onRefresh();
    onNotice("Delivery queued for retry");
  };
  const archiveProduct = async (product: ResourceRecord) => {
    if (!window.confirm(`Archive ${product.name}? Existing order history will be preserved.`)) return;
    await request<unknown>(`/control/v1/shops/${shopID}/products/${product.id}`, token, { method: "DELETE" });
    await onRefresh();
    onNotice("Product archived");
  };
  return (
    <>
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
                  <th key={key}>{key.replaceAll("_", " ")}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns(rows[0], page).map((key) => (
                    <td key={key} data-label={key.replaceAll("_", " ")}>
                      {(page === "Packages" || page === "Shipments") && key === "order_number" ? <RelatedResource type="order" id={String(row.order_id || "")} label={String(row.order_number || row.order_id || "")} onOpen={onDetail} />
                        : (page === "Packages" || page === "Shipments") && key === "warehouse_name" ? <RelatedResource type="warehouse" id={String(row.warehouse_id || "")} label={String(row.warehouse_name || "")} onOpen={onDetail} />
                        : page === "Shipments" && key === "package_id" ? <RelatedResource type="package" id={String(row.package_id || "")} onOpen={onDetail} /> : String(row[key] ?? "—")}
                    </td>
                  ))}
                  <td className="row-actions" data-label="Actions">
                    {page === "Products" && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => onDetail({ type: "product", id: row.id, shopID })}>View product</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onForm({ kind: "product", initial: row })}>Edit product</button>
                        <button className="danger btn btn-error btn-soft btn-sm" onClick={() => archiveProduct(row)}>Archive</button>
                      </>
                    )}
                    {page === "Orders" && (
                      <button
                        onClick={() => onDetail({ type: "order", id: row.id })}
                      >
                        Event trail
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
                        {row.webhook_deleted ? <span>Webhook deleted · history retained</span> : <button onClick={() => retry(row.id)}>Retry</button>}
                      </>
                    )}
                    {page === "Credentials" && row.status === "ACTIVE" && (
                      <button
                        onClick={async () => {
                          await request<unknown>(
                            `/control/v1/credentials/${row.id}/revoke`,
                            token,
                            { method: "POST" },
                          );
                          await onRefresh();
                          onNotice("Credential revoked");
                        }}
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
          <p className="empty">Choose a shop or create a record to begin.</p>
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
  if (page === "Warehouses") return ["code", "name", "status", "priority", "product_count", "available_quantity"];
  if (page === "Deliveries") return ["event_type", "endpoint", "status", "attempt_count", "next_attempt_at", "failure_reason"];
  if (page === "Shipments") return ["order_number", "package_id", "warehouse_name", "tracking_number", "status", "created_at"];
  if (page === "Packages") return ["order_number", "status", "item_count", "warehouse_name", "warehouse_code", "created_at"];
  return Object.keys(row)
    .filter((key) => typeof row[key] !== "object")
    .slice(0, 7);
}
