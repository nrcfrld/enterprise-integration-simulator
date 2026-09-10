import { controlDestination, readPortalDestination } from "@/app/destinations";
import { DeveloperPortal } from "../developer-portal/DeveloperPortal";
import { PORTAL_SECTION_TITLES } from "../developer-portal/types";
import { API_BASE_URL } from "@/shared/api/controlPlaneClient";
import type { CredentialHandoff } from "@/shared/types/controlPlane";
import { RefreshStatus } from "./components/RefreshStatus";
import { isPendingDelivery, useBoundedRefresh } from "./hooks/useBoundedRefresh";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import { controlPageForPath, CONTROL_PATHS, type ControlPage } from "@/app/navigation";
import type { ControlPlaneSession, CreatedCredential, DetailRequest, FormRequest, NoticeMessage } from "@/shared/types/controlPlane";
import { LoginPage } from "../auth/LoginPage";
import { ControlForm } from "./components/ControlForm";
import { CredentialCreatedDialog } from "./components/CredentialCreatedDialog";
import {
  ControlPlaneSidebar,
  Notice,
  WorkspaceHeader,
} from "./components/ControlPlaneChrome";
import { DetailPanel } from "./components/DetailPanel";
import { ControlPlaneRoutes } from "./ControlPlaneRoutes";
import { useControlPlaneResources } from "./hooks/useControlPlaneResources";
import { useControlPlaneSession } from "./hooks/useControlPlaneSession";
import { useSeedShop } from "./hooks/useSeedShop";
import "../../styles.css";

export function ControlPlaneApp() {
  const entryLocation = useLocation();
  const { session, token, login, logout } = useControlPlaneSession();
  const navigate = useNavigate();
  if (!session && controlPageForPath(entryLocation.pathname) === "Documentation") return <GuestDocumentation />;
  if (!session) return <LoginPage onLogin={(result) => {
    login(result);
    navigate(controlPageForPath(entryLocation.pathname) ? entryLocation.pathname + entryLocation.search : CONTROL_PATHS.Dashboard, { replace: true });
  }} />;
  return <AuthenticatedControlPlane key={token} session={session} onLogout={logout} />;
}

