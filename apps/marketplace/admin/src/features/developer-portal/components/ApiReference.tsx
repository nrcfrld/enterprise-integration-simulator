import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { FieldDefinition, PortalEndpoint, ProviderContract, SchemaFieldDefinition } from "../types";
import { CodeSnippet } from "./CodeSnippet";
import { HttpMethod } from "./HttpMethod";

interface ApiReferenceProps {
  title: string;
  description: string;
  note: string;
  groups: PortalEndpoint["group"][];
  endpoints: PortalEndpoint[];
  onTry: (endpointID: string) => void;
}

interface ReferenceRow {
  name: string;
  location: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
}

const contractOrder: ProviderContract[] = ["shared", "shopee", "tokopedia"];

const contractLabels: Record<ProviderContract, string> = {
  shared: "Shared resources",
  shopee: "Shopee-like",
  tokopedia: "Tokopedia-like",
};

const contractSigning: Record<ProviderContract, string> = {
  shared: "Sign METHOD + PATH + TIMESTAMP + the exact raw body with HMAC-SHA256.",
  shopee: "Sign PARTNER_ID + PATH + TIMESTAMP + the exact raw body with HMAC-SHA256. Do not include the HTTP method.",
  tokopedia: "Sign APP_SECRET + PATH + sorted query + raw body + APP_SECRET. Exclude sign and access_token from the sorted query.",
};

function authRows(contract: ProviderContract, hasBody: boolean, idempotent: boolean): ReferenceRow[] {
  const rows: Record<ProviderContract, ReferenceRow[]> = {
    shared: [
      { name: "X-Client-Id", location: "header", type: "string", required: true, description: "Client ID from the shop integration credential." },
      { name: "X-Timestamp", location: "header", type: "integer<int64>", required: true, description: "Current Unix time in seconds; accepted within five minutes." },
      { name: "X-Signature", location: "header", type: "hex string", required: true, description: "HMAC-SHA256 signature calculated with the credential secret." },
    ],
    shopee: [
      { name: "X-Shopee-Partner-Id", location: "header", type: "string", required: true, description: "Credential client ID used as the provider partner ID." },
      { name: "X-Shopee-Timestamp", location: "header", type: "integer<int64>", required: true, description: "Current Unix time in seconds; accepted within five minutes." },
      { name: "X-Shopee-Signature", location: "header", type: "hex string", required: true, description: "Shopee-like HMAC-SHA256 request signature." },
    ],
    tokopedia: [
      { name: "app_key", location: "query", type: "string", required: true, description: "Credential client ID used as the Partner Center app key." },
      { name: "timestamp", location: "query", type: "integer<int64>", required: true, description: "Current Unix time in seconds; accepted within five minutes." },
      { name: "sign", location: "query", type: "hex string", required: true, description: "Tokopedia-like signature calculated after sorting stable query keys." },
      { name: "x-tts-access-token", location: "header", type: "string", required: true, description: "One-time access token returned when the credential was created." },
    ],
  };

  const result = [...rows[contract]];
  if (hasBody) {
    result.push({ name: "Content-Type", location: "header", type: "string", required: true, description: "Request body media type.", example: "application/json" });
  }
  if (idempotent) {
    result.push({ name: "Idempotency-Key", location: "header", type: "string", required: true, description: "Stable key for one logical mutation. Reuse it only when retrying the identical request.", example: "order-action-01" });
  }
  return result;
}

function parameterRows(endpoint: PortalEndpoint): ReferenceRow[] {
  const convert = (field: FieldDefinition, location: "path" | "query"): ReferenceRow => ({
    name: field.name,
    location,
    type: field.type ?? "string",
    required: location === "path" || field.required === true,
    description: `${field.help}${field.values ? ` Accepted values: ${field.values.join(", ")}.` : ""}`,
    example: field.initial,
  });
  return [
    ...(endpoint.pathParams ?? []).map((field) => convert(field, "path")),
    ...(endpoint.query ?? []).map((field) => convert(field, "query")),
  ];
}

function bodyRows(fields: SchemaFieldDefinition[] | undefined): ReferenceRow[] {
  return (fields ?? []).map((field) => ({
    name: field.name,
    location: "JSON body",
    type: field.type,
    required: field.required,
    description: field.description,
    example: field.example,
  }));
}

