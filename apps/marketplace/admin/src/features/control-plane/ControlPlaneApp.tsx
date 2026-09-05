import { useCallback, useState } from "react";
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
  const page = PAGE_BY_PATH[location.pathname] || "Dashboard";
  const resources = useControlPlaneResources(page, session.token);
  const isDocumentation = page === "Documentation";
  return <main className={isDocumentation ? "documentation-shell" : "app-shell"}>
    {!isDocumentation && <ControlPlaneSidebar page={page} session={session} onLogout={onLogout} />}
    <section className={`workspace ${isDocumentation ? "documentation-workspace" : ""}`}>
      {!isDocumentation && <WorkspaceHeader page={page} visibleShops={resources.visibleShops} shopID={resources.shopID}
        selectedShop={resources.selectedShop} providerFilter={resources.providerFilter}
        onShopChange={resources.setShopID} onProviderChange={resources.chooseOrderProvider} />}
      <ControlPlaneWorkspace key={`${location.pathname}:${resources.shopID}`} session={session} page={page} resources={resources} />
    </section>
  </main>;
}

function ControlPlaneWorkspace({ session, page, resources }: {
  session: ControlPlaneSession;
  page: keyof typeof CONTROL_PATHS;
  resources: ReturnType<typeof useControlPlaneResources>;
}) {
  const token = session.token;
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [form, setForm] = useState<FormRequest | null>(null);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);
  const notice = useCallback((text: string) => setMessage({ type: "success", text }), []);
  const reportError = useCallback((text: string) => setMessage({ type: "error", text }), []);
  const { isSeeding, resetShop } = useSeedShop({ shopID: resources.shopID, token, onRefresh: resources.refresh, onNotice: notice, onError: reportError });
  const go = (next: ControlPage) => navigate(CONTROL_PATHS[next]);
  const isDocumentation = page === "Documentation";

  return (
    <>
      {resources.shopsError && <p role="alert">{resources.shopsError} <button onClick={() => void resources.refreshShops()}>Retry shops</button></p>}
      {message && <Notice message={message} onDismiss={() => setMessage(null)} />}
      <section className={`content ${isDocumentation ? "documentation-content" : ""}`}>
        {resources.loading ? <p role="status">Loading {page.toLowerCase()} for {resources.selectedShop?.name || "this workspace"}…</p>
          : resources.error ? <p role="alert">{resources.error} <button onClick={() => void resources.refresh()}>Retry loading</button></p>
          : <ControlPlaneRoutes
          data={resources.data}
          selectedShop={resources.selectedShop}
          shopID={resources.shopID}
          token={token}
          role={session.user.role}
          onNavigate={go}
          onForm={setForm}
          onSeed={resetShop}
          isSeeding={isSeeding}
          onDetail={setDetail}
          onRefresh={resources.refresh}
          onNotice={notice}
          onSelectShop={(id) => {
            resources.setShopID(id);
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
          onSaved={async (text, credential) => {
            setForm(null);
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
        />
      )}
      {createdCredential && (
        <CredentialCreatedDialog
          credential={createdCredential}
          onClose={() => setCreatedCredential(null)}
        />
      )}
      {detail && (
        <DetailPanel
            key={`${detail.type}:${detail.id}`}
          shop={resources.selectedShop}
          detail={detail}
          token={token}
          onClose={() => setDetail(null)}
          onRefresh={resources.refresh}
          onNotice={notice}
        />
      )}
    </>
  );
}
