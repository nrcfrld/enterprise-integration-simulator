// Compatibility boundary while the control-plane's individual pages are migrated.
// New features, routing, and shared API code are strict TypeScript.
// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { DeveloperPortal } from "../developer-portal/DeveloperPortal";
import { LoginPage } from "../auth/LoginPage";
import { API_BASE_URL, controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { CONTROL_NAVIGATION, CONTROL_PATHS, PAGEABLE_CONTROL_PAGES, PAGE_BY_PATH } from "@/app/navigation";
import "../../styles.css";

const API = API_BASE_URL;
const navigation = CONTROL_NAVIGATION;
const webhookEvents = [
  "order.created",
  "order.paid",
  "order.processing",
  "order.ready_to_ship",
  "order.shipped",
  "order.in_delivery",
  "order.delivered",
  "order.completed",
  "order.cancelled",
  "product.created",
  "product.updated",
  "product.deleted",
];
const paths = CONTROL_PATHS;
const pagesByPath = PAGE_BY_PATH;
const pageablePages = PAGEABLE_CONTROL_PAGES;
const providerFilters = [
  ["ALL", "All providers"],
  ["SHOPEE_LIKE", "Shopee"],
  ["TOKOPEDIA_LIKE", "Tokopedia & TikTok Shop"],
];

const request = controlPlaneRequest;

function providerLabel(profile) {
  return (
    {
      SHOPEE_LIKE: "Shopee-like",
      TOKOPEDIA_LIKE: "Tokopedia & TikTok Shop",
    }[profile] || "Shopee-like"
  );
}

export function ControlPlaneApp() {
  const [session, setSession] = useState(() =>
    JSON.parse(localStorage.getItem("marketplace-session") || "null"),
  );
  const [shops, setShops] = useState([]);
  const [shopID, setShopID] = useState("");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [listPage, setListPage] = useState(1);
  const token = session?.token;
  const location = useLocation();
  const navigate = useNavigate();
  const page = pagesByPath[location.pathname] || "Dashboard";
  const visibleShops = useMemo(
    () =>
      page === "Orders" && providerFilter !== "ALL"
        ? shops.filter((shop) => shop.provider_profile === providerFilter)
        : shops,
    [page, providerFilter, shops],
  );
  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === shopID),
    [shopID, shops],
  );
  const endpoint = useMemo(
    () =>
      ({
        Dashboard: shopID ? `/control/v1/dashboard?shop_id=${shopID}` : "/control/v1/dashboard",
        Shops: "/control/v1/shops",
        Users: "/control/v1/users",
        Products: shopID && `/control/v1/shops/${shopID}/products`,
        Warehouses: shopID && `/control/v1/shops/${shopID}/warehouses`,
        Orders: shopID && `/control/v1/shops/${shopID}/orders`,
        Packages: shopID && `/control/v1/shops/${shopID}/packages`,
        Shipments: shopID && `/control/v1/shops/${shopID}/shipments`,
        Credentials: shopID && `/control/v1/shops/${shopID}/credentials`,
        Webhooks: shopID && `/control/v1/shops/${shopID}/webhooks`,
        Deliveries: shopID && `/control/v1/shops/${shopID}/deliveries`,
        Scenarios: shopID && `/control/v1/shops/${shopID}/scenario`,
      })[page],
    [page, shopID],
  );
  const route =
    endpoint && pageablePages.has(page)
      ? `${endpoint}?page=${listPage}&limit=20`
      : endpoint;
  const refreshShops = useCallback(async () => {
    const result = await request("/control/v1/shops", token);
    setShops(result.data);
    setShopID((current) => current || result.data[0]?.id || "");
  }, [token]);
  const refresh = useCallback(async () => {
    if (!route) {
      setData(null);
      return;
    }
    setData(await request(route, token));
  }, [route, token]);
  useEffect(() => {
    if (token)
      refreshShops().catch((error) =>
        setMessage({ type: "error", text: error.message }),
      );
  }, [token, refreshShops]);
  useEffect(() => {
    if (token)
      refresh().catch((error) =>
        setMessage({ type: "error", text: error.message }),
      );
  }, [token, refresh]);
  useEffect(() => {
    setDetail(null);
    setForm(null);
  }, [location.pathname]);
  useEffect(() => {
    const invalidate = () => {
      localStorage.removeItem("marketplace-session");
      setSession(null);
      setData(null);
      setShops([]);
      setShopID("");
      setProviderFilter("ALL");
    };
    window.addEventListener("marketplace:session-invalid", invalidate);
    return () => window.removeEventListener("marketplace:session-invalid", invalidate);
  }, []);
  useEffect(() => setListPage(1), [page, shopID]);
  if (!session)
    return (
      <LoginPage
        onLogin={(result) => {
          localStorage.setItem("marketplace-session", JSON.stringify(result));
          setSession(result);
          navigate(paths.Dashboard, { replace: true });
        }}
      />
    );
  const go = (next) => navigate(paths[next]);
  const notice = (text) => setMessage({ type: "success", text });
  const chooseOrderProvider = (profile) => {
    setProviderFilter(profile);
    if (profile === "ALL") return;
    const matching = shops.filter((shop) => shop.provider_profile === profile);
    setShopID((current) =>
      matching.some((shop) => shop.id === current) ? current : matching[0]?.id || "",
    );
  };
  const resetShop = async () => {
    if (!shopID || !window.confirm("Reset this shop to its seed data?")) return;
    const result = await request(`/control/v1/shops/${shopID}/reset`, token, {
      method: "POST",
    });
    await refresh();
    notice(
      `Seed complete: ${result.products_seeded} products and ${result.orders_seeded} orders. Create a credential from Credentials when you need a new one-time secret.`,
    );
  };
  const logout = () => {
    localStorage.removeItem("marketplace-session");
    setSession(null);
  };
  const isDocumentation = page === "Documentation";
  return (
    <main className={isDocumentation ? "documentation-shell" : "app-shell"}>
      {!isDocumentation && <aside>
        <div className="brand">
          <span className="signal"></span>
          <span>
            MARKET
            <br />
            OPS
          </span>
        </div>
        <nav className="sidebar-navigation" aria-label="Primary navigation">
          {navigation.map((section) => (
            <div className="navigation-section" key={section.label}>
              <p className="nav-label">{section.label}</p>
              {section.items.map((item) => (
                <Link
                  key={item.label}
                  to={paths[item.page]}
                  title={item.description}
                  className={
                    page === item.page && item.showActiveState !== false
                      ? "active"
                      : ""
                  }
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="profile">
          <span>{session.user.email}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>}
      <section className={`workspace ${isDocumentation ? "documentation-workspace" : ""}`}>
        {!isDocumentation && <header>
          <div>
            <p className="eyebrow">
              {page === "Dashboard" ? "Integration runbook" : "Control plane"}
            </p>
            <h1>{page}</h1>
          </div>
          <div className="header-actions">
            {page === "Orders" && (
              <div className="provider-switcher" aria-label="Order provider filter">
                <span>Provider</span>
                <div role="group" aria-label="Filter orders by provider">
                  {providerFilters.map(([profile, label]) => (
                    <button
                      key={profile}
                      type="button"
                      className={providerFilter === profile ? "active" : ""}
                      aria-pressed={providerFilter === profile}
                      onClick={() => chooseOrderProvider(profile)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="shop-selector">
              <span>{page === "Orders" ? "Order scope" : "Current shop"}</span>
              <select
                aria-label="Current shop"
                value={shopID}
                onChange={(event) => setShopID(event.target.value)}
              >
                <option value="">{page === "Orders" ? "Select a provider shop" : "Select a shop"}</option>
                {visibleShops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {page === "Orders" ? `[${providerLabel(shop.provider_profile)}] ` : ""}{shop.name}
                  </option>
                ))}
              </select>
            </label>
            {page === "Orders" && selectedShop && (
              <span className={`provider-badge ${selectedShop.provider_profile?.toLowerCase()}`}>
                {providerLabel(selectedShop.provider_profile)}
              </span>
            )}
          </div>
        </header>}
        {message && (
          <p className={`toast ${message.type}`} role="alert">
            {message.text}
            <button onClick={() => setMessage(null)}>×</button>
          </p>
        )}
        <section className={`content ${isDocumentation ? "documentation-content" : ""}`}>
          <AppRoutes
            data={data}
            shopID={shopID}
            token={token}
            role={session.user.role}
            onNavigate={go}
            onForm={setForm}
            onSeed={resetShop}
            onDetail={setDetail}
            onRefresh={refresh}
            onNotice={notice}
            onSelectShop={(id) => {
              setShopID(id);
              go("Products");
            }}
            listPage={listPage}
            onPageChange={setListPage}
          />
        </section>
        {form && (
          <ControlForm
            key={`${form.kind}-${form.initial?.id || "new"}`}
            kind={form.kind}
            initial={form.initial}
            shopID={shopID}
            token={token}
            onClose={() => setForm(null)}
            onSaved={async (text) => {
              setForm(null);
              await refreshShops();
              await refresh();
              notice(text);
            }}
          />
        )}
        {detail && (
          <DetailPanel
            detail={detail}
            token={token}
            onClose={() => setDetail(null)}
            onRefresh={refresh}
            onNotice={notice}
          />
        )}
      </section>
    </main>
  );
}

function AppRoutes({
  data,
  shopID,
  token,
  role,
  onNavigate,
  onForm,
  onSeed,
  onDetail,
  onRefresh,
  onNotice,
  onSelectShop,
  listPage,
  onPageChange,
}) {
  const resourceProps = {
    data,
    shopID,
    token,
    role,
    onForm,
    onDetail,
    onRefresh,
    onNotice,
    onSeed,
  };
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to={paths.Dashboard} />} />
      <Route
        path={paths.Dashboard}
        element={
          <Dashboard
            data={data}
            shopID={shopID}
            token={token}
            role={role}
            onNavigate={onNavigate}
            onForm={onForm}
            onSeed={onSeed}
          />
        }
      />
      <Route
        path={paths.Documentation}
        element={<Documentation onNavigate={onNavigate} />}
      />
      <Route
        path={paths.Scenarios}
        element={
          <Scenario
            token={token}
            shopID={shopID}
            data={data}
            onSaved={() => {
              onRefresh();
              onNotice("Scenario updated");
            }}
          />
        }
      />
      <Route
        path={paths.Shops}
        element={<Shops data={data} onSelect={onSelectShop} onForm={onForm} listPage={listPage} onPageChange={onPageChange} />}
      />
      <Route
        path={paths.Webhooks}
        element={
          <WebhookSettings
            data={data}
            shopID={shopID}
            token={token}
            onForm={onForm}
            onRefresh={onRefresh}
            onNotice={onNotice}
          />
        }
      />
      {["Products", "Warehouses", "Credentials", "Orders", "Packages", "Shipments", "Deliveries", "Users"].map(
        (resource) => (
          <Route
            key={resource}
            path={paths[resource]}
            element={<ResourcePage page={resource} {...resourceProps} listPage={listPage} onPageChange={onPageChange} />}
          />
        ),
      )}
      <Route path="*" element={<Navigate replace to={paths.Dashboard} />} />
    </Routes>
  );
}

function Dashboard({ data, shopID, token, role, onNavigate, onForm, onSeed }) {
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
                disabled={!shopID && number !== "1"}
                onClick={action}
              >
                {title === "Create or choose a shop"
                  ? shopID
                    ? "Open shops"
                    : "Create shop"
                  : title === "Register webhook"
                    ? "Configure"
                    : title === "Prepare catalog"
                      ? "Seed data"
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

function MaintenanceControl({ token }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    request("/control/v1/maintenance", token)
      .then((result) => setEnabled(Boolean(result.enabled)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);
  const update = async (next) => {
    setSaving(true);
    setError("");
    try {
      const result = await request("/control/v1/maintenance", token, {
        method: "PUT",
        body: JSON.stringify({ enabled: next }),
      });
      setEnabled(Boolean(result.enabled));
    } catch (err) {
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

function Shops({ data, onSelect, onForm, listPage, onPageChange }) {
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
          shops.map((shop) => (
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

function ResourcePage({
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
  listPage,
  onPageChange,
}) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  const action = {
    Products: ["product", "New product"],
    Warehouses: ["warehouse", "New warehouse"],
    Orders: ["order", "Simulate order"],
    Packages: ["package", "Allocate package"],
    Credentials: ["credential", "New credential"],
    Users: role === "ADMIN" ? ["user", "New user"] : null,
  }[page];
  const retry = async (id) => {
    await request(`/control/v1/deliveries/${id}/retry`, token, {
      method: "POST",
    });
    await onRefresh();
    onNotice("Delivery queued for retry");
  };
  return (
    <>
      <div className="page-hint">
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
          <button onClick={() => onForm({ kind: action[0] })}>
            + {action[1]}
          </button>
        )}
        {page === "Products" && role === "ADMIN" && (
          <button className="danger" onClick={onSeed}>
            Reset to seed
          </button>
        )}
        <span>
          {rows.length} record{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="table-wrap">
        {rows.length ? (
          <table className="records-table">
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
                      {String(row[key] ?? "—")}
                    </td>
                  ))}
                  <td className="row-actions" data-label="Actions">
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
                        <button onClick={() => retry(row.id)}>Retry</button>
                      </>
                    )}
                    {page === "Credentials" && row.status === "ACTIVE" && (
                      <button
                        onClick={async () => {
                          await request(
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

function Pagination({ pagination, page, onChange }) {
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
        <button className="quiet" disabled={current <= 1} onClick={() => onChange(current - 1)}>
          Previous
        </button>
        <button disabled={current >= totalPages} onClick={() => onChange(current + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}
function columns(row, page) {
  if (page === "Warehouses") return ["code", "name", "status", "priority", "product_count", "available_quantity"];
  if (page === "Deliveries") return ["event_type", "endpoint", "status", "attempt_count", "next_attempt_at", "failure_reason"];
  if (page === "Shipments") return ["order_number", "tracking_number", "shipping_provider", "pickup_type", "status", "created_at", "shipped_at"];
  if (page === "Packages") return ["order_number", "status", "item_count", "created_at"];
  return Object.keys(row)
    .filter((key) => typeof row[key] !== "object")
    .slice(0, 7);
}

function WebhookSettings({ data, shopID, token, onForm, onRefresh, onNotice }) {
  const hooks = data?.data || [];
  const remove = async (id) => {
    if (
      !window.confirm(
        "Delete this webhook registration? Existing delivery history remains.",
      )
    )
      return;
    await request(`/control/v1/shops/${shopID}/webhooks/${id}`, token, {
      method: "DELETE",
    });
    await onRefresh();
    onNotice("Webhook registration deleted");
  };
  const toggle = async (hook) => {
    await request(`/control/v1/shops/${shopID}/webhooks/${hook.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        url: hook.url,
        subscribed_events: hook.subscribed_events,
        enabled: !hook.enabled,
      }),
    });
    await onRefresh();
    onNotice(`Webhook ${hook.enabled ? "disabled" : "enabled"}`);
  };
  if (!shopID)
    return (
      <p className="empty">
        Choose a shop first. A webhook belongs to one shop and only receives
        that shop’s events.
      </p>
    );
  return (
    <>
      <section className="webhook-explainer">
        <p className="eyebrow">Registration settings</p>
        <h2>Tell the simulator where to send matching events.</h2>
        <p>
          Creating a webhook does not create an event. An order transition
          creates an event; this registration decides whether it is delivered to
          your endpoint.
        </p>
        <button onClick={() => onForm({ kind: "webhook" })}>
          + Register webhook <span>→</span>
        </button>
      </section>
      <div className="webhook-list">
        {hooks.length ? (
          hooks.map((hook) => (
            <article key={hook.id} className={!hook.enabled ? "disabled" : ""}>
              <div className="webhook-head">
                <div>
                  <span className={`state ${hook.enabled ? "on" : "off"}`}>
                    {hook.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <h3>{hook.url}</h3>
                  <small>{hook.id}</small>
                </div>
                <div className="row-actions">
                  <button
                    className="quiet"
                    onClick={() => onForm({ kind: "webhook", initial: hook })}
                  >
                    Edit
                  </button>
                  <button className="quiet" onClick={() => toggle(hook)}>
                    {hook.enabled ? "Disable" : "Enable"}
                  </button>
                  <button className="danger" onClick={() => remove(hook.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <p className="subscription-label">
                Subscribed order/product events
              </p>
              <div className="event-chips">
                {hook.subscribed_events?.map((event) => (
                  <span key={event}>{event}</span>
                ))}
              </div>
            </article>
          ))
        ) : (
          <p className="empty">
            No webhook is registered yet. Use the runbook to add a destination
            before triggering an order.
          </p>
        )}
      </div>
    </>
  );
}

function ControlForm({ kind, initial, shopID, token, onClose, onSaved }) {
  const [values, setValues] = useState({
    status: "ACTIVE",
    provider_profile: "SHOPEE_LIKE",
    role: "OPERATOR",
    enabled: true,
    subscribed_events: webhookEvents.filter((event) =>
      event.startsWith("order."),
    ),
    customer_name: "",
    customer_phone: "",
    address_line: "",
    city: "Jakarta",
    postal_code: "",
    items: [{ product_id: "", quantity: 1 }],
    warehouse_inventory: [{ warehouse_id: "", on_hand_quantity: 0 }],
    address_line: initial?.address?.address_line || "",
    city: initial?.address?.city || "Jakarta",
    postal_code: initial?.address?.postal_code || "",
    ...initial,
  });
  const [orderMode, setOrderMode] = useState("random");
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [error, setError] = useState("");
  const fields =
    {
      shop: [["name", "Shop name"], ["provider_profile", "Marketplace behavior"]],
      package: [["order_id", "Order ID"], ["order_item_id", "Order item ID"], ["quantity", "Quantity", "number"]],
      product: [
        ["sku", "SKU"],
        ["name", "Name"],
        ["category", "Category"],
        ["description", "Description"],
        ["price", "Price (minor unit)", "number"],
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
    }[kind] || [];
  const update = (key, value) =>
    setValues((current) => ({ ...current, [key]: value }));
  const updateOrderItem = (index, key, value) =>
    setValues((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  const removeOrderItem = (index) =>
    setValues((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  useEffect(() => {
    if (kind !== "order" || orderMode !== "custom" || !shopID) return;
    setProductsLoading(true);
    request(`/control/v1/shops/${shopID}/products?limit=100`, token)
      .then((result) => setProducts(result.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setProductsLoading(false));
  }, [kind, orderMode, shopID, token]);
  useEffect(() => {
    if (kind !== "product" || !shopID) return;
    setWarehousesLoading(true);
    request(`/control/v1/shops/${shopID}/warehouses?limit=100`, token)
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
      .catch((err) => setError(err.message))
      .finally(() => setWarehousesLoading(false));
  }, [kind, shopID, token]);
  const submit = async (event) => {
    event.preventDefault();
    try {
      let path = "";
      let method = "POST";
      let body = { ...values };
      if (kind === "shop") path = "/control/v1/shops";
      if (kind === "product") {
        const warehouseInventory = (body.warehouse_inventory || []).map((allocation) => ({
          warehouse_id: allocation.warehouse_id,
          on_hand_quantity: Number(allocation.on_hand_quantity),
        }));
        if (!warehouseInventory.length || warehouseInventory.some((allocation) => !allocation.warehouse_id || allocation.on_hand_quantity < 0)) {
          throw new Error("Choose at least one warehouse and enter a non-negative quantity.");
        }
        path = `/control/v1/shops/${shopID}/products`;
        body = {
          ...body,
          price: Number(body.price),
          stock: warehouseInventory.reduce((total, allocation) => total + allocation.on_hand_quantity, 0),
          warehouse_inventory: warehouseInventory,
        };
      }
      if (kind === "warehouse") {
        path = initial ? `/control/v1/warehouses/${initial.id}` : `/control/v1/shops/${shopID}/warehouses`;
        method = initial ? "PATCH" : "POST";
        body = {
          code: body.code,
          name: body.name,
          status: body.status || "ACTIVE",
          priority: Number(body.priority || 0),
          address: {
            address_line: body.address_line.trim(),
            city: body.city.trim(),
            postal_code: body.postal_code.trim(),
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
      const result = await request(path, token, {
        method,
        body: JSON.stringify(body),
      });
      const secret = result.client_secret || result.secret;
      await onSaved(
        secret
          ? `Created. Save this secret now: ${secret}`
          : initial
            ? "Webhook registration updated"
            : `${kind} created`,
      );
    } catch (err) {
      setError(err.message);
    }
  };
  const title =
    kind === "order"
      ? "Simulate an order event"
      : kind === "warehouse" && initial
        ? "Edit warehouse"
      : kind === "credential"
        ? "Create API credential"
        : kind === "webhook"
          ? initial
            ? "Edit webhook registration"
            : "Register webhook destination"
          : `Create ${kind}`;
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Control plane action</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
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
                className={orderMode === "random" ? "selected" : "quiet"}
                onClick={() => setOrderMode("random")}
              >
                Random order
              </button>
              <button
                type="button"
                className={orderMode === "custom" ? "selected" : "quiet"}
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
                    className="quiet"
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
                        className="quiet"
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
        {kind === "product" && (
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
                      aria-label={`Initial quantity for warehouse ${index + 1}`}
                      type="number"
                      min="0"
                      required
                      value={allocation.on_hand_quantity}
                      onChange={(event) => setValues((current) => ({ ...current, warehouse_inventory: current.warehouse_inventory.map((item, itemIndex) => itemIndex === index ? { ...item, on_hand_quantity: event.target.value } : item) }))}
                    />
                    {values.warehouse_inventory.length > 1 && (
                      <button type="button" className="quiet" onClick={() => setValues((current) => ({ ...current, warehouse_inventory: current.warehouse_inventory.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                    )}
                  </div>
                ))}
                <div className="inventory-allocation-footer">
                  <button type="button" className="quiet" disabled={values.warehouse_inventory.length >= warehouses.length} onClick={() => setValues((current) => ({ ...current, warehouse_inventory: [...current.warehouse_inventory, { warehouse_id: "", on_hand_quantity: 0 }] }))}>+ Add warehouse</button>
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
            <p>
              Choose the events this endpoint should receive. It does not emit
              events itself.
            </p>
            <label>
              Endpoint URL
              <input
                required
                type="url"
                value={values.url || ""}
                placeholder="https://example.test/webhooks/marketplace"
                onChange={(event) => update("url", event.target.value)}
              />
            </label>
            <label>
              Replace secret (optional)
              <input
                value={values.secret || ""}
                placeholder={
                  initial
                    ? "Leave blank to keep the current secret"
                    : "Leave blank to generate one"
                }
                onChange={(event) => update("secret", event.target.value)}
              />
            </label>
            <fieldset className="event-selector">
              <legend>Subscribed events</legend>
              {webhookEvents.map((eventName) => (
                <label key={eventName}>
                  <input
                    type="checkbox"
                    checked={values.subscribed_events.includes(eventName)}
                    onChange={(event) =>
                      update(
                        "subscribed_events",
                        event.target.checked
                          ? [...values.subscribed_events, eventName]
                          : values.subscribed_events.filter(
                              (item) => item !== eventName,
                            ),
                      )
                    }
                  />
                  {eventName}
                </label>
              ))}
            </fieldset>
            {initial && (
              <label className="switch">
                <input
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
                value={values[key] || "OPERATOR"}
                onChange={(event) => update(key, event.target.value)}
              >
                <option>OPERATOR</option>
                <option>ADMIN</option>
              </select>
            ) : key === "status" ? (
              <select
                value={values[key] || "ACTIVE"}
                onChange={(event) => update(key, event.target.value)}
              >
                <option value="ACTIVE">ACTIVE — eligible for new orders</option>
                <option value="INACTIVE">INACTIVE — keep stock, stop new allocation</option>
              </select>
            ) : key === "provider_profile" ? (
              <select
                value={values[key] || "SHOPEE_LIKE"}
                onChange={(event) => update(key, event.target.value)}
              >
                <option value="SHOPEE_LIKE">SHOPEE_LIKE — payment, SLA, cancellation policy</option>
                <option value="TOKOPEDIA_LIKE">TOKOPEDIA_LIKE — Tokopedia & Shop / TikTok Shop contract</option>
              </select>
            ) : (
              <input
                type={type}
                required={key !== "description"}
                value={values[key] || ""}
                onChange={(event) => update(key, event.target.value)}
              />
            )}
          </label>
        ))}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="quiet" onClick={onClose}>
            Cancel
          </button>
          <button>
            {initial ? (kind === "warehouse" ? "Save warehouse" : "Save settings") : "Create"} <span>→</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function DetailPanel({ detail, token, onClose, onRefresh, onNotice }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [inventoryDrafts, setInventoryDrafts] = useState({});
  const [newInventory, setNewInventory] = useState({ product_id: "", on_hand_quantity: 0 });
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
      .catch((err) => setError(err.message));
  }, [detailPath, token]);
  useEffect(() => {
    if (detail.type !== "warehouse" || !data?.shop_id) return;
    request(`/control/v1/shops/${data.shop_id}/products?limit=100`, token)
      .then((result) => setCatalogProducts(result.data || []))
      .catch((err) => setError(err.message));
  }, [data?.shop_id, detail.type, token]);
  const saveInventory = async (productID, onHandQuantity) => {
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
      setNewInventory((current) => current.product_id === productID ? { product_id: "", on_hand_quantity: 0 } : current);
      await onRefresh();
      onNotice("Warehouse inventory updated");
    } catch (err) {
      setError(err.message);
    }
  };
  const transition = async (action) => {
    await request(`/control/v1/orders/${detail.id}/actions/${action}`, token, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setData(await request(`/control/v1/orders/${detail.id}`, token));
    await onRefresh();
    onNotice(`Order ${action} complete`);
  };
  const shipmentTransition = async (action) => {
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
    } catch (err) {
      setError(err.message);
    }
  };
  const replay = async (id) => {
    await request(`/control/v1/events/${id}/replay`, token, { method: "POST" });
    setData(await request(`/control/v1/orders/${detail.id}`, token));
    await onRefresh();
    onNotice("Event replay queued");
  };
  const duplicate = async (id) => {
    await request(`/control/v1/events/${id}/duplicate`, token, {
      method: "POST",
    });
    setData(await request(`/control/v1/orders/${detail.id}`, token));
    await onRefresh();
    onNotice("Duplicate webhook delivery queued");
  };
  const delay = async (id) => {
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
  const shipmentActions = {
    CREATED: [["ship", "Mark as shipped"]],
    SHIPPED: [["in_delivery", "Start delivery"]],
    IN_DELIVERY: [
      ["deliver", "Mark as delivered"],
      ["delivery_failed", "Report delivery failure"],
    ],
    DELIVERY_FAILED: [["return_to_sender", "Start return to seller"]],
    RETURNING: [["complete_return", "Mark as returned"]],
  };
  const nextShipmentAction = shipmentActions[
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
                  data.items.map((item) => (
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
              data.events.map((event) => (
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
              data.deliveries.map((delivery) => (
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
                {data.items?.map((item) => (
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
                  <tbody>{data.inventory.map((item) => <tr key={item.product_id}><td>{item.sku}</td><td>{item.product_name}</td><td>{item.on_hand_quantity}</td><td>{item.reserved_quantity}</td><td>{item.available_quantity}</td><td><form className="inventory-adjustment" onSubmit={(event) => { event.preventDefault(); saveInventory(item.product_id, inventoryDrafts[item.product_id] ?? item.on_hand_quantity); }}><input aria-label={`On hand quantity for ${item.product_name}`} type="number" min={item.reserved_quantity} value={inventoryDrafts[item.product_id] ?? item.on_hand_quantity} onChange={(event) => setInventoryDrafts((current) => ({ ...current, [item.product_id]: event.target.value }))} /><button>Save</button></form></td></tr>)}</tbody>
                </table>
              </div>
            ) : (
              <p className="empty compact">No product inventory is assigned to this warehouse.</p>
            )}
            <form className="inventory-addition" onSubmit={(event) => { event.preventDefault(); saveInventory(newInventory.product_id, newInventory.on_hand_quantity); }}>
              <label>Add a product to this warehouse<select required value={newInventory.product_id} onChange={(event) => setNewInventory((current) => ({ ...current, product_id: event.target.value }))}><option value="">Choose product</option>{catalogProducts.filter((product) => !data.inventory?.some((item) => item.product_id === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
              <label>On-hand quantity<input type="number" min="0" required value={newInventory.on_hand_quantity} onChange={(event) => setNewInventory((current) => ({ ...current, on_hand_quantity: event.target.value }))} /></label>
              <button disabled={!newInventory.product_id}>Add inventory</button>
            </form>
          </>
        )}
        {data && detail.type === "delivery" && (
          <>
            <p>
              Status: <b>{data.status}</b> · {data.attempt_count} attempts
            </p>
            {data.attempts?.map((attempt) => (
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

function Scenario({ token, shopID, data, onSaved }) {
  const [form, setForm] = useState(data || {});
  useEffect(() => setForm(data || {}), [data]);
  if (!shopID)
    return (
      <p className="empty">Choose a shop before configuring fault injection.</p>
    );
  const save = async () => {
    await request(`/control/v1/shops/${shopID}/scenario`, token, {
      method: "PUT",
      body: JSON.stringify(form),
    });
    onSaved();
  };
  const fields = [
    {
      key: "api_slow_ms",
      label: "API slow response (ms)",
      help: "Tambahkan waktu tunggu ini ketika skenario slow response terpicu. Gunakan bersama probabilitas slow response.",
    },
    {
      key: "api_slow_probability",
      label: "Slow response probability (%)",
      help: "Persentase request public API yang akan diberi delay. Nilai 100 berarti setiap request melambat.",
    },
    {
      key: "api_random_500_probability",
      label: "Random 500 (%)",
      help: "Persentase request public API yang langsung menerima HTTP 500 ter-simulasi. Gunakan untuk menguji retry dan error handling client.",
    },
    {
      key: "api_timeout_probability",
      label: "Timeout (%)",
      help: "Persentase request public API yang ditahan selama 35 detik. Gunakan untuk menguji timeout client dan pembatalan request.",
    },
    {
      key: "webhook_delay_seconds",
      label: "Webhook delay (s)",
      help: "Menunda job webhook sebelum dikirim. Nilai ini juga digunakan untuk membuat event order.paid terlambat saat out-of-order aktif.",
    },
  ];
  const flags = [
    {
      key: "force_rate_limit",
      label: "Force rate limit",
      help: "Paksa request public API menerima respons rate limit untuk memeriksa backoff dan penghormatan header rate-limit pada client.",
    },
    {
      key: "webhook_duplicate",
      label: "Duplicate webhook",
      help: "Buat dua delivery untuk event yang sama. Penerima webhook harus melakukan deduplikasi berdasarkan event id.",
    },
    {
      key: "webhook_out_of_order",
      label: "Out-of-order webhook",
      help: "Tunda event order.paid agar event setelahnya dapat tiba lebih dulu. Gunakan untuk menguji state machine penerima.",
    },
    {
      key: "webhook_force_failure",
      label: "Force webhook failure",
      help: "Paksa attempt delivery gagal sebelum HTTP request dibuat. Delivery akan tercatat gagal lalu mengikuti retry terjadwal.",
    },
  ];
  return (
    <article className="scenario">
      <p className="eyebrow">Fault injection</p>
      <h2>Turn the happy path off.</h2>
      <div className="field-grid">
        {fields.map(({ key, label, help }) => {
          const helpID = `scenario-help-${key}`;
          return <div className="scenario-field" key={key}>
            <div className="scenario-label-row">
              <label htmlFor={`scenario-${key}`}>{label}</label>
              <ScenarioHelp id={helpID} label={label}>{help}</ScenarioHelp>
            </div>
            <input
              id={`scenario-${key}`}
              type="number"
              min="0"
              value={form[key] ?? 0}
              aria-describedby={helpID}
              onChange={(event) =>
                setForm({ ...form, [key]: Number(event.target.value) })
              }
            />
          </div>;
        })}
      </div>
      <div className="toggles">
        {flags.map(({ key, label, help }) => {
          const helpID = `scenario-help-${key}`;
          return <div className="scenario-toggle" key={key}>
            <label htmlFor={`scenario-${key}`}>
              <input
                id={`scenario-${key}`}
                type="checkbox"
                checked={Boolean(form[key])}
                aria-describedby={helpID}
                onChange={(event) =>
                  setForm({ ...form, [key]: event.target.checked })
                }
              />
              {label}
            </label>
            <ScenarioHelp id={helpID} label={label}>{help}</ScenarioHelp>
          </div>;
        })}
      </div>
      <button onClick={save}>
        Apply scenario <span>→</span>
      </button>
    </article>
  );
}

function ScenarioHelp({ id, label, children }) {
  return (
    <details className="scenario-help">
      <summary aria-label={`Penjelasan: ${label}`} title={`Penjelasan ${label}`}>
        ?
      </summary>
      <span id={id} role="note">{children}</span>
    </details>
  );
}

function Documentation({ onNavigate }) {
  return <DeveloperPortal api={API} onNavigate={onNavigate} />;
}

function LegacyDocumentation({ onNavigate }) {
  const copy = async (value) => {
    await navigator.clipboard.writeText(value);
  };
  const signing = "canonical = METHOD + PATH + TIMESTAMP + RAW_BODY\nsignature = hex(HMAC-SHA256(canonical, CLIENT_SECRET))";
  const verification = 'hex(HMAC-SHA256(TIMESTAMP + "." + RAW_BODY, WEBHOOK_SECRET))';
  return (
    <div className="docs">
      <section className="docs-hero">
        <p className="eyebrow">Developer guide</p>
        <h2>
          Go from credential to verified webhook without reading the source.
        </h2>
        <p>
          This guide names the exact headers, signing rules, delivery contract,
          and failure behavior that an integration needs.
        </p>
        <div>
          <a href={`${API}/openapi.yaml`} target="_blank" rel="noreferrer">
            Open OpenAPI specification ↗
          </a>
          <a
            href={`${API}/swagger/index.html`}
            target="_blank"
            rel="noreferrer"
          >
            Try API in Swagger ↗
          </a>
          <button onClick={() => onNavigate("Dashboard")}>
            Open integration runbook <span>→</span>
          </button>
        </div>
      </section>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Documentation contents">
          <p>On this page</p>
          <a href="#quick-start">Quick start</a>
          <a href="#signing">Request signing</a>
          <a href="#webhooks">Webhook verification</a>
          <a href="#pagination">Pagination &amp; errors</a>
          <a href="#failures">Failure scenarios</a>
        </nav>
        <div className="docs-content">
          <section id="quick-start" className="docs-section">
            <p className="eyebrow">Quick start</p>
            <h3>Four moves to a working integration</h3>
            <ol className="docs-steps">
              <li>
                <b>Create or select a shop.</b>
                <span>Everything in the simulator is isolated by shop.</span>
              </li>
              <li>
                <b>Seed the catalog, then create a credential.</b>
                <span>
                  Save the client secret immediately—it is intentionally shown
                  only once.
                </span>
              </li>
              <li>
                <b>Register a webhook destination.</b>
                <span>
                  Select the event types your endpoint wants to receive.
                </span>
              </li>
              <li>
                <b>Simulate an order and inspect its event trail.</b>
                <span>
                  Orders create durable events; matching registrations receive
                  deliveries asynchronously.
                </span>
              </li>
            </ol>
            <div className="docs-actions">
              <button onClick={() => onNavigate("Credentials")}>
                Create credential <span>→</span>
              </button>
              <button className="quiet" onClick={() => onNavigate("Webhooks")}>
                Configure webhook
              </button>
            </div>
          </section>
          <article id="signing" className="docs-section">
            <p className="eyebrow">Public API</p>
            <h3>Sign every request using the raw body.</h3>
            <p>
              The canonical string has no separators: method, URL path, Unix
              timestamp in seconds, then the exact raw body bytes.
            </p>
            <CodeBlock value={signing} onCopy={copy} />
            <p>
              Set <code>X-Client-Id</code>, <code>X-Timestamp</code>, and{" "}
              <code>X-Signature</code>. State-changing calls also need{" "}
              <code>Idempotency-Key</code>.
            </p>
            <div className="docs-callout">
              <b>Required headers</b>
              <span>
                Mutations must include a unique <code>Idempotency-Key</code>;
                retain it to replay the same mutation safely.
              </span>
            </div>
            <pre className="code-example">
              POST /api/v1/webhooks{"\n"}
              X-Client-Id: client_xxx{"\n"}
              X-Timestamp: 1760000000{"\n"}
              X-Signature: &lt;hex hmac&gt;{"\n"}
              Idempotency-Key: webhook-register-001{"\n"}
              Content-Type: application/json{"\n\n"}
              {
                '{"url":"https://example.test/webhooks","subscribed_events":["product.updated"]}'
              }
            </pre>
            <p className="docs-note">
              Timestamps outside a five-minute window are rejected.
            </p>
          </article>
          <article id="webhooks" className="docs-section">
            <p className="eyebrow">Webhook contract</p>
            <h3>Verify the event before processing it.</h3>
            <CodeBlock value={verification} onCopy={copy} />
            <p>
              Use <code>X-Marketplace-Event-Id</code> as your durable
              idempotency key. A 2xx response succeeds; failures retry after
              30s, 2m, 10m, and 30m.
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Header</th>
                    <th>Use it for</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>X-Marketplace-Event</code>
                    </td>
                    <td>
                      The event type, such as <code>order.created</code>.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>X-Marketplace-Event-Id</code>
                    </td>
                    <td>Your durable idempotency key for the event.</td>
                  </tr>
                  <tr>
                    <td>
                      <code>X-Marketplace-Timestamp</code>
                    </td>
                    <td>The Unix timestamp used in the signature.</td>
                  </tr>
                  <tr>
                    <td>
                      <code>X-Marketplace-Signature</code>
                    </td>
                    <td>
                      Hex HMAC-SHA256 signature of the timestamp and raw body.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
          <article id="pagination" className="docs-section">
            <p className="eyebrow">Reading data</p>
            <h3>Keep pagination parameters stable.</h3>
            <p>
              List endpoints return <code>data</code> and a{" "}
              <code>pagination</code> object. Pass its opaque{" "}
              <code>next_cursor</code> back with the same sort and direction;
              changing either rejects the cursor.
            </p>
            <div className="docs-callout">
              <b>Common responses</b>
              <span>
                <code>401</code> invalid, expired, or incorrectly signed request
                · <code>429</code> rate limit (observe{" "}
                <code>X-RateLimit-Reset</code>) · <code>503</code> maintenance
                mode.
              </span>
            </div>
          </article>
          <article id="failures" className="docs-section">
            <p className="eyebrow">Practice recovery</p>
            <h3>Inject one failure at a time.</h3>
            <p>
              Use Scenarios to inject rate limits, 500s, timeouts,
              duplicate/delayed/reordered webhooks, and forced delivery failure
              per shop.
            </p>
            <button className="quiet" onClick={() => onNavigate("Scenarios")}>
              Open failure scenarios
            </button>
          </article>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ value, onCopy }) {
  return <div className="copy-code"><button className="quiet" onClick={() => onCopy(value)}>Copy</button><pre>{value}</pre></div>;
}
