import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { DetailRequest } from "@/shared/types/controlPlane";
import type { DetailData } from "../components/details/types";

export function detailPath(detail: DetailRequest): string {
  switch (detail.type) {
    case "product":
      return `/control/v1/shops/${detail.shopID}/products/${detail.id}`;
    case "order":
      return `/control/v1/orders/${detail.id}`;
    case "shipment":
      return `/control/v1/shipments/${detail.id}`;
    case "package":
      return `/control/v1/packages/${detail.id}`;
    case "warehouse":
      return `/control/v1/warehouses/${detail.id}`;
    case "delivery":
      return `/control/v1/deliveries/${detail.id}`;
  }
}

export function useDetailData(
  detail: DetailRequest,
  token: string | null | undefined,
) {
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const version = useRef(0);
  const active = useRef(false);
  const path = detailPath(detail);
  useLayoutEffect(() => {
    active.current = true;
    version.current++;
    return () => { active.current = false; };
  }, [path, token]);
  const reload = useCallback(async () => {
    const current = ++version.current;
    setRefreshing(true);
    setLoadError("");
    try {
      const result = await controlPlaneRequest<DetailData>(path, token);
      if (active.current && current === version.current) {
        setData(result);
        setUpdatedAt(Date.now());
      }
    } catch (reason) {
      if (active.current && current === version.current) setLoadError(reason instanceof Error ? reason.message : "Request failed");
      throw reason;
    } finally {
      if (active.current && current === version.current) setRefreshing(false);
    }
  }, [path, token]);
  const refresh = useCallback(async () => { try { await reload(); } catch { /* Render the load error; keep the last successful response. */ } }, [reload]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, error: error || loadError, setError, reload, refresh, refreshing, updatedAt };
}
