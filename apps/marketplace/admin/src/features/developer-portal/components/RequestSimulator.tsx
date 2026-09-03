import { useMemo, useState, type FormEvent } from "react";
import {
  buildCanonicalRequest,
  buildShopeeCanonicalRequest,
  createIdempotencyKey,
  prettyJSON,
  signCanonicalRequest,
  signTokopediaRequest,
} from "../lib/signing";
import type { IntegrationCredentials, PortalEndpoint, SimulatorState } from "../types";
import { CodeSnippet } from "./CodeSnippet";

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
  return names.filter((name) => response.headers.has(name)).map((name) => [name, response.headers.get(name)]);
};

interface RequestSimulatorProps {
  endpoint: PortalEndpoint;
  api: string;
  credentials: IntegrationCredentials;
}

export function RequestSimulator({ endpoint, api, credentials }: RequestSimulatorProps) {
  const mutation = endpoint.idempotent === true;
  const hasBody = endpoint.body !== undefined;
  const [pathParams, setPathParams] = useState<Record<string, string>>(() => fieldsToValues(endpoint.pathParams, false));
  const [query, setQuery] = useState<Record<string, string>>(() => fieldsToValues(endpoint.query, true));
  const [body, setBody] = useState(endpoint.body ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(mutation ? createIdempotencyKey() : "");
  const [state, setState] = useState<SimulatorState>(initialState);

  const path = useMemo(
    () => (endpoint.pathParams ?? []).reduce(
      (value, field) => value.replace(`{${field.name}}`, pathParams[field.name] || `{${field.name}}`),
      endpoint.path,
    ),
    [endpoint.path, endpoint.pathParams, pathParams],
  );
  const search = useMemo(
    () => new URLSearchParams(Object.entries(query).filter(([, value]) => value.trim())).toString(),
    [query],
  );
  const requestPath = `${path}${search ? `?${search}` : ""}`;

  const reset = () => {
    setPathParams(fieldsToValues(endpoint.pathParams, false));
    setQuery(fieldsToValues(endpoint.query, true));
    setBody(endpoint.body ?? "");
    setIdempotencyKey(mutation ? createIdempotencyKey() : "");
    setState(initialState);
  };

  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!credentials.clientID.trim() || !credentials.secret.trim()) {
      setState({ ...initialState, status: "error", error: "Paste the Client ID and client secret in Step 1 before sending a request." });
      return;
    }
    if (endpoint.contract === "tokopedia" && !credentials.accessToken.trim()) {
      setState({ ...initialState, status: "error", error: "Tokopedia-like requests also need the one-time access token shown when you create the credential." });
      return;
    }
    if (path.includes("{")) {
      setState({ ...initialState, status: "error", error: "Fill in every required path value. Start with the matching list/search request and copy its returned id." });
      return;
    }
    if (hasBody) {
      try {
        JSON.parse(body);
      } catch {
        setState({ ...initialState, status: "error", error: "The request body must be valid JSON. Keep the property names and quotation marks intact." });
        return;
      }
    }

    try {
      const url = new URL(requestPath, api);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = hasBody ? body : "";
      const headers: Record<string, string> = {};
      let canonical = "";

      if (endpoint.contract === "shared") {
        canonical = buildCanonicalRequest(endpoint.method, url.pathname, timestamp, rawBody);
        headers["X-Client-Id"] = credentials.clientID.trim();
        headers["X-Timestamp"] = timestamp;
        headers["X-Signature"] = await signCanonicalRequest(credentials.secret, canonical);
        if (mutation) headers["Idempotency-Key"] = idempotencyKey;
      } else if (endpoint.contract === "shopee") {
        canonical = buildShopeeCanonicalRequest(credentials.clientID.trim(), url.pathname, timestamp, rawBody);
        headers["X-Shopee-Partner-Id"] = credentials.clientID.trim();
        headers["X-Shopee-Timestamp"] = timestamp;
        headers["X-Shopee-Signature"] = await signCanonicalRequest(credentials.secret, canonical);
        if (mutation) headers["Idempotency-Key"] = idempotencyKey;
      } else {
        url.searchParams.set("app_key", credentials.clientID.trim());
        url.searchParams.set("timestamp", timestamp);
        const signed = await signTokopediaRequest(credentials.secret, url.pathname, url.searchParams, rawBody);
        canonical = signed.canonical;
        url.searchParams.set("sign", signed.signature);
        headers["x-tts-access-token"] = credentials.accessToken.trim();
        if (mutation) headers["Idempotency-Key"] = idempotencyKey;
      }
      if (hasBody) headers["Content-Type"] = "application/json";

      setState({ ...initialState, status: "loading", canonical });
      const response = await fetch(url, { method: endpoint.method, headers, body: hasBody ? rawBody : undefined });
      const responseBody = await response.text();
      setState({
        status: "complete",
        error: "",
        canonical,
        result: {
          status: `${response.status} ${response.statusText}`,
          body: prettyJSON(responseBody) || "(empty response body)",
          headers: responseHeaders(endpoint.contract, response),
        },
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error
          ? `The request could not be sent: ${error.message}. Check that the simulator API is running, then try again.`
          : "The request could not be sent. Check that the simulator API is running, then try again.",
      }));
    }
  };

  return (
    <section className="request-simulator">
      <div className="simulator-heading"><div><h3>Build and send the request</h3><p>{endpoint.summary}</p></div><span className="contract-badge">{contractLabel(endpoint.contract)}</span></div>
      <div className="request-url"><span>{api}</span><code>{requestPath}</code></div>
      <form onSubmit={(event) => void run(event)}>
        {endpoint.pathParams?.map((field) => <label key={field.name}>{field.label}<input value={pathParams[field.name]} onChange={(event) => setPathParams({ ...pathParams, [field.name]: event.target.value })} placeholder="Paste an id from a list response" /><small>{field.help}</small></label>)}
        {endpoint.query && endpoint.query.length > 0 && <fieldset><legend>Optional query parameters</legend><div className="query-fields">{endpoint.query.map((field) => <label key={field.name}>{field.label}<input value={query[field.name]} onChange={(event) => setQuery({ ...query, [field.name]: event.target.value })} placeholder={field.name} /><small>{field.help}</small></label>)}</div></fieldset>}
        {hasBody && <label>JSON request body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={10} spellCheck="false" /><small>The exact edited bytes are included in the request signature.</small></label>}
        {mutation && <label>Idempotency key<input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} spellCheck="false" /><small>Keep this exact key if you retry this same logical operation.</small></label>}
        <div className="simulator-actions"><button type="submit" disabled={state.status === "loading"}>{state.status === "loading" ? "Sending signed request…" : "Send signed request"}</button><button type="button" className="quiet" onClick={reset}>Reset request</button></div>
      </form>
      <div className="expected-result"><b>What success looks like</b><p>{endpoint.outcome}</p></div>
      <details className="example-error"><summary>See a common error for this operation</summary><CodeSnippet value={endpoint.errorResponse} language="json" /></details>
      {state.error && <p className="simulator-error" role="alert">{state.error}</p>}
      {state.canonical && <details className="request-details"><summary>See the exact signing input</summary><CodeSnippet value={state.canonical} language="text" /></details>}
      {state.result && <div className="simulator-response" aria-live="polite"><div><b>Response</b><strong>{state.result.status}</strong></div>{state.result.headers.length > 0 && <dl>{state.result.headers.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}<CodeSnippet value={state.result.body} language="json" /></div>}
    </section>
  );
}
