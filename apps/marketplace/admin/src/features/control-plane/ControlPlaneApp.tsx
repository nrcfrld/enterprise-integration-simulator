import { DeveloperPortal } from "../developer-portal/DeveloperPortal";
import { API_BASE_URL } from "@/shared/api/controlPlaneClient";
import type { CredentialHandoff } from "@/shared/types/controlPlane";
import { RefreshStatus } from "./components/RefreshStatus";
import { isPendingDelivery, useBoundedRefresh } from "./hooks/useBoundedRefresh";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PAGE_BY_PATH, CONTROL_PATHS, type ControlPage } from "@/app/navigation";
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
  const { session, token, login, logout } = useControlPlaneSession();
  const navigate = useNavigate();
  if (!session) return <LoginPage onLogin={(result) => {
    login(result);
    navigate(CONTROL_PATHS.Dashboard, { replace: true });
  }} />;
  return <AuthenticatedControlPlane key={token} session={session} onLogout={logout} />;
}

function AuthenticatedControlPlane({ session, onLogout }: { session: ControlPlaneSession; onLogout: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [handoff, setHandoff] = useState<CredentialHandoff>();
  const [portalGeneration, setPortalGeneration] = useState(0);
  const page = PAGE_BY_PATH[location.pathname] || "Dashboard";
  const resources = useControlPlaneResources(page, session.token);
  const isDocumentation = page === "Documentation";
  useLayoutEffect(() => { setHandoff(undefined); }, [resources.shopID]);
  const clearPortal = () => { setHandoff(undefined); setPortalGeneration(value => value + 1); };
  return <main className={isDocumentation ? "documentation-shell" : "app-shell"}>
    {!isDocumentation && <ControlPlaneSidebar page={page} session={session} onLogout={onLogout} />}
    <section className={`workspace ${isDocumentation ? "documentation-workspace" : ""}`}>
      {!isDocumentation && <WorkspaceHeader page={page} visibleShops={resources.visibleShops} shopID={resources.shopID}
        selectedShop={resources.selectedShop} providerFilter={resources.providerFilter}
        onShopChange={resources.setShopID} onProviderChange={resources.chooseOrderProvider} />}
      <div hidden={!isDocumentation}>
        <DeveloperPortal key={`${resources.shopID}:${resources.selectedShop?.provider_profile ?? ""}:${portalGeneration}`} shop={resources.selectedShop} api={API_BASE_URL}
          credentialHandoff={handoff?.shop.id === resources.shopID ? handoff : undefined}
          onHandoffConsumed={() => setHandoff(undefined)} onNavigate={next => navigate(CONTROL_PATHS[next])} />
      </div>
      <ControlPlaneWorkspace key={`${location.pathname}:${resources.shopID}`} session={session} page={page} resources={resources}
        onClearPortal={clearPortal} onUseCredential={value => { setHandoff(value); navigate(CONTROL_PATHS.Documentation); }} />
    </section>
  </main>;
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
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [form, setForm] = useState<FormRequest | null>(null);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);
  const formReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const notice = useCallback((text: string) => setMessage({ type: "success", text }), []);
  const reportError = useCallback((text: string) => setMessage({ type: "error", text }), []);
  const { isSeeding, resetShop } = useSeedShop({ shopID: resources.shopID, shopName: resources.selectedShop?.name, token, onRefresh: async () => { onClearPortal(); await resources.refresh(); }, onNotice: notice, onError: reportError });
  const go = (next: ControlPage) => navigate(CONTROL_PATHS[next]);
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
            go("Products");
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
              go("Dashboard");
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
      {detail && (
        <DetailPanel
            key={`${detail.type}:${detail.id}`}
          shop={resources.selectedShop}
          detail={detail}
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
