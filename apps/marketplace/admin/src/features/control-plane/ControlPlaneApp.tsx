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
import { ControlForm } from "./components/ControlForm";
import { Dashboard, Shops } from "./components/DashboardPages";
import { DetailPanel } from "./components/DetailPanel";
import { ResourcePage } from "./components/ResourcePage";
import { Scenario } from "./components/Scenario";
import { WebhookSettings } from "./components/WebhookSettings";
import { API_BASE_URL, controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { CONTROL_NAVIGATION, CONTROL_PATHS, PAGEABLE_CONTROL_PAGES, PAGE_BY_PATH, type ControlPage } from "@/app/navigation";
import type {
  ControlPlaneData,
  ControlPlaneSession,
  ControlRole,
  DetailRequest,
  FormRequest,
  ListResponse,
  NoticeMessage,
  SeedResult,
  Shop,
} from "@/shared/types/controlPlane";
import "../../styles.css";

const API = API_BASE_URL;
const navigation = CONTROL_NAVIGATION;
const paths = CONTROL_PATHS;
const pagesByPath = PAGE_BY_PATH;
const pageablePages = PAGEABLE_CONTROL_PAGES;
const providerFilters = [
  ["ALL", "All providers"],
  ["SHOPEE_LIKE", "Shopee"],
  ["TOKOPEDIA_LIKE", "Tokopedia & TikTok Shop"],
];

const request = <T,>(...args: Parameters<typeof controlPlaneRequest>) =>
  controlPlaneRequest<T>(...args);

function restoreSession(): ControlPlaneSession | null {
  const stored = localStorage.getItem("marketplace-session");
  if (!stored) return null;
  try {
    return JSON.parse(stored) as ControlPlaneSession;
  } catch {
    localStorage.removeItem("marketplace-session");
    return null;
  }
}

function providerLabel(profile: string) {
  return (
    ({
      SHOPEE_LIKE: "Shopee-like",
      TOKOPEDIA_LIKE: "Tokopedia & TikTok Shop",
    } as Record<string, string>)[profile] || "Shopee-like"
  );
}

export function ControlPlaneApp() {
  const [session, setSession] = useState<ControlPlaneSession | null>(restoreSession);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopID, setShopID] = useState("");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [data, setData] = useState<ControlPlaneData | null>(null);
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [form, setForm] = useState<FormRequest | null>(null);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
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
      (({
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
      }) as Record<string, string | false | undefined>)[page],
    [page, shopID],
  );
  const route =
    endpoint && pageablePages.has(page)
      ? `${endpoint}?page=${listPage}&limit=20`
      : endpoint;
  const refreshShops = useCallback(async () => {
    const result = await request<ListResponse<Shop>>("/control/v1/shops", token);
    setShops(result.data);
    setShopID((current) => current || result.data[0]?.id || "");
  }, [token]);
  const refresh = useCallback(async () => {
    if (!route) {
      setData(null);
      return;
    }
    setData(await request<ControlPlaneData>(route, token));
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
  const go = (next: ControlPage) => navigate(paths[next]);
  const notice = (text: string) => setMessage({ type: "success", text });
  const chooseOrderProvider = (profile: string) => {
    setProviderFilter(profile);
    if (profile === "ALL") return;
    const matching = shops.filter((shop) => shop.provider_profile === profile);
    setShopID((current) =>
      matching.some((shop) => shop.id === current) ? current : matching[0]?.id || "",
    );
  };
  const resetShop = async () => {
    if (!shopID || !window.confirm("Reset this shop to its seed data?")) return;
    setIsSeeding(true);
    setMessage(null);
    try {
      const result = await request<SeedResult>(`/control/v1/shops/${shopID}/reset`, token, {
        method: "POST",
      });
      await refresh();
      notice(
        `Seed complete: ${result.products_seeded} products and ${result.orders_seeded} orders. Create a credential from Credentials when you need a new one-time secret.`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Request failed";
      setMessage({ type: "error", text: `Could not seed this shop: ${detail}` });
    } finally {
      setIsSeeding(false);
    }
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
            isSeeding={isSeeding}
            onDetail={setDetail}
            onRefresh={refresh}
            onNotice={notice}
            onSelectShop={(id: string) => {
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
            onSaved={async (text: string) => {
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
  isSeeding,
  onDetail,
  onRefresh,
  onNotice,
  onSelectShop,
  listPage,
  onPageChange,
}: AppRoutesProps) {
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
    isSeeding,
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
            isSeeding={isSeeding}
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
      {(["Products", "Warehouses", "Credentials", "Orders", "Packages", "Shipments", "Deliveries", "Users"] as const).map(
        (resource) => (
          <Route
            key={resource}
            path={paths[resource as ControlPage]}
            element={<ResourcePage page={resource} {...resourceProps} listPage={listPage} onPageChange={onPageChange} />}
          />
        ),
      )}
      <Route path="*" element={<Navigate replace to={paths.Dashboard} />} />
    </Routes>
  );
}

function Documentation({ onNavigate }: { onNavigate: (page: ControlPage) => void }) {
  return <DeveloperPortal api={API} onNavigate={onNavigate} />;
}

interface AppRoutesProps {
  data: ControlPlaneData | null;
  shopID: string;
  token: string | null | undefined;
  role: ControlRole;
  onNavigate: (page: ControlPage) => void;
  onForm: (form: FormRequest) => void;
  onSeed: () => Promise<void>;
  isSeeding: boolean;
  onDetail: (detail: DetailRequest) => void;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  onSelectShop: (id: string) => void;
  listPage: number;
  onPageChange: (page: number) => void;
}
