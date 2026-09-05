import { Link } from "react-router-dom";
import { CONTROL_NAVIGATION, CONTROL_PATHS, type ControlPage } from "@/app/navigation";
import type { ControlPlaneSession, NoticeMessage, Shop } from "@/shared/types/controlPlane";

const providerFilters = [
  ["ALL", "All providers"],
  ["SHOPEE_LIKE", "Shopee"],
  ["TOKOPEDIA_LIKE", "Tokopedia & TikTok Shop"],
] as const;

function providerLabel(profile: string) {
  return ({
    SHOPEE_LIKE: "Shopee-like",
    TOKOPEDIA_LIKE: "Tokopedia & TikTok Shop",
  } as Record<string, string>)[profile] || "Shopee-like";
}

export function ControlPlaneSidebar({
  page,
  session,
  onLogout,
}: {
  page: ControlPage;
  session: ControlPlaneSession;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar-panel">
      <div className="brand">
        <span className="signal" />
        <span>MARKET<br />OPS</span>
      </div>
      <nav className="sidebar-navigation menu" aria-label="Primary navigation">
        {CONTROL_NAVIGATION.map((section) => (
          <div className="navigation-section" key={section.label}>
            <p className="nav-label">{section.label}</p>
            {section.items.map((item) => (
              <Link
                key={item.label}
                to={CONTROL_PATHS[item.page]}
                title={item.description}
                className={page === item.page && item.showActiveState !== false ? "active menu-active" : ""}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="profile">
        <span>{session.user.email}</span>
        <button className="btn btn-ghost btn-sm" onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  );
}

interface WorkspaceHeaderProps {
  page: ControlPage;
  visibleShops: Shop[];
  shopID: string;
  selectedShop?: Shop;
  providerFilter: string;
  onShopChange: (shopID: string) => void;
  onProviderChange: (profile: string) => void;
}

export function WorkspaceHeader({
  page,
  visibleShops,
  shopID,
  selectedShop,
  providerFilter,
  onShopChange,
  onProviderChange,
}: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header navbar">
      <div>
        <p className="eyebrow">{page === "Dashboard" ? "Integration runbook" : "Control plane"}</p>
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
                  className={`btn btn-xs ${providerFilter === profile ? "active btn-primary" : "btn-ghost"}`}
                  aria-pressed={providerFilter === profile}
                  onClick={() => onProviderChange(profile)}
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
            className="select select-bordered"
            aria-label="Current shop"
            value={shopID}
            onChange={(event) => onShopChange(event.target.value)}
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
          <span className={`provider-badge badge badge-secondary ${selectedShop.provider_profile.toLowerCase()}`}>
            {providerLabel(selectedShop.provider_profile)}
          </span>
        )}
      </div>
    </header>
  );
}

export function Notice({
  message,
  onDismiss,
}: {
  message: NoticeMessage;
  onDismiss: () => void;
}) {
  const isError = message.type === "error";
  return (
    <div
      className={`app-notice ${isError ? "app-notice-error" : "app-notice-success"}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <span className="app-notice-icon" aria-hidden="true">
        {isError ? (
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 8v4m0 4h.01M10.3 4.9 3.8 16.2A2 2 0 0 0 5.5 19h13a2 2 0 0 0 1.7-2.8L13.7 4.9a2 2 0 0 0-3.4 0Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="m7.5 12.5 3 3 6.5-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </span>
      <span className="app-notice-content">
        <strong>{isError ? "Action failed" : "Done"}</strong>
        <span>{message.text}</span>
      </span>
      <button aria-label="Dismiss notification" className="app-notice-dismiss" onClick={onDismiss}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
