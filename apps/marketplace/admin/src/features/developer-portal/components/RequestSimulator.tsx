import { EventCatalog } from "./EventCatalog";
import { InventoryGuide } from "./InventoryGuide";
import type { ProviderProfile } from "@/shared/types/controlPlane";
import { ShipmentMode } from "./ShipmentMode";
import { WebhookVerification } from "./WebhookVerification";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createIdempotencyKey, prettyJSON } from "../lib/signing";
import { prepareRequest, requestInput, requestEvidence, type RequestDraft, type PreparedRequest } from "../lib/preparedRequest";
import { CodeExamples } from "./CodeExamples";
import { ResultNavigation } from "./ResultNavigation";
import type { IntegrationCredentials, PortalEndpoint, SimulatorState } from "../types";
import { CodeSnippet } from "./CodeSnippet";
import { ShopeeOrderResults } from "./ShopeeOrderResults";

const initialState: SimulatorState = { status: "idle", error: "", canonical: "", result: null };

const fieldsToValues = (fields: PortalEndpoint["pathParams"] | PortalEndpoint["query"], useInitial: boolean) =>
  Object.fromEntries((fields ?? []).map((field) => [field.name, useInitial ? field.initial ?? "" : ""]));

const contractLabel = (contract: PortalEndpoint["contract"]) => ({
  shared: "Shared HMAC",
  shopee: "Shopee-like partner signature",
  tokopedia: "Tokopedia-like app signature",
}[contract]);

const responseHeaders = (contract: PortalEndpoint["contract"], response: Response): Array<[string, string | null]> => {
  const names = contract === "shared"
    ? ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]
    : contract === "shopee"
      ? ["x-shopee-api-call-limit", "x-shopee-ratelimit-reset"]
      : ["x-tts-api-call-limit", "x-tts-ratelimit-remaining", "x-tts-ratelimit-reset"];
  names.push("retry-after", "idempotent-replayed", "x-request-id", "x-correlation-id", "x-tts-ratelimit-limit", "content-type");
  return names.filter((name) => response.headers.has(name)).map((name) => [name, response.headers.get(name)]);
};

export interface SavedRequestDraft { draft: RequestDraft; lastAttempt?: RequestDraft; lastClientID?: string }

interface RequestSimulatorProps {
  drafts?: Map<string, SavedRequestDraft>;
  onSelectResource?: (endpointID: string, id: string) => void;
  blockedReason?: string;
  shopProvider?: ProviderProfile;
  endpoint: PortalEndpoint;
  api: string;
  credentials: IntegrationCredentials;
  initialPackageID?: string;
  onSelectPackage?: (orderID: string, packageID: string) => void;
  initialPathParams?: Record<string, string>;
  onSelectOrder?: (orderID: string) => void;
}

