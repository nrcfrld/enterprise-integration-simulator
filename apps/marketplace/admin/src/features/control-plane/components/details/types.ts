import type { DetailRequest } from "@/shared/types/controlPlane";
export interface DetailItem {
  id?: string;
  sku: string;
  product_name: string;
  quantity: number;
  allocated_quantity?: number;
  remaining_quantity?: number;
  price?: number;
}

export interface ShipmentSummary {
  package_id?: string;
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

export interface DomainEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  payload?: unknown;
  aggregate_id?: string;
  aggregate_type?: string;
  deliveries?: Array<{ id: string; event_id: string; status: string; attempt_count: number }>;
}

export interface DetailData {
  webhook_deleted?: boolean;
  provider_profile?: string;
  event_id?: string;
  webhook?: { id: string; url: string; enabled: boolean; deleted: boolean };
  event?: { id: string; event_type: string; aggregate_id: string; aggregate_type: string; occurred_at: string; payload: unknown };
  id?: string;
  shop_id?: string;
  sku?: string;
  category?: string;
  description?: string;
  price?: number;
  stock?: number;
  status?: string;
  package_id?: string;
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
    available_actions?: string[];
    cancellation_options?: Array<{ actor: string; reasons: string[] }>;
    provider_status?: string;
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
  shipments?: ShipmentSummary[];
  packages?: Array<{ id: string; status: string; warehouse_id?: string; items?: DetailItem[] }>;
  fulfillment?: { warehouse_name?: string; warehouse_code?: string; warehouse_id?: string };
  warehouse?: { warehouse_id?: string; warehouse_name?: string; warehouse_code?: string; name?: string; code?: string };
  events?: DomainEvent[];
  warehouse_inventory?: Array<{ warehouse_id: string; name: string; code: string; status: string; priority: number; on_hand_quantity: number; reserved_quantity: number; available_quantity: number }>;
  deliveries?: Array<{ id: string; status: string; attempt_count: number; event_id: string }>;
  inventory?: WarehouseInventoryItem[];
  attempts?: Array<{
    id: string;
    attempt: number;
    status: string;
    request_body?: string | null;
    request_url?: string | null;
    request_headers?: Record<string, string>;
    response_headers?: Record<string, string>;
    started_at?: string | null;
    created_at?: string;
    provider_profile?: string | null;
    signing_client_id?: string | null;
    http_attempted?: boolean | null;
    failure_code?: string | null;
    failure_reason?: string | null;
    response_body_truncated?: boolean | null;
    response_status?: number;
    duration_ms: number;
    response_body?: string;
  }>;
}

export interface DetailContentProps {
  onOpen?: (detail: DetailRequest) => void;
  data: DetailData;
  token: string | null | undefined;
  onReload: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}
