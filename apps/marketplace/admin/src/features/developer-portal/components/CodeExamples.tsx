import type { PortalEndpoint } from "../types";
import { CodeSnippet } from "./CodeSnippet";

const endpointPath = (endpoint: PortalEndpoint) => endpoint.path.replace(/\{[^}]+\}/g, "replace-with-id");

function nodeExample(endpoint: PortalEndpoint): string {
  const setup = [
    'import crypto from "node:crypto";',
    "",
    'const baseURL = process.env.MARKETPLACE_BASE_URL ?? "http://localhost:18080";',
    'const clientID = process.env.MARKETPLACE_CLIENT_ID;',
    'const clientSecret = process.env.MARKETPLACE_CLIENT_SECRET;',
    'if (!clientID || !clientSecret) throw new Error("Set MARKETPLACE_CLIENT_ID and MARKETPLACE_CLIENT_SECRET");',
    `const method = "${endpoint.method}";`,
    `const path = "${endpointPath(endpoint)}";`,
    `const body = ${JSON.stringify(endpoint.body ?? "")};`,
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
      ...(endpoint.method === "POST" || endpoint.method === "PATCH" || endpoint.method === "PUT" || endpoint.method === "DELETE" ? ['  "Idempotency-Key": crypto.randomUUID(),'] : []),
      "};",
    );
  } else if (endpoint.contract === "shopee") {
    setup.push(
      "const signingInput = clientID + url.pathname + timestamp + body;",
      'const signature = crypto.createHmac("sha256", clientSecret).update(signingInput).digest("hex");',
      "const headers = {",
      '  "X-Shopee-Partner-Id": clientID, "X-Shopee-Timestamp": timestamp, "X-Shopee-Signature": signature,',
      ...(endpoint.body === undefined ? [] : ['  "Content-Type": "application/json",']),
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
      "};",
    );
  }
  setup.push(
    "",
    "const response = await fetch(url, { method, headers, body: body || undefined });",
    "console.log(response.status, await response.text());",
  );
  return setup.join("\n");
}

interface CodeExamplesProps {
  endpoint: PortalEndpoint;
}

export function CodeExamples({ endpoint }: CodeExamplesProps) {
  return (
    <section className="code-examples">
      <h3>Run this exact request from Node.js</h3>
      <p>Replace a path placeholder with an id from the list response, set the environment variables, then run the file with Node 20+ or Bun. The signing input matches the simulator.</p>
      <CodeSnippet value={nodeExample(endpoint)} language="javascript" />
    </section>
  );
}
