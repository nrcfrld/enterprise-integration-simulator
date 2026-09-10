import { controlDestination } from "@/app/destinations";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CONTROL_NAVIGATION, type ControlPage } from "@/app/navigation";
import type { ControlPlaneSession, NoticeMessage, Shop } from "@/shared/types/controlPlane";

const providerFilters = [
  ["ALL", "All providers"],
  ["SHOPEE_LIKE", "Shopee-like"],
  ["TOKOPEDIA_LIKE", "Tokopedia-like"],
] as const;

function providerLabel(profile: string) {
  return ({
    SHOPEE_LIKE: "Shopee-like",
    TOKOPEDIA_LIKE: "Tokopedia-like",
  } as Record<string, string>)[profile] || "Shopee-like";
}

export function ControlPlaneSidebar({
  shopID,
  page,
  session,
  onLogout,
}: {
  shopID?: string;
  page: ControlPage;
  session: ControlPlaneSession;
  onLogout: () => void;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigation = CONTROL_NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.page !== "Users" || session.user.role === "ADMIN"),
  })).filter((section) => section.items.length > 0);

  useEffect(() => setNavigationOpen(false), [page]);

  return (
    <aside className="sidebar-panel" data-navigation-open={navigationOpen}>
      <div className="sidebar-mobile-header">
        <div className="brand">
          <span className="signal" aria-hidden="true" />
          <span>MARKET<br />OPS</span>
        </div>
        <button
          type="button"
          className="mobile-navigation-toggle btn btn-ghost"
          aria-controls="primary-navigation"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <span>Menu</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <nav id="primary-navigation" className="sidebar-navigation menu" aria-label="Primary navigation" data-open={navigationOpen}>
        {navigation.map((section) => (
          <div className="navigation-section" key={section.label}>
            <p className="nav-label">{section.label}</p>
            {section.items.map((item) => (
              <Link
                key={item.label}
                to={controlDestination(item.page, shopID, item.page === "Documentation" ? { section: item.label === "Integration Guide" ? "quickstart" : "products" } : undefined)}
                aria-current={page === item.page && item.showActiveState !== false ? "page" : undefined}
                title={item.description}
                className={page === item.page && item.showActiveState !== false ? "active menu-active" : ""}
                onClick={() => setNavigationOpen(false)}
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
  const [shopFilter, setShopFilter] = useState("");
  const summary = page === "Dashboard"
    ? "Set up and verify your marketplace integration."
    : selectedShop
      ? `${page} for ${selectedShop.name}`
      : `Choose a shop to work with ${page.toLowerCase()}.`;
  return (
    <header className="workspace-header navbar">
      <div className="workspace-title">
        <h1>{page}</h1>
        <p>{summary}</p>
      </div>
      <div className="header-actions">
        {page === "Orders" && (
          <div className="provider-switcher" aria-label="Filter shop choices by provider">
            <span>Shop provider</span>
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
        {visibleShops.length > 20 && <label>Filter shops<input type="search" value={shopFilter} onChange={event => setShopFilter(event.target.value)} /></label>}
        <label className="shop-selector">
          <span>{page === "Orders" ? "Order scope" : "Current shop"}</span>
          <select
            className="select select-bordered"
            aria-label="Current shop"
            value={shopID}
            onChange={(event) => onShopChange(event.target.value)}
          >
            <option value="">{page === "Orders" ? "Select a provider shop" : "Select a shop"}</option>
            {visibleShops.filter(shop => shop.id === shopID || `${shop.name} ${shop.id} ${shop.provider_profile}`.toLowerCase().includes(shopFilter.toLowerCase())).map((shop) => (
              <option key={shop.id} value={shop.id}>
                {page === "Orders" ? `[${providerLabel(shop.provider_profile)}] ` : ""}{shop.name}
              </option>
            ))}
          </select>
        </label>
        <Link className="header-manage-link" to={controlDestination("Shops", shopID)}>Manage shops</Link>
        {selectedShop && page !== "Orders" && (
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
