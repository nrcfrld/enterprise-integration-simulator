import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PAGE_BY_PATH, CONTROL_PATHS, type ControlPage } from "@/app/navigation";
import type { DetailRequest, FormRequest, NoticeMessage } from "@/shared/types/controlPlane";
import { LoginPage } from "../auth/LoginPage";
import { ControlForm } from "./components/ControlForm";
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
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [form, setForm] = useState<FormRequest | null>(null);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const page = PAGE_BY_PATH[location.pathname] || "Dashboard";
  const notice = useCallback(
    (text: string) => setMessage({ type: "success", text }),
    [],
  );
  const reportError = useCallback(
    (text: string) => setMessage({ type: "error", text }),
    [],
  );
  const resources = useControlPlaneResources(page, token, reportError);
  const { isSeeding, resetShop } = useSeedShop({
    shopID: resources.shopID,
    token,
    onRefresh: resources.refresh,
    onNotice: notice,
    onError: reportError,
  });

  useEffect(() => {
    setDetail(null);
    setForm(null);
  }, [location.pathname]);

  if (!session) {
    return (
      <LoginPage
        onLogin={(result) => {
          login(result);
          navigate(CONTROL_PATHS.Dashboard, { replace: true });
        }}
      />
    );
  }

  const go = (next: ControlPage) => navigate(CONTROL_PATHS[next]);
  const isDocumentation = page === "Documentation";

  return (
    <main className={isDocumentation ? "documentation-shell" : "app-shell"}>
      {!isDocumentation && (
        <ControlPlaneSidebar page={page} session={session} onLogout={logout} />
      )}
      <section className={`workspace ${isDocumentation ? "documentation-workspace" : ""}`}>
        {!isDocumentation && (
          <WorkspaceHeader
            page={page}
            visibleShops={resources.visibleShops}
            shopID={resources.shopID}
            selectedShop={resources.selectedShop}
            providerFilter={resources.providerFilter}
            onShopChange={resources.setShopID}
            onProviderChange={resources.chooseOrderProvider}
          />
        )}
        {message && <Notice message={message} onDismiss={() => setMessage(null)} />}
        <section className={`content ${isDocumentation ? "documentation-content" : ""}`}>
          <ControlPlaneRoutes
            data={resources.data}
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
          />
        </section>
        {form && (
          <ControlForm
            key={`${form.kind}-${form.initial?.id || "new"}`}
            kind={form.kind}
            initial={form.initial}
            shopID={resources.shopID}
            token={token}
            onClose={() => setForm(null)}
            onSaved={async (text) => {
              setForm(null);
              await resources.refreshShops();
              await resources.refresh();
              notice(text);
            }}
          />
        )}
        {detail && (
          <DetailPanel
            detail={detail}
            token={token}
            onClose={() => setDetail(null)}
            onRefresh={resources.refresh}
            onNotice={notice}
          />
        )}
      </section>
    </main>
  );
}
