import { useEffect, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { Pagination } from "./ResourcePage";

const request = (...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<any>(...args);

function providerLabel(profile: string) {
  return ({ SHOPEE_LIKE: "Shopee-like", TOKOPEDIA_LIKE: "Tokopedia & TikTok Shop" } as Record<string, string>)[profile] || "Shopee-like";
}

export function Dashboard({ data, shopID, token, role, onNavigate, onForm, onSeed, isSeeding }: any) {
  const steps = [
    [
      "1",
      "Create or choose a shop",
      "A shop scopes catalog data, credentials, scenarios, and webhook deliveries. Create one first when your console is empty.",
      Boolean(shopID),
      () => (shopID ? onNavigate("Shops") : onForm({ kind: "shop" })),
    ],
    [
      "2",
      "Prepare catalog",
      "Seed 100 products and 50 historical orders, or add products yourself.",
      false,
      onSeed,
    ],
    [
      "3",
      "Create API credential",
      "Save the client secret once; it signs requests from your integration.",
      false,
      () => onForm({ kind: "credential" }),
    ],
    [
      "4",
      "Register webhook",
      "Choose the order events your endpoint should receive.",
      false,
      () => onNavigate("Webhooks"),
    ],
    [
      "5",
      "Trigger an order event",
      "Simulate an order, then inspect its event and delivery trail.",
      false,
      () => onForm({ kind: "order" }),
    ],
  ];
  return (
    <>
      <div className="status-strip">
        <span>
          <i className="live"></i> Simulator online
        </span>
        <span>Follow the runbook from setup to delivery.</span>
      </div>
      <div className="metrics">
        {[
          ["Shops", data?.shops],
          ["Orders", data?.orders],
          ["Failed deliveries", data?.failed_deliveries],
        ].map(([label, value]) => (
          <article key={label}>
            <p>{label}</p>
            <strong>{value ?? "—"}</strong>
          </article>
        ))}
      </div>
      <section className="runbook">
        <div className="runbook-intro">
          <p className="eyebrow">Start here</p>
          <h2>Set up an integration in five deliberate moves.</h2>
          <p>
            A webhook registration is only a destination and event filter. Order
            changes create the events; the worker delivers matching events
            asynchronously.
          </p>
        </div>
        <ol>
          {steps.map(([number, title, description, complete, action]) => (
            <li key={number} className={complete ? "complete" : ""}>
              <span className="step-number">{complete ? "✓" : number}</span>
              <div>
                <b>{title}</b>
                <p>{description}</p>
              </div>
              <button
                className="quiet"
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
      <section className="setup-readiness" aria-label="Integration setup readiness">
        <div>
          <h2>Setup readiness</h2>
          <p>{data?.setup?.ready ? "This shop is ready for an end-to-end integration." : "Complete the remaining setup before triggering a delivery."}</p>
        </div>
        <div className="setup-checks">
          {[
            ["Seed data", data?.setup?.seeded, `${data?.setup?.products || 0} products`],
            ["Credential", data?.setup?.credential_active, "active integration credential"],
            ["Webhook", data?.setup?.webhook_configured, "registration saved"],
            ["Delivery enabled", data?.setup?.webhook_enabled, "endpoint can receive events"],
          ].map(([label, complete, detail]) => <div key={label} className={complete ? "complete" : ""}><b>{complete ? "Ready" : "Pending"}</b><span>{label}</span><small>{detail}</small></div>)}
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
        <button disabled={!shopID} onClick={() => onNavigate("Orders")}>
          View orders and events <span>→</span>
        </button>
      </section>
      {role === "ADMIN" && <MaintenanceControl token={token} />}
    </>
  );
}

function MaintenanceControl({ token }: any) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    request("/control/v1/maintenance", token)
      .then((result) => setEnabled(Boolean(result.enabled)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);
  const update = async (next: boolean) => {
    setSaving(true);
    setError("");
    try {
      const result = await request("/control/v1/maintenance", token, {
        method: "PUT",
        body: JSON.stringify({ enabled: next }),
      });
      setEnabled(Boolean(result.enabled));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={`maintenance-control ${enabled ? "active" : ""}`}>
      <div>
        <p className="eyebrow">Admin-only global control</p>
        <h2>Maintenance mode</h2>
        <p>
          Return a documented 503 from the public API across every shop. Use it
          to validate maintenance handling, then turn it off again.
        </p>
        {error && <p className="error">{error}</p>}
      </div>
      <label className="switch">
        <input
          type="checkbox"
          checked={enabled}
          disabled={loading || saving}
          onChange={(event) => update(event.target.checked)}
        />
        <span>{enabled ? "Maintenance enabled" : "Maintenance disabled"}</span>
      </label>
    </section>
  );
}

export function Shops({ data, onSelect, onForm, listPage, onPageChange }: any) {
  const shops = data?.data || [];
  return (
    <>
      <div className="page-hint">
        A shop isolates catalog data, credentials, webhook registrations, and
        failure scenarios for one integration participant.
      </div>
      <div className="table-toolbar">
        <button onClick={() => onForm({ kind: "shop" })}>+ New shop</button>
        <span>
          {shops.length} shop{shops.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="records">
        {shops.length ? (
          shops.map((shop: any) => (
            <button
              className="record shop"
              key={shop.id}
              onClick={() => onSelect(shop.id)}
            >
              <span className="status-dot"></span>
              <span>
                <b>{shop.name}</b>
                <small>{shop.id}</small>
              </span>
              <em className={`provider-badge ${shop.provider_profile?.toLowerCase()}`}>
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
