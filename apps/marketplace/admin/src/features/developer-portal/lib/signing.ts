export const prettyJSON = (value: string): string => {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return value;
  }
};

export const createIdempotencyKey = (): string =>
  crypto.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const buildCanonicalRequest = (
  method: string,
  pathname: string,
  timestamp: string,
  rawBody: string,
): string => `${method}${pathname}${timestamp}${rawBody}`;

export async function signCanonicalRequest(secret: string, canonical: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable. Open this console from localhost or a secure origin.");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)),
  );

  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const buildShopeeCanonicalRequest = (
  partnerID: string,
  pathname: string,
  timestamp: string,
  rawBody: string,
): string => `${partnerID}${pathname}${timestamp}${rawBody}`;

export function buildTokopediaSigningInput(pathname: string, query: URLSearchParams, rawBody: string): string {
  const entries = [...query.entries()]
    .filter(([key]) => key !== "sign" && key !== "access_token")
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  return `${pathname}${entries.map(([key, value]) => `${key}${value}`).join("")}${rawBody}`;
}

export async function signTokopediaRequest(
  secret: string,
  pathname: string,
  query: URLSearchParams,
  rawBody: string,
): Promise<{ canonical: string; signature: string }> {
  const signingInput = buildTokopediaSigningInput(pathname, query, rawBody);
  const canonical = `${secret}${signingInput}${secret}`;
  return { canonical, signature: await signCanonicalRequest(secret, canonical) };
}