function responseRows(contract: ProviderContract, empty: boolean): ReferenceRow[] {
  if (empty) return [];
  if (contract === "shopee") {
    return [
      { name: "error", location: "body", type: "string", required: true, description: "Empty on success; a stable provider error code on failure." },
      { name: "message", location: "body", type: "string", required: true, description: "Human-readable outcome for debugging." },
      { name: "request_id", location: "body", type: "string", required: true, description: "Correlation ID for logs and support." },
      { name: "response", location: "body", type: "object", required: true, description: "Endpoint-specific data in Shopee-like field names." },
    ];
  }
  if (contract === "tokopedia") {
    return [
      { name: "code", location: "body", type: "integer", required: true, description: "0 on success; a stable numeric provider code on failure." },
      { name: "message", location: "body", type: "string", required: true, description: "Human-readable outcome for debugging." },
      { name: "request_id", location: "body", type: "string", required: true, description: "Correlation ID for logs and support." },
      { name: "data", location: "body", type: "object", required: true, description: "Endpoint-specific Partner Center-style data." },
    ];
  }
  return [
    { name: "response body", location: "body", type: "object", required: true, description: "The shared resource or data collection shown in the example below." },
  ];
}

const responseHeaders: Record<ProviderContract, string> = {
  shared: "X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset describe the credential quota.",
  shopee: "X-Shopee-Api-Call-Limit reports used/limit; X-Shopee-RateLimit-Reset is the Unix reset time.",
  tokopedia: "X-TTS-Api-Call-Limit, X-TTS-RateLimit-Remaining, and X-TTS-RateLimit-Reset describe the credential quota.",
};

