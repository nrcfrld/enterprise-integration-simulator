// @vitest-environment node
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ENDPOINT_BY_ID } from "../data/endpoints";
import { buildNodeExample } from "./nodeExample";
import { prepareRequest, requestEvidence, requestInput, type RequestDraft } from "./preparedRequest";

const credentials = { clientID: "client-one", secret: "private-signing-secret", accessToken: "private-access-token" };
const timestamp = "1788566400";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

describe("prepared requests and Node exports", () => {
  it.each(["register-webhook", "shopee-cancel-order", "tokopedia-configure-webhook"])("exports edited bytes, query and retry identity for %s", async id => {
    const endpoint = ENDPOINT_BY_ID[id];
    const draft: RequestDraft = { pathParams: { id: "ord with space" }, query: { keyword: "mug & bowl", page_no: "3" },
      body: '{ "note" : "edited", "secret" : "callback-private" }\n', idempotencyKey: "retry-original-key", timeoutSeconds: 30 };
    const input = requestInput(endpoint, "http://localhost:18080", draft);
    const prepared = await prepareRequest(input, credentials, timestamp);
    const source = buildNodeExample(endpoint, input);
    for (const secret of [credentials.secret, credentials.accessToken, "callback-private"]) expect(source).not.toContain(secret);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), text: async () => "{}" });
    await new AsyncFunction("crypto", "fetch", "process", "Date", "console", source.replace('import crypto from "node:crypto";', ""))(
      crypto, fetchMock, { env: { MARKETPLACE_CLIENT_ID: credentials.clientID, MARKETPLACE_CLIENT_SECRET: credentials.secret,
        MARKETPLACE_ACCESS_TOKEN: credentials.accessToken, WEBHOOK_SECRET: "callback-private" } }, { now: () => Number(timestamp) * 1000 }, { log: () => {} },
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(prepared.url);
    expect(options).toMatchObject({ method: prepared.method, headers: prepared.headers, body: prepared.body });
    expect(source).toContain("retry-original-key");
    expect(source).not.toContain("randomUUID");
  });

  it("redacts Tokopedia credential secrets but retains generated request parameters", async () => {
    const ready = await prepareRequest({ method: "POST", contract: "tokopedia", url: "http://localhost:18080/api/tokopedia/v202309/orders/search", body: '{"page_size":20}' }, credentials, timestamp);
    expect(ready.canonical).not.toContain(credentials.secret);
    expect(ready.canonical).toContain("[CLIENT_SECRET]");
    const evidence = requestEvidence(ready);
    expect(evidence).not.toContain(credentials.accessToken);
    expect(evidence).toContain("app_key=client-one");
    expect(evidence).toContain(`timestamp=${timestamp}`);
    expect(evidence).toContain("sign=");
    expect(ready.headers["x-tts-access-token"]).toBe(credentials.accessToken);
  });
});

it("keeps an invalid body editable instead of crashing code export", () => {
  expect(buildNodeExample(ENDPOINT_BY_ID["register-webhook"], { method: "POST", contract: "shared", url: "http://localhost:18080/api/v1/webhooks", body: '{"secret":"bad\\q"}' })).toContain("Fix the JSON request body");
});
