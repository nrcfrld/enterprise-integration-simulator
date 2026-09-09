import type { RequestInput } from "./preparedRequest";
import type { PortalEndpoint } from "../types";

const endpointPath = (endpoint: PortalEndpoint) => endpoint.path.replace(/\{[^}]+\}/g, "replace-with-id");

export function buildNodeExample(endpoint: PortalEndpoint, input?: RequestInput): string {
  const url = input ? new URL(input.url) : undefined;
  // Authentication is regenerated for each attempt. Never export live credentials.
  for (const key of ["app_key", "timestamp", "sign", "access_token"]) url?.searchParams.delete(key);
  const raw = input?.body ?? endpoint.body ?? "";
  if (raw) {
    try { JSON.parse(raw); } catch { return "// Fix the JSON request body before exporting this request."; }
  }
  const bodyParts: string[] = [];
  let offset = 0;
  // Preserve surrounding whitespace and escaped bytes, replacing only secret values.
  for (const match of raw.matchAll(/("(?:\\.|[^"\\])*")(\s*:\s*)("(?:\\.|[^"\\])*")/g)) {
    if (JSON.parse(match[1]) !== "secret" || !JSON.parse(match[3])) continue;
    const start = match.index! + match[1].length + match[2].length;
    bodyParts.push(JSON.stringify(raw.slice(offset, start)), 'JSON.stringify(process.env.WEBHOOK_SECRET ?? (() => { throw new Error("Set WEBHOOK_SECRET"); })())');
    offset = start + match[3].length;
  }
  bodyParts.push(JSON.stringify(raw.slice(offset)));
  const bodyExpression = bodyParts.join(" + ");
  const retryKey = input?.idempotencyKey ? JSON.stringify(input.idempotencyKey) : 'process.env.IDEMPOTENCY_KEY';
  const setup = [
    'import crypto from "node:crypto";',
    "",
    `const baseURL = process.env.MARKETPLACE_BASE_URL ?? ${JSON.stringify(url?.origin ?? "http://localhost:18080")};`,
    'const clientID = process.env.MARKETPLACE_CLIENT_ID;',
    'const clientSecret = process.env.MARKETPLACE_CLIENT_SECRET;',
    'if (!clientID || !clientSecret) throw new Error("Set MARKETPLACE_CLIENT_ID and MARKETPLACE_CLIENT_SECRET");',
    `const method = "${endpoint.method}";`,
    `const path = ${JSON.stringify(url ? url.pathname + url.search : endpointPath(endpoint))};`,
    `const body = ${bodyExpression};`,
    "const timestamp = Math.floor(Date.now() / 1000).toString();",
    "const url = new URL(path, baseURL);",
  ];
  if (endpoint.contract === "shared") {
    setup.push(
      "const signingInput = method + url.pathname + timestamp + body;",
      'const signature = crypto.createHmac("sha256", clientSecret).update(signingInput).digest("hex");',
      "const headers = {",
      '  "X-Client-Id": clientID, "X-Timestamp": timestamp, "X-Signature": signature,',
      ...(endpoint.body === undefined ? [] : ['  "Content-Type": "application/json",']),
      ...(endpoint.idempotent ? [`  "Idempotency-Key": ${retryKey},`] : []),
      "};",
    );
  } else if (endpoint.contract === "shopee") {
    setup.push(
      "const signingInput = clientID + url.pathname + timestamp + body;",
      'const signature = crypto.createHmac("sha256", clientSecret).update(signingInput).digest("hex");',
      "const headers = {",
      '  "X-Shopee-Partner-Id": clientID, "X-Shopee-Timestamp": timestamp, "X-Shopee-Signature": signature,',
      ...(endpoint.body === undefined ? [] : ['  "Content-Type": "application/json",']),
      ...(endpoint.idempotent ? [`  "Idempotency-Key": ${retryKey},`] : []),
      "};",
    );
  } else {
    setup.push(
      'const accessToken = process.env.MARKETPLACE_ACCESS_TOKEN;',
      'if (!accessToken) throw new Error("Set MARKETPLACE_ACCESS_TOKEN");',
      'url.searchParams.set("app_key", clientID);',
      'url.searchParams.set("timestamp", timestamp);',
      'const sorted = [...url.searchParams.entries()].filter(([key]) => key !== "sign" && key !== "access_token").sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));',
      'const signingInput = clientSecret + url.pathname + sorted.map(([key, value]) => key + value).join("") + body + clientSecret;',
      'url.searchParams.set("sign", crypto.createHmac("sha256", clientSecret).update(signingInput).digest("hex"));',
      "const headers = {",
      '  "x-tts-access-token": accessToken,',
      ...(endpoint.body === undefined ? [] : ['  "Content-Type": "application/json",']),
      ...(endpoint.idempotent ? [`  "Idempotency-Key": ${retryKey},`] : []),
      "};",
    );
  }
  setup.push(
    "",
    ...(endpoint.idempotent ? ['if (!headers["Idempotency-Key"]) throw new Error("Set IDEMPOTENCY_KEY once per operation; reuse it on retries");'] : []),
    "const response = await fetch(url, { method, headers, body: body || undefined });",
    "console.log(Object.fromEntries(response.headers));",
    "console.log(response.status, await response.text());",
  );
  return setup.join("\n");
}
