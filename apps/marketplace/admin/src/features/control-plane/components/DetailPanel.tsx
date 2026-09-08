import { RefreshStatus } from "./RefreshStatus";
import { isPendingDelivery, useBoundedRefresh } from "../hooks/useBoundedRefresh";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { Shop, DetailRequest } from "@/shared/types/controlPlane";
import { useDetailData } from "../hooks/useDetailData";
import { DeliveryDetail } from "./details/DeliveryDetail";
import { OrderDetail } from "./details/OrderDetail";
import { PackageDetail } from "./details/PackageDetail";
import { ProductDetail } from "./details/ProductDetail";
import { ShipmentDetail } from "./details/ShipmentDetail";
import { WarehouseDetail } from "./details/WarehouseDetail";
import type { DetailContentProps } from "./details/types";
import { AccessibleDialog } from "./AccessibleDialog";

interface DetailPanelProps {
  onManageWebhook?: () => void;
  shop?: Shop;
  detail: DetailRequest;
  token: string | null | undefined;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const detailLabels: Record<DetailRequest["type"], string> = {
  product: "Product catalogue",
  order: "Order event trail",
  shipment: "Shipment fulfillment",
  package: "Package allocation",
  warehouse: "Warehouse inventory",
  delivery: "Webhook delivery",
};

export function DetailPanel(props: DetailPanelProps) {
  const [history, setHistory] = useState<DetailRequest[]>([]);
  const initialFocusRef = useRef<HTMLHeadingElement>(null);
  const current = history.at(-1) ?? props.detail;
  useLayoutEffect(() => {
    initialFocusRef.current?.focus({ preventScroll: true });
  }, [current.id, current.type]);
  return (
    <AccessibleDialog
      ariaLabel={`${current.type} details`}
      backdropClassName="modal-backdrop modal modal-open"
      className="modal-card modal-box detail-card"
      initialFocusRef={initialFocusRef}
      onClose={props.onClose}
      returnFocusRef={props.returnFocusRef}
    >
      <DetailPanelContent
        key={`${current.type}:${current.id}`}
        {...props}
        detail={current}
        initialFocusRef={initialFocusRef}
        onOpen={(next) => setHistory(previous => [...previous, next])}
        onBack={history.length ? () => setHistory(previous => previous.slice(0, -1)) : undefined}
      />
    </AccessibleDialog>
  );
}

function DetailPanelContent({
  onOpen, onBack, onManageWebhook,
  shop,
  detail,
  token,
  onClose,
  onRefresh,
  onNotice,
  initialFocusRef,
}: DetailPanelProps & {
  initialFocusRef: RefObject<HTMLHeadingElement | null>;
  onOpen: (detail: DetailRequest) => void;
  onBack?: () => void;
}) {
  const { data, error, setError, reload, refresh, refreshing, updatedAt } = useDetailData(detail, token);
  const pending = detail.type === "delivery" ? isPendingDelivery(data?.status)
    : detail.type === "order" && Boolean(data?.events?.length) && (!data?.deliveries?.length || data.deliveries.some(item => isPendingDelivery(item.status)));
  const checks = useBoundedRefresh(`${detail.type}:${detail.id}`, Boolean(data && !error && pending), refresh);
  const contentProps: DetailContentProps | null = data
    ? {
        data,
        onOpen,
        token,
        onReload: reload,
        onRefresh,
        onNotice,
        onError: setError,
      }
    : null;

  return (
    <>
        {onBack && <button type="button" className="link-button" onClick={onBack}>Back to previous resource</button>}
        {shop && <p>{shop.name} · {shop.provider_profile} · {shop.id}</p>}
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{detailLabels[detail.type]}</p>
            <h2 ref={initialFocusRef} tabIndex={-1}>
              {data?.tracking_number || data?.order_number || data?.name || data?.id || (error ? "Details unavailable" : "Loading…")}
            </h2>
          </div>
          <button
            aria-label="Close details"
            className="icon-button btn btn-circle btn-ghost btn-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <RefreshStatus refreshing={refreshing} updatedAt={updatedAt} polling={checks.polling} onRefresh={checks.refreshNow} />
        {!data && refreshing && <p role="status">Loading details…</p>}
        {error && <p className="error alert alert-error" role="alert">{error} {data && "Previously loaded details remain visible."} <button disabled={refreshing} onClick={() => { setError(""); void checks.refreshNow(); }}>Retry loading details</button></p>}
        {contentProps && detail.type === "product" && <ProductDetail {...contentProps} />}
        {contentProps && detail.type === "order" && <OrderDetail {...contentProps} />}
        {contentProps && detail.type === "shipment" && <ShipmentDetail {...contentProps} />}
        {contentProps && detail.type === "package" && <PackageDetail data={contentProps.data} onOpen={onOpen} />}
        {contentProps && detail.type === "warehouse" && <WarehouseDetail {...contentProps} />}
        {contentProps && detail.type === "delivery" && <DeliveryDetail data={contentProps.data} onOpen={onOpen} onManageWebhook={onManageWebhook} />}
    </>
  );
}
