import { CONTROL_PATHS, type ControlPage } from "./navigation";
import type { PortalSection } from "@/features/developer-portal/types";
import { ENDPOINT_BY_ID } from "@/features/developer-portal/data/endpoints";

export interface PortalDestination { section: PortalSection; endpoint?: string; resourceID?: string; packageID?: string }
const sections: PortalSection[] = ["quickstart", "try", "consumer", "authentication", "webhooks", "products", "warehouses", "orders", "errors"];
export function readPortalDestination(params: URLSearchParams): PortalDestination | undefined {
  const section = params.get("section") as PortalSection;
  if (!sections.includes(section)) return undefined;
  const endpoint = params.get("endpoint") || undefined;
  return { section, endpoint: endpoint && ENDPOINT_BY_ID[endpoint] ? endpoint : undefined, resourceID: params.get("resource_id") || undefined, packageID: params.get("package_id") || undefined };
}
export function controlDestination(page: ControlPage, shopID?: string, portal?: PortalDestination) {
  const params = new URLSearchParams();
  if (shopID) params.set("shop", shopID);
  if (portal) {
    params.set("section", portal.section);
    if (portal.endpoint) params.set("endpoint", portal.endpoint);
    if (portal.resourceID) params.set("resource_id", portal.resourceID);
    if (portal.packageID) params.set("package_id", portal.packageID);
  }
  return CONTROL_PATHS[page] + (params.size ? `?${params}` : "");
}
