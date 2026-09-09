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
  return ({ SHOPEE_LIKE: "Shopee-like", TOKOPEDIA_LIKE: "Tokopedia & TikTok Shop" } as Record<string, string>)[profile] || "Shopee-like";
}

interface DashboardProps {
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

export function Dashboard({ data, shopID, token, role, onNavigate, onForm, onSeed, isSeeding }: DashboardProps) {
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
  return (
    <>
      <p className="page-hint">{data ? "Dashboard data loaded from the control API. Public API and webhook worker health are not verified here." : "Dashboard data has not loaded yet."}</p>
      <h2>All accessible shops</h2>
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
      <section className="runbook">
        <div className="runbook-intro card">
          <p className="eyebrow">Start here</p>
          <h2>Configure the selected shop, then verify your integration.</h2>
          <p>
            A webhook registration is only a destination and event filter. Order
            changes create the events; the worker delivers matching events
            asynchronously.
          </p>
        </div>
        <ol>
          {steps.map(({ number, title, description, complete, action, label }) => (
            <li key={number} className={complete ? "complete" : ""}>
              <span className="step-number">{complete ? "✓" : number}</span>
              <div>
                <b>{title}</b>
                <p>{description}</p>
              </div>
              <button
                className="quiet btn btn-ghost btn-sm"
                disabled={!shopID && number !== "1"}
                onClick={() => void action()}
              >
                {label}{" "}
                <span>→</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="setup-readiness card" aria-label="Integration setup readiness">
        <div>
          <h2>Selected shop configuration</h2>
          <p>{data?.setup?.ready ? "Configuration is present. Signed requests and receiver processing still need verification." : "Complete the remaining configuration, then verify requests and delivery."}</p>
        </div>
        <div className="setup-checks">
          {[
            { label: "Catalog", complete: (data?.setup?.products ?? 0) > 0, detail: `${data?.setup?.products || 0} products` },
            { label: "Credential", complete: data?.setup?.credential_active, detail: "active integration credential" },
            { label: "Webhook", complete: data?.setup?.webhook_configured, detail: "registration saved" },
            { label: "Delivery enabled", complete: data?.setup?.webhook_enabled, detail: "delivery enabled; reachability not verified" },
          ].map(({ label, complete, detail }) => <div key={label} className={complete ? "complete" : ""}><b>{complete ? "Configured" : "Missing"}</b><span>{label}</span><small>{detail}</small></div>)}
        </div>
      </section>
      <section className="runbook" aria-label="Integration verification">
        <h2>Verify the integration yourself</h2>
        <p>These checks are not tracked by the dashboard. A saved credential does not prove you have its secret, and a successful delivery does not prove your application processed it.</p>
        <ol>
          <li><div><b>Test your first signed request</b><p>Open the API Simulator, select this shop’s provider, and use your saved credentials. Shopee lists orders with GET orders; Tokopedia uses POST orders/search. Confirm a successful response.</p></div><button disabled={!shopID} onClick={() => onNavigate("Documentation")}>Test in API Simulator</button></li>
          <li><div><b>Trigger an order event</b><p>Simulate a new order and inspect its event trail. The 50 sample orders are completed historical records, not proof of webhook delivery.</p></div><button disabled={!shopID} onClick={() => onForm({ kind: "order" })}>Simulate order</button></li>
          <li><div><b>Verify delivery and processing</b><p>Inspect attempts for an HTTP success, then confirm your external application verified, stored, and processed the event once.</p></div><button disabled={!shopID} onClick={() => onNavigate("Deliveries")}>Inspect deliveries</button></li>
        </ol>
      </section>
      <section className="page-hint" aria-label="Sample data reset">
        <h2>Optional sample data reset</h2>
        <p>This replaces shop data with 100 products and 50 historical orders. It deletes credentials, webhook registrations and delivery history, orders, packages, shipments, events, products and inventory. Warehouse definitions and scenario settings remain. Add products above to keep existing data.</p>
        <button className="danger btn btn-error btn-soft" disabled={!shopID || isSeeding} onClick={() => void onSeed()}>{isSeeding ? "Resetting…" : "Reset shop to sample data"}</button>
      </section>
      <section className="flow-explainer">
        <p className="eyebrow">What happens after an order changes?</p>
        <div>
          <span>Order state</span>
          <i>→</i>
          <span>Durable event</span>
          <i>→</i>
          <span>Matching webhook</span>
          <i>→</i>
          <span>Delivery log</span>
        </div>
        <button className="btn btn-primary" disabled={!shopID} onClick={() => onNavigate("Orders")}>
          View orders and events <span>→</span>
        </button>
      </section>
      {role === "ADMIN" && <MaintenanceControl token={token} />}
    </>
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
        <p className="eyebrow">Admin-only global control</p>
        <h2>Maintenance mode</h2>
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
