export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type ProviderContract = "shared" | "shopee" | "tokopedia";

export interface FieldDefinition {
  name: string;
  label: string;
  help: string;
  initial?: string;
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
  | "quickstart"
  | "try"
  | "authentication"
  | "webhooks"
  | "products"
  | "warehouses"
  | "orders"
  | "errors";
