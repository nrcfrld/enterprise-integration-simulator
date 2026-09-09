import type { IntegrationCredentials, PortalEndpoint } from "../types";
import { buildCanonicalRequest, buildShopeeCanonicalRequest, buildTokopediaSigningInput, signCanonicalRequest, signTokopediaRequest } from "./signing";

export interface RequestDraft {
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body: string;
  idempotencyKey: string;
  timeoutSeconds: number;
}
export interface RequestInput {
  method: PortalEndpoint["method"];
  contract: PortalEndpoint["contract"];
  url: string;
  body?: string;
  idempotencyKey?: string;
}
export interface PreparedRequest extends RequestInput {
  headers: Record<string, string>;
  canonical: string;
}

export function requestInput(endpoint: PortalEndpoint, api: string, draft: RequestDraft): RequestInput {
  const path = endpoint.path.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(draft.pathParams[key] || `{${key}}`));
  const url = new URL(path, api);
  for (const [key, value] of Object.entries(draft.query)) if (value.trim()) url.searchParams.set(key, value);
  return { method: endpoint.method, contract: endpoint.contract, url: url.href,
    body: endpoint.body === undefined ? undefined : draft.body,
    idempotencyKey: endpoint.idempotent ? draft.idempotencyKey : undefined };
}

export async function prepareRequest(input: RequestInput, credentials: IntegrationCredentials, timestamp = String(Math.floor(Date.now() / 1000))): Promise<PreparedRequest> {
  const url = new URL(input.url);
  const body = input.body ?? "";
  const clientID = credentials.clientID.trim();
  const headers: Record<string, string> = {};
  let canonical: string;
  if (input.contract === "tokopedia") {
    url.searchParams.set("app_key", clientID);
    url.searchParams.set("timestamp", timestamp);
    const signed = await signTokopediaRequest(credentials.secret, url.pathname, url.searchParams, body);
    canonical = `[CLIENT_SECRET]${buildTokopediaSigningInput(url.pathname, url.searchParams, body)}[CLIENT_SECRET]`;
    url.searchParams.set("sign", signed.signature);
    headers["x-tts-access-token"] = credentials.accessToken.trim();
  } else {
    canonical = input.contract === "shared" ? buildCanonicalRequest(input.method, url.pathname, timestamp, body)
      : buildShopeeCanonicalRequest(clientID, url.pathname, timestamp, body);
    const prefix = input.contract === "shared" ? "X-" : "X-Shopee-";
    headers[input.contract === "shared" ? "X-Client-Id" : "X-Shopee-Partner-Id"] = clientID;
    headers[`${prefix}Timestamp`] = timestamp;
    headers[`${prefix}Signature`] = await signCanonicalRequest(credentials.secret, canonical);
  }
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.idempotencyKey !== undefined) headers["Idempotency-Key"] = input.idempotencyKey;
  return { ...input, url: url.href, headers, canonical };
}

export function requestEvidence(request: PreparedRequest): string {
  const headers = { ...request.headers };
  if (headers["x-tts-access-token"]) headers["x-tts-access-token"] = "[ACCESS_TOKEN: redacted]";
  return `${request.method} ${request.url}\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\n")}\n\n${request.body ?? ""}`;
}
