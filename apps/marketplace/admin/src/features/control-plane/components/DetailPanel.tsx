import { useState } from "react";
import type { Shop, DetailRequest } from "@/shared/types/controlPlane";
import { useDetailData } from "../hooks/useDetailData";
import { DeliveryDetail } from "./details/DeliveryDetail";
import { OrderDetail } from "./details/OrderDetail";
import { PackageDetail } from "./details/PackageDetail";
import { ProductDetail } from "./details/ProductDetail";
import { ShipmentDetail } from "./details/ShipmentDetail";
import { WarehouseDetail } from "./details/WarehouseDetail";
import type { DetailContentProps } from "./details/types";

interface DetailPanelProps {
  shop?: Shop;
  detail: DetailRequest;
  token: string | null | undefined;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
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
  const current = history.at(-1) ?? props.detail;
  return <DetailPanelContent key={`${current.type}:${current.id}`} {...props} detail={current} onOpen={(next) => setHistory(previous => [...previous, next])} onBack={history.length ? () => setHistory(previous => previous.slice(0, -1)) : undefined} />;
}

function DetailPanelContent({
  onOpen, onBack,
  shop,
  detail,
  token,
  onClose,
  onRefresh,
  onNotice,
}: DetailPanelProps & { onOpen: (detail: DetailRequest) => void; onBack?: () => void }) {
  const { data, error, setError, reload } = useDetailData(detail, token);
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
    <div className="modal-backdrop modal modal-open">
      <section
        className="modal-card modal-box detail-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.type} details`}
      >
        {onBack && <button type="button" className="link-button" onClick={onBack}>Back to previous resource</button>}
        {shop && <p>{shop.name} · {shop.provider_profile} · {shop.id}</p>}
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{detailLabels[detail.type]}</p>
            <h2>
              {data?.tracking_number || data?.order_number || data?.name || data?.id || "Loading…"}
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
        {error && <p className="error alert alert-error" role="alert">{error}</p>}
        {contentProps && detail.type === "product" && <ProductDetail data={contentProps.data} />}
        {contentProps && detail.type === "order" && <OrderDetail {...contentProps} />}
        {contentProps && detail.type === "shipment" && <ShipmentDetail {...contentProps} />}
        {contentProps && detail.type === "package" && <PackageDetail data={contentProps.data} onOpen={onOpen} />}
        {contentProps && detail.type === "warehouse" && <WarehouseDetail {...contentProps} />}
        {contentProps && detail.type === "delivery" && <DeliveryDetail data={contentProps.data} />}
      </section>
    </div>
  );
}
