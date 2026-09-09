import { Navigate, Route, Routes } from "react-router-dom";
import { CONTROL_PATHS, type ControlPage } from "@/app/navigation";
import type {
  Shop,
  ControlPlaneData,
  ControlRole,
  DetailRequest,
  FormRequest,
} from "@/shared/types/controlPlane";
import { Dashboard, Shops } from "./components/DashboardPages";
import { EventsPage } from "./components/EventsPage";
import { ResourcePage } from "./components/ResourcePage";
import { Scenario } from "./components/Scenario";
import { WebhookSettings } from "./components/WebhookSettings";

interface ControlPlaneRoutesProps {
  selectedShop?: Shop;
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
  onSelectShop: (shop: Shop) => void;
  listPage: number;
  onPageChange: (page: number) => void;
}

export function ControlPlaneRoutes({
  data,
  selectedShop,
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
}: ControlPlaneRoutesProps) {
  const resourceProps = {
    data,
    shopID,
    token,
    role,
    onForm,
    onNavigate,
    onDetail,
    onRefresh,
    onNotice,
    onSeed,
    isSeeding,
  };
  const resourcePages = [
    "Products",
    "Warehouses",
    "Credentials",
    "Orders",
    "Packages",
    "Shipments",
    "Deliveries",
    "Users",
  ] as const;

  return (
    <Routes>
      <Route path="/" element={<Navigate replace to={CONTROL_PATHS.Dashboard} />} />
      <Route
        path={CONTROL_PATHS.Dashboard}
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
        path={CONTROL_PATHS.Documentation}
        element={null}
      />
      <Route
        path={CONTROL_PATHS.Scenarios}
        element={
          <Scenario
            token={token}
            shopID={shopID}
            data={data}
            onSaved={() => {
              void onRefresh();
              onNotice("Scenario updated");
            }}
          />
        }
      />
      <Route
        path={CONTROL_PATHS.Shops}
        element={
          <Shops
            data={data}
            onSelect={onSelectShop}
            onForm={onForm}
            listPage={listPage}
            onPageChange={onPageChange}
          />
        }
      />
      <Route
        path={CONTROL_PATHS.Webhooks}
        element={
          <WebhookSettings shop={selectedShop} listPage={listPage} onPageChange={onPageChange}
            data={data}
            shopID={shopID}
            token={token}
            onForm={onForm}
            onRefresh={onRefresh}
            onNotice={onNotice}
          />
        }
      />
      <Route path={CONTROL_PATHS.Events} element={<EventsPage {...resourceProps} listPage={listPage} onPageChange={onPageChange} />} />
      {resourcePages.map((resource) => (
        <Route
          key={resource}
          path={CONTROL_PATHS[resource]}
          element={
            <ResourcePage
              page={resource}
              {...resourceProps}
              listPage={listPage}
              onPageChange={onPageChange}
            />
          }
        />
      ))}
      <Route path="*" element={<Navigate replace to={CONTROL_PATHS.Dashboard} />} />
    </Routes>
  );
}
