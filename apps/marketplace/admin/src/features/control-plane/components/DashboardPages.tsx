import { useCallback, useEffect, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ControlPage } from "@/app/navigation";
import type {
  ControlPlaneData,
  ControlRole,
  FormRequest,
  Shop,
} from "@/shared/types/controlPlane";
import { Pagination } from "./ResourcePage";

const request = <T,>(...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<T>(...args);

function providerLabel(profile: string) {
  return ({ SHOPEE_LIKE: "Shopee-like", TOKOPEDIA_LIKE: "Tokopedia-like" } as Record<string, string>)[profile] || "Shopee-like";
}

function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 10 3 3 7-7" /></svg>;
}

function ArrowRightIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>;
}

function ChevronDownIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" /></svg>;
}

interface DashboardProps {
  onTryOrders?: () => void;
  data: ControlPlaneData | null;
  shopID: string;
  token: string | null | undefined;
  role: ControlRole;
  onNavigate: (page: ControlPage) => void;
  onForm: (form: FormRequest) => void;
  onSeed: () => Promise<void>;
  isSeeding: boolean;
}

interface RunbookStep {
  number: string;
  title: string;
  description: string;
  complete: boolean;
  label: string;
  action: () => void | Promise<void>;
}

export function Dashboard({ onTryOrders, data, shopID, token, role, onNavigate, onForm, onSeed, isSeeding }: DashboardProps) {
  const steps: RunbookStep[] = [
    {
      number: "1",
      label: shopID ? "Open shops" : "Create shop",
      title: "Create or choose a shop",
      description: "A shop scopes catalog data, credentials, scenarios, and webhook deliveries. Create one first when your console is empty.",
      complete: Boolean(shopID),
      action: () => (shopID ? onNavigate("Shops") : onForm({ kind: "shop" })),
    },
    {
      number: "2",
      label: "Manage products",
      title: "Prepare catalog",
      description: "Add products and warehouse stock. Optional sample reset is a separate destructive action below.",
      complete: (data?.setup?.products ?? 0) > 0,
      action: () => onNavigate("Products"),
    },
    {
      number: "3",
      label: "Manage credentials",
      title: "Create API credential",
      description: "An active credential exists only as configuration evidence. Save its one-time secret; if it is lost or was seeded, create a new credential and revoke the unusable one.",
      complete: Boolean(data?.setup?.credential_active),
      action: () => onNavigate("Credentials"),
    },
    {
      number: "4",
      label: "Configure",
      title: "Register webhook",
      description: "Save your receiver URL, subscribe to order events, and enable delivery. Enabled does not prove your receiver is reachable.",
      complete: Boolean(data?.setup?.webhook_enabled),
      action: () => onNavigate("Webhooks"),
    },
  ];
  const completeSteps = steps.filter((step) => step.complete).length;
  return (
    <div className="dashboard-page">
      <section className="dashboard-overview" aria-labelledby="dashboard-overview-title">
        <div className="dashboard-section-heading">
          <div>
            <h2 id="dashboard-overview-title">Workspace overview</h2>
            <p>{data ? "Control-plane records for the shops you can access." : "Dashboard data has not loaded yet."}</p>
          </div>
          {data && <p className="dashboard-data-note">This view does not verify Public API or webhook worker health.</p>}
        </div>
        <div className="metrics stats">
        {[
          ["Shops", data?.shops],
          ["Orders", data?.orders],
          ["Failed deliveries", data?.failed_deliveries],
        ].map(([label, value]) => (
          <article className="stat" key={label}>
            <p className="stat-title">{label}</p>
            <strong className="stat-value">{value ?? "—"}</strong>
          </article>
        ))}
        </div>
      </section>

      <section className="dashboard-setup" aria-labelledby="dashboard-setup-title">
        <div className="dashboard-section-heading">
          <div>
            <h2 id="dashboard-setup-title">Set up this shop</h2>
            <p>Complete the control-plane configuration before testing the public integration.</p>
          </div>
          <span className="setup-progress">{completeSteps} of {steps.length} complete</span>
        </div>
        <div className="dashboard-setup-grid">
          <ol className="setup-steps">
            {steps.map(({ number, title, description, complete, action, label }) => (
              <li key={number} className={complete ? "complete" : ""}>
                <span className="step-number">{complete ? <CheckIcon /> : number}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{description}</p>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!shopID && number !== "1"}
                  onClick={() => void action()}
                >
                  {label}<ArrowRightIcon />
                </button>
              </li>
            ))}
          </ol>
          <aside className="setup-readiness" aria-label="Integration setup readiness">
            <h3>Configuration status</h3>
            <p>{data?.setup?.ready ? "Core configuration is present. Manual verification is still required." : "Finish the missing items, then verify requests and delivery."}</p>
            <ul className="setup-checks">
              {[
                { label: "Catalog", complete: (data?.setup?.products ?? 0) > 0, detail: `${data?.setup?.products || 0} products` },
                { label: "Credential", complete: data?.setup?.credential_active, detail: "active integration credential" },
                { label: "Webhook", complete: data?.setup?.webhook_configured, detail: "registration saved" },
                { label: "Delivery", complete: data?.setup?.webhook_enabled, detail: "enabled; reachability unverified" },
              ].map(({ label, complete, detail }) => (
                <li key={label} className={complete ? "complete" : ""}>
                  <span className="setup-check-icon">{complete ? <CheckIcon /> : "—"}</span>
                  <span><strong>{label}</strong><small>{detail}</small></span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="dashboard-verification" aria-labelledby="dashboard-verification-title">
        <div className="dashboard-section-heading">
          <div>
            <h2 id="dashboard-verification-title">Verify the integration</h2>
            <p>Configuration alone does not prove that credentials, delivery, or external processing work.</p>
          </div>
          <p className="dashboard-data-note">Complete these checks in order.</p>
        </div>
        <ol className="verification-steps">
          <li><span className="verification-number">1</span><div><strong>Test a signed request</strong><p>Use the API Simulator with this shop’s provider and your saved credentials, then confirm a successful response.</p></div><button className="btn btn-primary btn-sm" disabled={!shopID} onClick={() => onTryOrders ? onTryOrders() : onNavigate("Documentation")}>Open API Simulator<ArrowRightIcon /></button></li>
          <li><span className="verification-number">2</span><div><strong>Trigger an order event</strong><p>Simulate a new order and inspect its event trail. Historical sample orders are not proof of webhook delivery.</p></div><button className="btn btn-ghost btn-sm" disabled={!shopID} onClick={() => onForm({ kind: "order" })}>Simulate order<ArrowRightIcon /></button></li>
          <li><span className="verification-number">3</span><div><strong>Confirm delivery and processing</strong><p>Inspect attempts for HTTP success, then confirm your application verified, stored, and processed the event once.</p></div><button className="btn btn-ghost btn-sm" disabled={!shopID} onClick={() => onNavigate("Deliveries")}>Inspect deliveries<ArrowRightIcon /></button></li>
        </ol>
      </section>

      <section className="dashboard-event-flow" aria-labelledby="event-flow-title">
        <div>
          <h2 id="event-flow-title">Follow an order from change to delivery</h2>
          <p>Every order change produces a durable event before webhook matching and delivery.</p>
        </div>
        <ol aria-label="Order event delivery flow">
          <li>Order state</li><li>Durable event</li><li>Matching webhook</li><li>Delivery log</li>
        </ol>
        <button className="btn btn-ghost btn-sm" disabled={!shopID} onClick={() => onNavigate("Orders")}>
          View orders and events<ArrowRightIcon />
        </button>
      </section>

      <details className="sample-reset">
        <summary>
          <span><strong>Reset sample data</strong><small>Optional destructive action</small></span>
          <ChevronDownIcon />
        </summary>
        <div>
          <p>This replaces shop data with 100 products and 50 historical orders. It deletes credentials, webhook registrations and delivery history, orders, packages, shipments, events, products and inventory. Warehouse definitions and scenario settings remain.</p>
          <button className="danger btn btn-error btn-soft" disabled={!shopID || isSeeding} onClick={() => void onSeed()}>{isSeeding ? "Resetting…" : "Reset shop to sample data"}</button>
        </div>
      </details>
      {role === "ADMIN" && <MaintenanceControl token={token} />}
    </div>
  );
}

function MaintenanceControl({ token }: { token: string | null | undefined }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return request<{ enabled: boolean }>("/control/v1/maintenance", token)
      .then((result) => setEnabled(Boolean(result.enabled)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const update = async (next: boolean) => {
    setSaving(true);
    setError("");
    try {
      const result = await request<{ enabled: boolean }>("/control/v1/maintenance", token, {
        method: "PUT",
        body: JSON.stringify({ enabled: next }),
      });
      setEnabled(Boolean(result.enabled));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={`maintenance-control card ${enabled ? "active" : ""}`}>
      <div>
        <h2>Maintenance mode <span className="admin-badge">Administrator</span></h2>
        <p>
          Return a documented 503 from the public API across every shop. Use it
          to validate maintenance handling, then turn it off again.
        </p>
        {error && <p className="error alert alert-error" role="alert">{error} <button onClick={() => void load()}>Retry maintenance status</button></p>}
      </div>
      <label className="maintenance-switch" aria-busy={loading || saving}>
        <span className="maintenance-switch-copy">
          <strong>{loading ? "Checking maintenance" : error ? "Maintenance status unavailable" : enabled ? "Public API paused" : "Maintenance disabled"}</strong>
          <small id="maintenance-status-detail">
            {loading
              ? "Checking current status…"
              : saving
                ? enabled
                  ? "Restoring public API…"
                  : "Pausing public API…"
                : enabled
                  ? "All public endpoints return HTTP 503"
                  : error ? "Retry loading the maintenance setting" : "No maintenance block; this is not an API health check"}
          </small>
        </span>
        <input
          className="toggle toggle-primary maintenance-toggle"
          type="checkbox"
          checked={enabled}
          disabled={loading || saving || Boolean(error)}
          aria-label={enabled ? "Disable maintenance mode" : "Enable maintenance mode"}
          aria-describedby="maintenance-status-detail"
          onChange={(event) => update(event.target.checked)}
        />
      </label>
    </section>
  );
}

interface ShopsProps {
  data: ControlPlaneData | null;
  onSelect: (shop: Shop) => void;
  onForm: (form: FormRequest) => void;
  listPage: number;
  onPageChange: (page: number) => void;
}

export function Shops({ data, onSelect, onForm, listPage, onPageChange }: ShopsProps) {
  const shops = (data?.data ?? []) as Shop[];
  return (
    <>
      <div className="page-hint alert alert-info">
        A shop isolates catalog data, credentials, webhook registrations, and
        failure scenarios for one integration participant.
      </div>
      <div className="table-toolbar">
        <button className="btn btn-primary" onClick={() => onForm({ kind: "shop" })}>+ New shop</button>
        <span>
          {shops.length} shop{shops.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="records">
        {shops.length ? (
          shops.map((shop) => (
            <button
              className="record shop card"
              key={shop.id}
              onClick={() => onSelect(shop)}
            >
              <span className="status-dot"></span>
              <span>
                <b>{shop.name}</b>
                <small>{shop.id}</small>
              </span>
              <em className={`provider-badge badge badge-secondary ${shop.provider_profile?.toLowerCase()}`}>
                {providerLabel(shop.provider_profile)}
              </em>
              <em>{shop.status}</em>
              <span>Open →</span>
            </button>
          ))
        ) : (
          <p className="empty">
            No shops yet. Create one, then return to the Dashboard runbook.
          </p>
        )}
      </div>
      <Pagination pagination={data?.pagination} page={listPage} onChange={onPageChange} />
    </>
  );
}
