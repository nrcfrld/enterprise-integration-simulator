import { useEffect, useState } from "react";
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
  action: () => void | Promise<void>;
}

export function Dashboard({ data, shopID, token, role, onNavigate, onForm, onSeed, isSeeding }: DashboardProps) {
  const steps: RunbookStep[] = [
    {
      number: "1",
      title: "Create or choose a shop",
      description: "A shop scopes catalog data, credentials, scenarios, and webhook deliveries. Create one first when your console is empty.",
      complete: Boolean(shopID),
      action: () => (shopID ? onNavigate("Shops") : onForm({ kind: "shop" })),
    },
    {
      number: "2",
      title: "Prepare catalog",
      description: "Seed 100 products and 50 historical orders, or add products yourself.",
      complete: false,
      action: onSeed,
    },
    {
      number: "3",
      title: "Create API credential",
      description: "Save the client secret once; it signs requests from your integration.",
      complete: false,
      action: () => onForm({ kind: "credential" }),
    },
    {
      number: "4",
      title: "Register webhook",
      description: "Choose the order events your endpoint should receive.",
      complete: false,
      action: () => onNavigate("Webhooks"),
    },
    {
      number: "5",
      title: "Trigger an order event",
      description: "Simulate an order, then inspect its event and delivery trail.",
      complete: false,
      action: () => onForm({ kind: "order" }),
    },
  ];
  return (
    <>
      <div className="status-strip alert alert-success">
        <span>
          <i className="live"></i> Simulator online
        </span>
        <span>Follow the runbook from setup to delivery.</span>
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
      <section className="runbook">
        <div className="runbook-intro card">
          <p className="eyebrow">Start here</p>
          <h2>Set up an integration in five deliberate moves.</h2>
          <p>
            A webhook registration is only a destination and event filter. Order
            changes create the events; the worker delivers matching events
            asynchronously.
          </p>
        </div>
        <ol>
          {steps.map(({ number, title, description, complete, action }) => (
            <li key={number} className={complete ? "complete" : ""}>
              <span className="step-number">{complete ? "✓" : number}</span>
              <div>
                <b>{title}</b>
                <p>{description}</p>
              </div>
              <button
                className="quiet btn btn-ghost btn-sm"
                disabled={(!shopID && number !== "1") || (title === "Prepare catalog" && isSeeding)}
                onClick={() => void action()}
              >
                {title === "Create or choose a shop"
                  ? shopID
                    ? "Open shops"
                    : "Create shop"
                  : title === "Register webhook"
                    ? "Configure"
                    : title === "Prepare catalog"
                      ? isSeeding ? "Seeding…" : "Seed data"
                      : "Continue"}{" "}
                <span>→</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="setup-readiness card" aria-label="Integration setup readiness">
        <div>
          <h2>Setup readiness</h2>
          <p>{data?.setup?.ready ? "This shop is ready for an end-to-end integration." : "Complete the remaining setup before triggering a delivery."}</p>
        </div>
        <div className="setup-checks">
          {[
            { label: "Seed data", complete: data?.setup?.seeded, detail: `${data?.setup?.products || 0} products` },
            { label: "Credential", complete: data?.setup?.credential_active, detail: "active integration credential" },
            { label: "Webhook", complete: data?.setup?.webhook_configured, detail: "registration saved" },
            { label: "Delivery enabled", complete: data?.setup?.webhook_enabled, detail: "endpoint can receive events" },
          ].map(({ label, complete, detail }) => <div key={label} className={complete ? "complete" : ""}><b>{complete ? "Ready" : "Pending"}</b><span>{label}</span><small>{detail}</small></div>)}
        </div>
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
  useEffect(() => {
    request<{ enabled: boolean }>("/control/v1/maintenance", token)
      .then((result) => setEnabled(Boolean(result.enabled)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);
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
        {error && <p className="error alert alert-error" role="alert">{error}</p>}
      </div>
      <label className="maintenance-switch" aria-busy={loading || saving}>
        <span className="maintenance-switch-copy">
          <strong>{enabled ? "Public API paused" : "Public API available"}</strong>
          <small id="maintenance-status-detail">
            {loading
              ? "Checking current status…"
              : saving
                ? enabled
                  ? "Restoring public API…"
                  : "Pausing public API…"
                : enabled
                  ? "All public endpoints return HTTP 503"
                  : "Public endpoints are accepting requests"}
          </small>
        </span>
        <input
          className="toggle toggle-primary maintenance-toggle"
          type="checkbox"
          checked={enabled}
          disabled={loading || saving}
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
  onSelect: (id: string) => void;
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
              onClick={() => onSelect(shop.id)}
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