function ReferenceTable({ rows, label }: { rows: ReferenceRow[]; label: string }) {
  return <div className="endpoint-table-wrap" role="region" aria-label={`${label}; scroll horizontally to see every column`} tabIndex={0}><table className="endpoint-table"><caption>{label}</caption><thead><tr><th>Field</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.location}-${row.name}`}><td><code>{row.name}</code>{row.example && <small>Example: {row.example}</small>}</td><td>{row.location}</td><td><code>{row.type}</code></td><td>{row.required ? <strong className="required-field">Required</strong> : "Optional"}</td><td>{row.description}</td></tr>)}</tbody></table></div>;
}

function EndpointArticle({ endpoint, onTry }: { endpoint: PortalEndpoint; onTry: (endpointID: string) => void }) {
  const params = parameterRows(endpoint);
  const requestFields = bodyRows(endpoint.bodyFields);
  const emptyResponse = endpoint.response === "(empty response body)";
  const envelope = responseRows(endpoint.contract, emptyResponse);
  const payloadRequired = requestFields.some((field) => field.required);

  return <article className="endpoint-reference card bg-base-100" id={`endpoint-${endpoint.id}`} tabIndex={-1}>
    <header className="endpoint-header">
      <div className="endpoint-title"><HttpMethod method={endpoint.method} /><code>{endpoint.path}</code></div>
      <span className={`provider-label ${endpoint.contract}`}>{contractLabels[endpoint.contract]}</span>
    </header>
    <h3>{endpoint.title}</h3>
    <p>{endpoint.summary}</p>
    <dl className="endpoint-facts">
      <div><dt>Success</dt><dd>{endpoint.outcome}</dd></div>
      <div><dt>Request body</dt><dd>{endpoint.body === undefined ? "None" : payloadRequired ? "Required JSON" : "Optional JSON"}</dd></div>
      <div><dt>Safe retry</dt><dd>{endpoint.idempotent ? "Reuse the same Idempotency-Key" : endpoint.method === "GET" ? "Read-only request" : "No idempotency key required"}</dd></div>
    </dl>

    <section className="endpoint-doc-section">
      <h4>Authentication and headers</h4>
      <p>{contractSigning[endpoint.contract]}</p>
      <ReferenceTable rows={authRows(endpoint.contract, endpoint.body !== undefined, endpoint.idempotent === true)} label="Authentication and request headers" />
    </section>

    <section className="endpoint-doc-section">
      <h4>Path and query parameters</h4>
      {params.length > 0 ? <ReferenceTable rows={params} label="Path and query parameters" /> : <p className="empty-schema">No endpoint-specific path or query parameters.</p>}
    </section>

    <section className="endpoint-doc-section">
      <h4>Request payload</h4>
      {endpoint.body !== undefined ? <>
        {requestFields.length > 0 && <ReferenceTable rows={requestFields} label="JSON request fields" />}
        <div className="response-shape"><b>Example JSON</b><CodeSnippet value={endpoint.body} language="json" /></div>
      </> : <p className="empty-schema">No request body. Use an empty string when calculating the signature.</p>}
    </section>

    <section className="endpoint-doc-section">
      <h4>Return value</h4>
      <p>{endpoint.outcome} {responseHeaders[endpoint.contract]}{endpoint.idempotent ? " A replayed completed mutation also returns Idempotent-Replayed: true." : ""}</p>
      {envelope.length > 0 ? <ReferenceTable rows={envelope} label="Response envelope" /> : <p className="empty-schema">The successful response has no body.</p>}
      {!emptyResponse && <div className="response-shape"><b>Success example</b><CodeSnippet value={endpoint.response} language="json" /></div>}
    </section>

    <section className="endpoint-doc-section error-contract">
      <h4>Common error</h4>
      <p>Use the stable error code for program logic and keep the request ID when investigating a failed call.</p>
      <CodeSnippet value={endpoint.errorResponse} language="json" />
    </section>

    <div className="endpoint-action"><span>Ready to send it?</span><button type="button" className="quiet btn btn-primary btn-sm" onClick={() => onTry(endpoint.id)}>Open in request simulator</button></div>
  </article>;
}

export function ApiReference({ title, description, note, groups, endpoints, onTry }: ApiReferenceProps) {
  const items = useMemo(() => endpoints.filter((endpoint) => groups.includes(endpoint.group)), [endpoints, groups]);
  const [activeEndpointID, setActiveEndpointID] = useState(items[0]?.id ?? "");
  const activeEndpoint = items.find((endpoint) => endpoint.id === activeEndpointID) ?? items[0];

  useEffect(() => {
    const selectHash = () => {
      const id = window.location.hash.replace("#endpoint-", "");
      setActiveEndpointID(items.some((endpoint) => endpoint.id === id) ? id : items[0]?.id ?? "");
    };
    selectHash();
    window.addEventListener("hashchange", selectHash);
    window.addEventListener("popstate", selectHash);
    return () => {
      window.removeEventListener("hashchange", selectHash);
      window.removeEventListener("popstate", selectHash);
    };
  }, [items]);

  const selectEndpoint = (event: MouseEvent<HTMLAnchorElement>, endpointID: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setActiveEndpointID(endpointID);
    window.history.pushState(null, "", `#endpoint-${endpointID}`);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`endpoint-${endpointID}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "start" });
    });
  };

  return <>
    <section className="reference-heading"><h2>{title}</h2><p>{description}</p></section>
    <div className="reference-note alert alert-info"><b>Before you call</b><p>{note}</p></div>
    <div className="api-reference-layout">
      <aside className="reference-endpoint-nav menu" aria-label={`${title} endpoint navigation`}>
        <div className="endpoint-nav-heading"><b>Choose endpoint</b><span>{items.length} endpoints</span></div>
        {contractOrder.map((contract) => {
          const contractItems = items.filter((endpoint) => endpoint.contract === contract);
          if (contractItems.length === 0) return null;
          return <section key={contract}><p>{contractLabels[contract]}</p>{contractItems.map((endpoint) => <a href={`#endpoint-${endpoint.id}`} key={endpoint.id} aria-current={activeEndpoint?.id === endpoint.id ? "location" : undefined} onClick={(event) => selectEndpoint(event, endpoint.id)}><HttpMethod method={endpoint.method} /><span>{endpoint.title}</span></a>)}</section>;
        })}
      </aside>
      <div className="reference-endpoint-content">{activeEndpoint && <EndpointArticle endpoint={activeEndpoint} onTry={onTry} key={activeEndpoint.id} />}</div>
    </div>
  </>;
}
