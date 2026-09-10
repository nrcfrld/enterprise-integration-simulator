export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type ProviderContract = "shared" | "shopee" | "tokopedia";

export interface FieldDefinition {
  name: string;
  label: string;
  help: string;
  initial?: string;
  type?: string;
  required?: boolean;
  values?: string[];
}

export interface SchemaFieldDefinition {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
}

export interface PortalEndpoint {
  id: string;
  group: "Products" | "Orders" | "Fulfillment" | "Warehouses" | "Webhooks";
  contract: ProviderContract;
  method: HttpMethod;
  path: string;
  title: string;
  summary: string;
  query?: FieldDefinition[];
  pathParams?: FieldDefinition[];
  /** An omitted body means this endpoint sends no request body. */
  body?: string;
  /** Field-level request body documentation displayed by the API reference. */
  bodyFields?: SchemaFieldDefinition[];
  /** True when retries must reuse an Idempotency-Key. */
  idempotent?: boolean;
  outcome: string;
  response: string;
  errorResponse: string;
}

export interface IntegrationCredentials {
  clientID: string;
  secret: string;
  accessToken: string;
}

export interface SimulatorResponse {
  rawBody?: string;
  status: string;
  body: string;
  headers: Array<[string, string | null]>;
}

export interface SimulatorState {
  status: "idle" | "loading" | "complete" | "error";
  error: string;
  canonical: string;
  result: SimulatorResponse | null;
}

export type PortalSection =
  | "consumer"
  | "quickstart"
  | "try"
  | "authentication"
  | "control-plane"
  | "webhooks"
  | "products"
  | "warehouses"
  | "orders"
  | "errors";

export const PORTAL_SECTION_TITLES: Record<PortalSection, string> = {
  quickstart: "Start here",
  try: "Request simulator",
  consumer: "Durable consumer exercise",
  authentication: "Request signing",
  "control-plane": "Control Plane accounts",
  products: "Products API reference",
  warehouses: "Warehouses API reference",
  orders: "Orders and fulfilment API reference",
  webhooks: "Webhook API reference",
  errors: "Errors and limits",
};
