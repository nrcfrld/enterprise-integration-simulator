import { useCallback, useEffect, useState } from "react";
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
  const path = detailPath(detail);
  const reload = useCallback(async () => {
    setData(await controlPlaneRequest<DetailData>(path, token));
  }, [path, token]);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    controlPlaneRequest<DetailData>(path, token)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Request failed");
      });
    return () => {
      active = false;
    };
  }, [path, token]);

  return { data, error, setError, reload };
}
