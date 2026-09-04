import { useCallback, useEffect, useMemo, useState } from "react";
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
  onError: (message: string) => void,
) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopID, setShopID] = useState("");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [data, setData] = useState<ControlPlaneData | null>(null);
  const [listPage, setListPage] = useState(1);
  const endpoint = pageEndpoint(page, shopID);
  const route = endpoint && PAGEABLE_CONTROL_PAGES.has(page)
    ? `${endpoint}?page=${listPage}&limit=20`
    : endpoint;

  const refreshShops = useCallback(async () => {
    const result = await controlPlaneRequest<ListResponse<Shop>>("/control/v1/shops", token);
    setShops(result.data);
    setShopID((current) => current || result.data[0]?.id || "");
  }, [token]);

  const refresh = useCallback(async () => {
    if (!route) {
      setData(null);
      return;
    }
    setData(await controlPlaneRequest<ControlPlaneData>(route, token));
  }, [route, token]);

  useEffect(() => {
    if (!token) {
      setShops([]);
      setShopID("");
      setProviderFilter("ALL");
      setData(null);
      return;
    }
    void refreshShops().catch((error: unknown) =>
      onError(error instanceof Error ? error.message : "Request failed"),
    );
  }, [onError, refreshShops, token]);

  useEffect(() => {
    if (!token) return;
    void refresh().catch((error: unknown) =>
      onError(error instanceof Error ? error.message : "Request failed"),
    );
  }, [onError, refresh, token]);

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
    data,
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