export function RequestSimulator({ drafts, onSelectResource, blockedReason, shopProvider, endpoint, api, credentials, initialPathParams, onSelectOrder, initialPackageID, onSelectPackage }: RequestSimulatorProps) {
  const mutation = endpoint.idempotent === true;
  const hasBody = endpoint.body !== undefined;
  const saved = drafts?.get(endpoint.id);
  const [pathParams, setPathParams] = useState<Record<string, string>>(() => ({ ...(saved?.draft.pathParams ?? fieldsToValues(endpoint.pathParams, false)), ...initialPathParams }));
  const [query, setQuery] = useState<Record<string, string>>(() => saved?.draft.query ?? fieldsToValues(endpoint.query, true));
  const [body, setBody] = useState(initialPackageID ? JSON.stringify({ ...JSON.parse(endpoint.body || "{}"), package_id: initialPackageID }, null, 2) : saved?.draft.body ?? endpoint.body ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(saved?.draft.idempotencyKey ?? (mutation ? createIdempotencyKey() : ""));
  const [timeoutSeconds, setTimeoutSeconds] = useState(saved?.draft.timeoutSeconds ?? 30);
  const [lastClientID, setLastClientID] = useState(saved?.lastClientID);
  const credentialScope = `${credentials.clientID}:${credentials.secret}:${credentials.accessToken}`;
  const previousCredentials = useRef(credentialScope);
  const [lastAttempt, setLastAttempt] = useState<RequestDraft | undefined>(saved?.lastAttempt);
  const [prepared, setPrepared] = useState<PreparedRequest>();
  const [state, setState] = useState<SimulatorState>(initialState);
  const [elapsed, setElapsed] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const version = useRef(0);
  const started = useRef(0);
  const draft: RequestDraft = { pathParams, query, body, idempotencyKey, timeoutSeconds };
  const input = requestInput(endpoint, api, draft);
  const requestPath = new URL(input.url).pathname + new URL(input.url).search;
  useEffect(() => { drafts?.set(endpoint.id, { draft: { pathParams, query, body, idempotencyKey, timeoutSeconds }, lastAttempt, lastClientID }); }, [drafts, endpoint.id, pathParams, query, body, idempotencyKey, timeoutSeconds, lastAttempt, lastClientID]);
  useEffect(() => {
    if (previousCredentials.current === credentialScope) return;
    previousCredentials.current = credentialScope;
    version.current++; pending.current?.abort(); pending.current = undefined;
    setPrepared(undefined); setState(initialState);
  }, [credentialScope]);
  useEffect(() => () => { version.current++; pending.current?.abort(); }, []);
  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const restore = (value: RequestDraft) => {
    setPathParams(value.pathParams); setQuery(value.query); setBody(value.body);
    setIdempotencyKey(value.idempotencyKey); setTimeoutSeconds(value.timeoutSeconds);
  };
  const cancel = () => {
    version.current++; pending.current?.abort(); pending.current = undefined;
    setState(current => ({ ...current, status: "error", error: "Stopped waiting. A mutation may still complete on the server. Inspect current state or retry the same operation with its existing key." }));
  };
  const reset = () => {
    version.current++; pending.current?.abort(); pending.current = undefined;
    restore({ pathParams: fieldsToValues(endpoint.pathParams, false), query: fieldsToValues(endpoint.query, true), body: endpoint.body ?? "", idempotencyKey: mutation ? createIdempotencyKey() : "", timeoutSeconds: 30 });
    setLastAttempt(undefined); setLastClientID(undefined); setPrepared(undefined); setElapsed(0);
    setState(initialState);
  };
  const fail = (error: string) => setState(current => ({ ...current, status: "error", error }));
  const send = async (attempt: RequestDraft, retry = false) => {
    if (blockedReason || pending.current) return;
    if (!credentials.clientID.trim() || !credentials.secret.trim()) { fail("Paste the Client ID and client secret in Step 1 before sending a request."); return; }
    if (endpoint.contract === "tokopedia" && !credentials.accessToken.trim()) { fail("Tokopedia-like requests also need the one-time access token shown when you create the credential."); return; }
    if (endpoint.pathParams?.some(field => !attempt.pathParams[field.name]?.trim())) { fail("Fill in every required path value. Start with the matching list/search request and copy its returned id."); return; }
    if (mutation && !attempt.idempotencyKey.trim()) { fail("Enter an idempotency key; reuse it for retries of this operation."); return; }
    if (!Number.isFinite(attempt.timeoutSeconds) || attempt.timeoutSeconds < 1 || attempt.timeoutSeconds > 120) { fail("Timeout must be between 1 and 120 seconds."); return; }
    if (hasBody) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(attempt.body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch { fail("The request body must be valid JSON containing an object. Keep the property names and quotation marks intact."); return; }
      for (const field of endpoint.bodyFields ?? []) {
        if (field.name.includes(".")) continue;
        const value = parsed[field.name];
        if (field.required && (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length))) { fail(`Required body field: ${field.name}. ${field.description}`); return; }
      }
      if (parsed.page_size !== undefined && (!Number.isInteger(parsed.page_size) || Number(parsed.page_size) < 1 || Number(parsed.page_size) > 100)) { fail("page_size must be a whole number from 1 to 100."); return; }
    }
    if (mutation && lastAttempt?.idempotencyKey === attempt.idempotencyKey && lastClientID && lastClientID !== credentials.clientID.trim()) {
      fail("This operation was sent with another Client ID. Check its current state before choosing New operation; retry keys are scoped to credentials."); return;
    }
    const outgoing = requestInput(endpoint, api, attempt);
    if (!retry && mutation && lastAttempt && lastAttempt.idempotencyKey === attempt.idempotencyKey && JSON.stringify(requestInput(endpoint, api, lastAttempt)) !== JSON.stringify(outgoing)) {
      fail("This key was already used with different inputs. Retry the same operation, or choose New operation for your edited request."); return;
    }
    const currentVersion = ++version.current;
    const controller = new AbortController(); pending.current = controller;
    started.current = Date.now(); setElapsed(0); setPrepared(undefined);
    setState({ ...initialState, status: "loading" });
    setLastAttempt(attempt); setLastClientID(credentials.clientID.trim());
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, attempt.timeoutSeconds * 1000);
    try {
      const ready = await prepareRequest(outgoing, credentials);
      if (currentVersion !== version.current) return;
      if (controller.signal.aborted) throw new Error("Request timed out");
      setPrepared(ready);
      setState({ ...initialState, status: "loading", canonical: ready.canonical });
      const response = await fetch(ready.url, { method: ready.method, headers: ready.headers, body: ready.body, signal: controller.signal });
      const raw = await response.text();
      if (currentVersion !== version.current) return;
      if (controller.signal.aborted) throw new Error("Request timed out");
      let apiError = "";
      try {
        const value = JSON.parse(raw);
        if (value?.error) apiError = typeof value.error === "string" ? value.error : value.error.message || value.error.code;
        if (endpoint.contract === "tokopedia" && value?.code !== undefined && value.code !== 0) apiError = `${value.code}: ${value.message || "Provider rejected request"}`;
      } catch { /* Preserve non-JSON HTTP responses too. */ }
      const rejected = response.status < 200 || response.status >= 300 || Boolean(apiError);
      const recovery = response.status === 429 ? "Wait for Retry-After or the quota reset, then retry the same operation."
        : response.status === 401 || response.status === 403 ? "Check provider, credential, access token, and clock."
        : response.status >= 500 ? "Check current state before retrying a mutation with the same key."
        : "Review the response body and required fields; fetch current state before a lifecycle action.";
      setState({ status: rejected ? "error" : "complete", error: rejected ? `HTTP/API rejection${apiError ? `: ${apiError}` : ""}. ${recovery}` : "", canonical: ready.canonical,
        result: { rawBody: raw, status: `${response.status} ${response.statusText}`, body: prettyJSON(raw) || "(empty response body)", headers: responseHeaders(endpoint.contract, response) } });
    } catch (error) {
      if (currentVersion !== version.current) return;
      fail(timedOut ? `Timed out after ${attempt.timeoutSeconds}s. The server may still complete a mutation. Inspect current state or retry the same operation with its existing key.`
        : `The request could not be sent: ${error instanceof Error ? error.message : "Network failure"}. Check that the simulator API is running, then try again with the same operation key.`);
    } finally {
      window.clearTimeout(timer);
      if (currentVersion === version.current) { pending.current = undefined; setElapsed((Date.now() - started.current) / 1000); }
    }
  };
  const run = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(draft); };

  let allocatedPackage: { id: string; order_id: string } | undefined;
  if (endpoint.id === "shopee-create-package" && state.result?.status.startsWith("200 ")) {
    try {
      const result = JSON.parse(state.result.body);
      const pkg = result.response?.package;
      if (!result.error && typeof pkg?.id === "string" && pkg.id && typeof pkg.order_id === "string" && pkg.order_id) allocatedPackage = pkg;
    } catch { /* A non-JSON/error response cannot enable a package handoff. */ }
  }
  return (
    <section className="request-simulator">
      {endpoint.group === "Webhooks" && <WebhookVerification provider={shopProvider ?? (endpoint.contract === "shopee" ? "SHOPEE_LIKE" : endpoint.contract === "tokopedia" ? "TOKOPEDIA_LIKE" : undefined)} />}
      {blockedReason && <p role="alert">{blockedReason}</p>}
      <div className="simulator-heading"><div><h3>Build and send the request</h3><p>{endpoint.summary}</p></div><span className="contract-badge">{contractLabel(endpoint.contract)}</span></div>
      <div className="request-url"><span>{api}</span><code>{requestPath}</code></div>
      {endpoint.group === "Webhooks" && <EventCatalog />}
      {endpoint.group === "Warehouses" && <details><summary>How warehouse inventory works</summary><InventoryGuide /></details>}
      <form onSubmit={run}>
        <fieldset disabled={state.status === "loading"}><legend>Request inputs</legend>
        {endpoint.pathParams?.map((field) => <label key={field.name}>{field.label}<input value={pathParams[field.name]} onChange={(event) => setPathParams({ ...pathParams, [field.name]: event.target.value })} placeholder="Paste an id from a list response" /><small>{field.help}</small></label>)}
        {endpoint.query && endpoint.query.length > 0 && <fieldset><legend>Optional query parameters</legend><div className="query-fields">{endpoint.query.map((field) => <label key={field.name}>{field.label}<input value={query[field.name]} onChange={(event) => setQuery({ ...query, [field.name]: event.target.value })} placeholder={field.name} /><small>{field.help}</small></label>)}</div></fieldset>}
        {endpoint.id.endsWith("-create-shipment") && <ShipmentMode body={body} onChange={setBody} />}
        {hasBody && <label>JSON request body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={10} spellCheck="false" /><small>The exact edited bytes are included in the request signature.</small></label>}
        {mutation && <label>Idempotency key<input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} spellCheck="false" /><small>Keep this exact key if you retry this same logical operation.</small></label>}
        {hasBody && <details open><summary>Body fields and constraints</summary><dl>{endpoint.bodyFields?.map(field => <div key={field.name}><dt><code>{field.name}</code> · {field.required ? "Required" : "Optional"} · {field.type}</dt><dd>{field.description}</dd></div>)}</dl></details>}
        <label>Timeout (seconds)<input type="number" min="1" max="120" value={timeoutSeconds} onChange={event => setTimeoutSeconds(Number(event.target.value))} /></label>
        </fieldset>
        <div className="simulator-actions"><button type="submit" disabled={state.status === "loading" || Boolean(blockedReason)}>{state.status === "loading" ? "Sending signed request…" : "Send signed request"}</button><button type="button" className="quiet" onClick={reset}>Reset request</button>{lastAttempt && <button type="button" disabled={state.status === "loading" || Boolean(blockedReason)} onClick={() => { restore(lastAttempt); void send(lastAttempt, true); }}>Retry same operation</button>}
          {mutation && <button type="button" disabled={state.status === "loading"} onClick={() => { setIdempotencyKey(createIdempotencyKey()); setLastAttempt(undefined); setLastClientID(undefined); setPrepared(undefined); setState(initialState); }}>New operation</button>}
          {state.status === "loading" && <button type="button" onClick={cancel}>Stop waiting</button>}
        </div>
      </form>
      <p>Drafts and retry keys stay in memory per operation while you read the guides. Reloading, signing out, changing shops, or clearing credentials removes them. Reset discards this draft and starts a new operation; it cannot undo a server mutation.</p>
      {(state.status !== "idle") && <p role="status">{state.status === "loading" ? "Waiting" : state.status === "complete" ? "Request succeeded" : "Request needs attention"} · {elapsed.toFixed(1)}s</p>}
      {prepared && <details open><summary>Last prepared outgoing request</summary><p>Includes generated authentication parameters. Access token is redacted; the signed URL is short-lived. Body values may contain secrets you entered.</p><CodeSnippet value={requestEvidence(prepared)} language="text" /></details>}
      <div className="expected-result"><b>What success looks like</b><p>{endpoint.outcome}</p></div>
      <details className="example-error"><summary>See a common error for this operation</summary><CodeSnippet value={endpoint.errorResponse} language="json" /></details>
      {state.error && <p className="simulator-error" role="alert">{state.error}</p>}
      {state.canonical && <details className="request-details"><summary>See signing input (credential secrets redacted)</summary><CodeSnippet value={state.canonical} language="text" /></details>}
      {state.result && <div className="simulator-response" aria-live="polite"><div><b>Response</b><strong>{state.result.status}</strong></div>{state.result.headers.length > 0 && <dl>{state.result.headers.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}<CodeSnippet value={state.result.body} language="json" /><details><summary>Exact response body before formatting</summary><CodeSnippet value={state.result.rawBody ?? state.result.body} language="text" /></details></div>}
      {state.status === "complete" && state.result && lastAttempt && <ResultNavigation endpoint={endpoint} body={state.result.body} onSelect={onSelectResource}
        onNextPage={(page, token) => {
          const next = { ...lastAttempt, query: { ...lastAttempt.query } };
          if (endpoint.contract === "tokopedia") next.body = JSON.stringify({ ...JSON.parse(lastAttempt.body), page_token: token }, null, 2);
          else next.query[endpoint.contract === "shared" ? "page" : "page_no"] = String(page);
          restore(next); void send(next);
        }} />}
      <CodeExamples endpoint={endpoint} input={input} />
      {allocatedPackage && onSelectPackage && <button type="button" onClick={() => onSelectPackage(allocatedPackage!.order_id, allocatedPackage!.id)}>Create shipment for package {allocatedPackage.id}</button>}
      {endpoint.id === "shopee-list-orders" && state.result?.status.startsWith("200 ") && onSelectOrder && (
        <ShopeeOrderResults body={state.result.body} onSelect={onSelectOrder} />
      )}
    </section>
  );
}
