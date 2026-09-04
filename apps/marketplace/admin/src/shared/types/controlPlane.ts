export interface ControlPlaneSession {
  token: string;
  user: {
    id: string;
    email: string;
    role: "ADMIN" | "OPERATOR";
  };
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export type ProviderProfile = "SHOPEE_LIKE" | "TOKOPEDIA_LIKE";
export type ControlRole = ControlPlaneSession["user"]["role"];

export interface NoticeMessage {
  type: "success" | "error";
  text: string;
}

export interface Shop extends ResourceRecord {
  id: string;
  name: string;
  status: string;
  provider_profile: ProviderProfile;
}

export interface ProductSummary extends ResourceRecord {
  id: string;
  sku: string;
  name: string;
  stock: number;
}

export interface WarehouseSummary extends ResourceRecord {
  id: string;
  code: string;
  name: string;
}

export interface WebhookRegistration extends ResourceRecord {
  id: string;
  url: string;
  subscribed_events: string[];
  enabled: boolean;
}

export interface ResourceRecord extends Record<string, unknown> {
  id: string;
  name?: string;
  status?: string;
}

export interface ControlPlaneData {
  data?: ResourceRecord[];
  pagination?: PaginationMetadata;
  shops?: number;
  orders?: number;
  failed_deliveries?: number;
  setup?: {
    ready: boolean;
    seeded: boolean;
    products: number;
    credential_active: boolean;
    webhook_configured: boolean;
    webhook_enabled: boolean;
  };
  api_slow_ms?: number;
  api_slow_probability?: number;
  api_random_500_probability?: number;
  api_timeout_probability?: number;
  webhook_delay_seconds?: number;
  force_rate_limit?: boolean;
  webhook_duplicate?: boolean;
  webhook_out_of_order?: boolean;
  webhook_force_failure?: boolean;
}

export type FormKind =
  | "shop"
  | "package"
  | "product"
  | "warehouse"
  | "user"
  | "order"
  | "credential"
  | "webhook";

export interface FormInitial extends Record<string, unknown> {
  id: string;
  address?: {
    address_line?: string;
    city?: string;
    postal_code?: string;
  };
}

export interface FormRequest {
  kind: FormKind;
  initial?: FormInitial;
}

export type DetailRequest =
  | { type: "product"; id: string; shopID: string }
  | { type: "order" | "shipment" | "package" | "warehouse" | "delivery"; id: string };

export type DetailType = DetailRequest["type"];

export interface ListResponse<T> {
  data: T[];
  pagination?: PaginationMetadata;
}

export interface SeedResult {
  products_seeded: number;
  orders_seeded: number;
}
