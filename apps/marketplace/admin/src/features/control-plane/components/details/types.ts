export interface DetailItem {
  id?: string;
  sku: string;
  product_name: string;
  quantity: number;
  price?: number;
}

export interface ShipmentSummary {
  id?: string;
  status?: string;
  tracking_number?: string;
  shipping_provider?: string;
}

export interface WarehouseInventoryItem {
  product_id: string;
  sku: string;
  product_name: string;
  on_hand_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}

export interface DetailData {
  webhook_deleted?: boolean;
  id?: string;
  shop_id?: string;
  sku?: string;
  category?: string;
  description?: string;
  price?: number;
  stock?: number;
  status?: string;
  order_id?: string;
  order_number?: string;
  order_status?: string;
  tracking_number?: string;
  shipping_provider?: string;
  pickup_type?: string;
  created_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  failed_at?: string;
  returned_at?: string;
  delivery_failure_reason?: string;
  priority?: number;
  name?: string;
  code?: string;
  attempt_count?: number;
  payment?: { status?: string; reference?: string };
  operations?: {
    provider_profile?: string;
    payment_status?: string;
    payment_expires_at?: string;
    seller_deadline_at?: string;
    payment_failure_reason?: string;
    cancellation_actor?: string;
    cancellation_reason?: string;
  };
  customer_data?: { name?: string; phone?: string };
  shipping_address?: { address_line?: string; city?: string; postal_code?: string };
  address?: { address_line?: string; city?: string; postal_code?: string };
  items?: DetailItem[];
  shipment?: ShipmentSummary;
  fulfillment?: { warehouse_name?: string; warehouse_code?: string; warehouse_id?: string };
  warehouse?: { warehouse_name?: string; warehouse_code?: string; name?: string; code?: string };
  events?: Array<{ id: string; event_type: string; occurred_at: string }>;
  deliveries?: Array<{ id: string; status: string; attempt_count: number; event_id: string }>;
  inventory?: WarehouseInventoryItem[];
  attempts?: Array<{
    id: string;
    attempt: number;
    status: string;
    response_status?: number;
    duration_ms: number;
    response_body?: string;
  }>;
}

export interface DetailContentProps {
  data: DetailData;
  token: string | null | undefined;
  onReload: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}
