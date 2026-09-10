import { CONTROL_PATHS, type ControlPage } from "./navigation";
import type { PortalSection } from "@/features/developer-portal/types";
import { ENDPOINT_BY_ID } from "@/features/developer-portal/data/endpoints";

export interface PortalDestination { section: PortalSection; endpoint?: string; resourceID?: string; packageID?: string }
const sections: PortalSection[] = ["quickstart", "try", "consumer", "authentication", "control-plane", "webhooks", "products", "warehouses", "orders", "errors"];
export const PORTAL_PATHS: Record<PortalSection, string> = {
  quickstart: "/docs/start",
  try: "/docs/simulator",
  consumer: "/docs/durable-consumer",
  authentication: "/docs/request-signing",
  "control-plane": "/docs/accounts",
  products: "/docs/products",
  warehouses: "/docs/warehouses",
  orders: "/docs/orders",
  webhooks: "/docs/webhooks",
  errors: "/docs/errors",
};
const sectionByPath = Object.fromEntries(Object.entries(PORTAL_PATHS).map(([section, path]) => [path, section])) as Record<string, PortalSection>;

export function readPortalDestination(pathname: string, params: URLSearchParams): PortalDestination | undefined {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const legacySection = params.get("section") as PortalSection;
  const section = sectionByPath[normalizedPath]
    ?? (normalizedPath === CONTROL_PATHS.Documentation
      ? sections.includes(legacySection) ? legacySection : params.has("section") ? undefined : "quickstart"
      : undefined);
  if (!section) return undefined;
  const endpoint = params.get("endpoint") || undefined;
  return { section, endpoint: endpoint && ENDPOINT_BY_ID[endpoint] ? endpoint : undefined, resourceID: params.get("resource_id") || undefined, packageID: params.get("package_id") || undefined };
}
export function controlDestination(page: ControlPage, shopID?: string, portal?: PortalDestination) {
  const params = new URLSearchParams();
  if (shopID) params.set("shop", shopID);
  if (portal) {
    if (portal.endpoint) params.set("endpoint", portal.endpoint);
    if (portal.resourceID) params.set("resource_id", portal.resourceID);
    if (portal.packageID) params.set("package_id", portal.packageID);
  }
  const path = page === "Documentation" ? PORTAL_PATHS[portal?.section ?? "quickstart"] : CONTROL_PATHS[page];
  return path + (params.size ? `?${params}` : "");
}