function GuestDocumentation() {
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const destination = readPortalDestination(location.pathname, params);
  const section = destination?.section === "control-plane" ? "quickstart" : destination?.section ?? "quickstart";

  useEffect(() => {
    if (!destination || (location.pathname !== CONTROL_PATHS.Documentation && !params.has("section"))) return;
    navigate(controlDestination("Documentation", undefined, destination), { replace: true });
  }, [destination, location.pathname, navigate, params]);
  useEffect(() => {
    document.title = `${PORTAL_SECTION_TITLES[section]} · Marketplace Simulator`;
    if (navigationType !== "POP") window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    const frame = window.requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [navigationType, section]);

  return <div className="documentation-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className="workspace documentation-workspace">
      {((!destination) || (params.has("endpoint") && !destination.endpoint)) && <p role="alert">This documentation destination is unavailable. Choose a lesson or operation from the navigation.</p>}
      <DeveloperPortal
        destination={destination}
        onDestination={next => navigate(controlDestination("Documentation", undefined, next))}
        api={API_BASE_URL}
        onNavigate={page => navigate(controlDestination(page))}
      />
    </div>
  </div>;
}

function AuthenticatedControlPlane({ session, onLogout }: { session: ControlPlaneSession; onLogout: () => void }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [handoff, setHandoff] = useState<CredentialHandoff>();
  const [portalGeneration, setPortalGeneration] = useState(0);
  const page = controlPageForPath(location.pathname) || "Dashboard";
  const resources = useControlPlaneResources(page, session.token);
  const isDocumentation = page === "Documentation";
  const portalDestination = isDocumentation ? readPortalDestination(location.pathname, params) : undefined;
  const portalSection = portalDestination?.section === "control-plane" && session.user.role !== "ADMIN" ? "quickstart" : portalDestination?.section ?? "quickstart";
  const go = (next: ControlPage, shopID = resources.shopID) => navigate(controlDestination(next, shopID, next === "Documentation" ? { section: "try" } : undefined));
  useEffect(() => {
    if (!isDocumentation || !portalDestination || (location.pathname !== CONTROL_PATHS.Documentation && !params.has("section"))) return;
    navigate(controlDestination("Documentation", params.get("shop") || resources.shopID, portalDestination), { replace: true });
  }, [isDocumentation, location.pathname, navigate, params, portalDestination, resources.shopID]);
  useLayoutEffect(() => { setHandoff(undefined); }, [resources.shopID]);
  useEffect(() => {
    const title = isDocumentation ? PORTAL_SECTION_TITLES[portalSection] : page;
    document.title = `${title} · Marketplace Simulator`;
    if (navigationType !== "POP") window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    const frame = window.requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [isDocumentation, navigationType, page, portalSection]);
  const clearPortal = () => { setHandoff(undefined); setPortalGeneration(value => value + 1); };
  return <div className={isDocumentation ? "documentation-shell" : "app-shell"}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    {!isDocumentation && <ControlPlaneSidebar shopID={resources.shopID} page={page} session={session} onLogout={onLogout} />}
    <div className={`workspace ${isDocumentation ? "documentation-workspace" : ""}`}>
      {isDocumentation && ((!portalDestination) || (params.has("endpoint") && !portalDestination?.endpoint)) && <p role="alert">This documentation destination is unavailable. Choose a lesson or operation from the navigation.</p>}
      <div key="developer-portal" hidden={!isDocumentation}>
        <DeveloperPortal destination={portalDestination} onDestination={destination => navigate(controlDestination("Documentation", resources.shopID, destination))} controlToken={isDocumentation ? session.token : undefined} key={`${resources.shopID}:${portalGeneration}`} shop={resources.selectedShop} api={API_BASE_URL}
          canManageUsers={session.user.role === "ADMIN"}
          credentialHandoff={handoff?.shop.id === resources.shopID ? handoff : undefined}
          onHandoffConsumed={() => setHandoff(undefined)} onNavigate={go} />
      </div>
      {!isDocumentation && <main id="main-content" tabIndex={-1}>
        <WorkspaceHeader page={page} visibleShops={resources.visibleShops} shopID={resources.shopID}
          selectedShop={resources.selectedShop} providerFilter={resources.providerFilter}
          onShopChange={resources.setShopID} onProviderChange={resources.chooseOrderProvider} />
        <ControlPlaneWorkspace key={`${location.pathname}:${resources.shopID}`} session={session} page={page} resources={resources}
          onClearPortal={clearPortal} onUseCredential={value => { setHandoff(value); go("Documentation", value.shop.id); }} />
      </main>}
    </div>
  </div>;
}

function ControlPlaneWorkspace({ session, page, resources, onUseCredential, onClearPortal }: {
  onUseCredential: (handoff: CredentialHandoff) => void;
  onClearPortal: () => void;
  session: ControlPlaneSession;
  page: keyof typeof CONTROL_PATHS;
  resources: ReturnType<typeof useControlPlaneResources>;
}) {
  const token = session.token;
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const deliveryChecks = useBoundedRefresh(`${page}:${resources.shopID}:${resources.listPage}`, page === "Deliveries" && Boolean(resources.shopID && resources.data && !resources.error) && (!resources.data?.data?.length || resources.data.data.some(row => isPendingDelivery(row.status))), resources.refresh);

  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const detailType = params.get("detail");
  const resourceID = params.get("resource");
  const detail: DetailRequest | null = resourceID && ["product", "order", "package", "shipment", "warehouse", "delivery"].includes(detailType || "")
    ? { type: detailType as DetailRequest["type"], id: resourceID, shopID: resources.shopID } : null;
  const location = useLocation();
  const setDetail = (next: DetailRequest | null) => {
    const query = new URLSearchParams(params);
    if (next) { query.set("detail", next.type); query.set("resource", next.id); query.set("shop", resources.shopID); }
    else { query.delete("detail"); query.delete("resource"); }
    setParams(query, { state: { detailNavigation: Boolean(detail && next) } });
  };
  const [form, setForm] = useState<FormRequest | null>(null);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);
  const formReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const notice = useCallback((text: string) => setMessage({ type: "success", text }), []);
  const reportError = useCallback((text: string) => setMessage({ type: "error", text }), []);
  const { isSeeding, resetShop } = useSeedShop({ shopID: resources.shopID, shopName: resources.selectedShop?.name, token, onRefresh: async () => { onClearPortal(); await resources.refresh(); }, onNotice: notice, onError: reportError });
  const go = (next: ControlPage, shopID = resources.shopID) => navigate(controlDestination(next, shopID, next === "Documentation" ? { section: "try" } : undefined));
  const isDocumentation = page === "Documentation";
  const openForm = (next: FormRequest) => {
    formReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setForm(next);
  };
  const openDetail = (next: DetailRequest) => {
    detailReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetail(next);
  };

  return (
    <>
      {resources.shopsError && <p role="alert">{resources.shopsError} <button onClick={() => void resources.refreshShops()}>Retry shops</button></p>}
      {message && <Notice message={message} onDismiss={() => setMessage(null)} />}
      <section className={`content ${isDocumentation ? "documentation-content" : ""}`}>
        {!isDocumentation && page !== "Scenarios" && (resources.shopID || page === "Shops" || page === "Users" || page === "Dashboard") && <RefreshStatus refreshing={Boolean(resources.refreshing)} updatedAt={resources.updatedAt} polling={deliveryChecks.polling} onRefresh={deliveryChecks.refreshNow} />}
        {resources.error && <p role="alert">{resources.data ? "Refresh failed; showing previously loaded data. " : ""}{resources.error} <button disabled={Boolean(resources.refreshing)} onClick={() => void resources.refresh()}>Retry loading</button></p>}
        {resources.loading ? <p role="status">Loading {page.toLowerCase()} for {resources.selectedShop?.name || "this workspace"}…</p>
          : resources.error && !resources.data ? null
          : <ControlPlaneRoutes
          onTry={endpoint => navigate(controlDestination("Documentation", resources.shopID, { section: "try", endpoint }))}
          data={resources.data}
          selectedShop={resources.selectedShop}
          shopID={resources.shopID}
          token={token}
          role={session.user.role}
          onNavigate={go}
          onForm={openForm}
          onSeed={resetShop}
          isSeeding={isSeeding}
          onDetail={openDetail}
          onRefresh={resources.refresh}
          onNotice={notice}
          onSelectShop={(shop) => {
            resources.selectCreatedShop(shop);
            go("Products", shop.id);
          }}
          listPage={resources.listPage}
          onPageChange={resources.setListPage}
        />}
      </section>
      {form && (
        <ControlForm
          shop={resources.selectedShop}
          key={`${form.kind}-${form.initial?.id || "new"}`}
          kind={form.kind}
          initial={form.initial}
          shopID={resources.shopID}
          token={token}
          onClose={() => setForm(null)}
          onSaved={async (text, credential, created) => {
            if (!active.current) return;
            setForm(null);
            if (created?.kind === "shop" && created.shop) {
              resources.selectCreatedShop(created.shop);
              go("Dashboard", created.shop.id);
              return;
            }
            if (created?.kind === "order") openDetail({ type: "order", id: created.id });
            if (credential) {
              setMessage(null);
              setCreatedCredential(credential);
              void Promise.all([resources.refreshShops(), resources.refresh()])
                .catch((error: unknown) => reportError(error instanceof Error ? error.message : "Request failed"));
              return;
            }
            await resources.refreshShops();
            await resources.refresh();
            notice(text);
          }}
          returnFocusRef={formReturnFocusRef}
        />
      )}
      {createdCredential && (
        <CredentialCreatedDialog
          credential={createdCredential}
          shop={resources.selectedShop}
          onUseInSimulator={resources.selectedShop ? () => onUseCredential({ shop: resources.selectedShop!, credential: createdCredential }) : undefined}
          onClose={() => setCreatedCredential(null)}
          returnFocusRef={formReturnFocusRef}
        />
      )}
      {detail && resources.selectedShop && (
        <DetailPanel
            key={`${detail.type}:${detail.id}`}
          shop={resources.selectedShop}
          detail={detail}
          onOpenResource={setDetail}
          onBackResource={location.state?.detailNavigation ? () => navigate(-1) : undefined}
          token={token}
          onManageWebhook={() => { setDetail(null); go("Webhooks"); }}
          onClose={() => setDetail(null)}
          onRefresh={resources.refresh}
          onNotice={notice}
          returnFocusRef={detailReturnFocusRef}
        />
      )}
    </>
  );
}
