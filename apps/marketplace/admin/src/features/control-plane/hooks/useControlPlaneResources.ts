import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PAGEABLE_CONTROL_PAGES, type ControlPage } from "@/app/navigation";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ControlPlaneData, ListResponse, Shop } from "@/shared/types/controlPlane";

function pageEndpoint(page: ControlPage, shopID: string): string | undefined {
  return ({
    Dashboard: shopID ? `/control/v1/dashboard?shop_id=${shopID}` : "/control/v1/dashboard",
    Shops: "/control/v1/shops",
    Users: "/control/v1/users",
    Products: shopID ? `/control/v1/shops/${shopID}/products` : undefined,
    Warehouses: shopID ? `/control/v1/shops/${shopID}/warehouses` : undefined,
    Orders: shopID ? `/control/v1/shops/${shopID}/orders` : undefined,
    Packages: shopID ? `/control/v1/shops/${shopID}/packages` : undefined,
    Shipments: shopID ? `/control/v1/shops/${shopID}/shipments` : undefined,
    Credentials: shopID ? `/control/v1/shops/${shopID}/credentials` : undefined,
    Webhooks: shopID ? `/control/v1/shops/${shopID}/webhooks` : undefined,
    Deliveries: shopID ? `/control/v1/shops/${shopID}/deliveries` : undefined,
    Scenarios: shopID ? `/control/v1/shops/${shopID}/scenario` : undefined,
    Documentation: undefined,
  })[page];
}

export function useControlPlaneResources(
  page: ControlPage,
  token: string | null | undefined,
) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopID, setShopID] = useState("");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [resource, setResource] = useState<{ scope: string; data: ControlPlaneData | null; loading: boolean; error: string } | null>(null);
  const [shopsLoaded, setShopsLoaded] = useState(false);
  const [shopsError, setShopsError] = useState("");
  const requestVersion = useRef(0);
  const shopsVersion = useRef(0);
  const activeToken = useRef(token);
  const [listPage, setListPage] = useState(1);
  const endpoint = pageEndpoint(page, shopID);
  const route = endpoint && PAGEABLE_CONTROL_PAGES.has(page)
    ? `${endpoint}?page=${listPage}&limit=20`
    : endpoint;

  const scope = `${token ?? ""}:${route ?? ""}`;
  const activeScope = useRef<string | null>(scope);
  useLayoutEffect(() => {
    activeScope.current = scope;
    requestVersion.current++;
    return () => { activeScope.current = null; };
  }, [scope]);
  useLayoutEffect(() => {
    activeToken.current = token;
    shopsVersion.current++;
    return () => { activeToken.current = undefined; };
  }, [token]);

  const refreshShops = useCallback(async () => {
    if (!token || activeToken.current !== token) return;
    const version = ++shopsVersion.current;
    try {
      const result = await controlPlaneRequest<ListResponse<Shop>>("/control/v1/shops", token);
      if (version !== shopsVersion.current || activeToken.current !== token) return;
      setShopsLoaded(true);
      setShops(result.data);
      setShopsError("");
      setShopID((current) => current || result.data[0]?.id || "");
    } catch (error) {
      if (version === shopsVersion.current && activeToken.current === token) {
        setShopsLoaded(true);
        setShopsError(error instanceof Error ? error.message : "Could not load shops");
      }
    }
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token || !route || activeScope.current !== scope) return;
    const version = ++requestVersion.current;
    setResource({ scope, data: null, loading: true, error: "" });
    try {
      const data = await controlPlaneRequest<ControlPlaneData>(route, token);
      if (activeScope.current === scope && version === requestVersion.current) {
        setResource({ scope, data, loading: false, error: "" });
      }
    } catch (error) {
      if (activeScope.current === scope && version === requestVersion.current) {
        setResource({ scope, data: null, loading: false, error: error instanceof Error ? error.message : "Request failed" });
      }
    }
  }, [route, scope, token]);

  useEffect(() => { void refreshShops(); }, [refreshShops]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => setListPage(1), [page, shopID]);

  const visibleShops = useMemo(
    () => page === "Orders" && providerFilter !== "ALL"
      ? shops.filter((shop) => shop.provider_profile === providerFilter)
      : shops,
    [page, providerFilter, shops],
  );
  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === shopID),
    [shopID, shops],
  );

  const chooseOrderProvider = (profile: string) => {
    setProviderFilter(profile);
    if (profile === "ALL") return;
    const matching = shops.filter((shop) => shop.provider_profile === profile);
    setShopID((current) =>
      matching.some((shop) => shop.id === current) ? current : matching[0]?.id || "",
    );
  };

  return {
    data: resource?.scope === scope ? resource.data : null,
    loading: Boolean(token && ((!shopsLoaded && page !== "Documentation") || (route && (resource?.scope !== scope || resource.loading)))),
    error: resource?.scope === scope ? resource.error : "",
    shopsError,
    shops,
    shopID,
    setShopID,
    providerFilter,
    visibleShops,
    selectedShop,
    chooseOrderProvider,
    listPage,
    setListPage,
    refresh,
    refreshShops,
  };
}
