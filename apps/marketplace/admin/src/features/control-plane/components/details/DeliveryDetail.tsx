import { AttemptVerification } from "./AttemptVerification";
import { RelatedResource } from "./RelatedResource";
import type { DetailData } from "./types";
import type { DetailRequest } from "@/shared/types/controlPlane";

const recovery: Record<string, string> = {
  FORCED_FAILURE: "Disable Force webhook failure in this shop’s Scenarios, then retry.",
  SIGNING_ERROR: "Check the signing credential for this provider and configure your receiver with that key, then retry.",
  NETWORK_ERROR: "Check the worker can reach the receiver URL, its DNS/TLS, and private-target policy. localhost inside Docker refers to the worker container.",
  TIMEOUT: "Check receiver latency and network access. Durably accept the event before returning 2xx; process it asynchronously.",
  HTTP_STATUS: "Inspect the receiver status, headers and body. Fix validation or receiver errors before retrying.",
  REQUEST_ERROR: "Correct the registration URL before retrying.",
  RESPONSE_READ_ERROR: "The response could not be read completely. Check the receiver and connection; deduplicate any retried event.",
};
export function DeliveryDetail({ data, onOpen, onManageWebhook }: { data: DetailData; onOpen?: (detail: DetailRequest) => void; onManageWebhook?: () => void }) {
  const resourceType = data.event?.aggregate_type;
  return <>
    <p>Status: <b>{data.status}</b> · {data.attempt_count ?? 0} attempts</p>
    <p>Delivery ID: <code>{data.id}</code> · Event ID: <code>{data.event_id}</code> · Shop: <code>{data.shop_id}</code></p>
    {data.webhook && <section aria-label="Webhook registration context"><h3>Registration {data.webhook.id}</h3><p>Current URL: <code>{data.webhook.url}</code> · {data.webhook.deleted ? "Deleted" : data.webhook.enabled ? "Enabled" : "Disabled"}</p><p>Registration settings can change. Each attempt below records its own destination and signing identity.</p>{onManageWebhook && !data.webhook.deleted && <button onClick={onManageWebhook}>Manage this shop’s webhooks</button>}</section>}
    {data.webhook_deleted === true && <p>Webhook deleted. History is retained and pending deliveries are cancelled. To deliver again, register a new callback and replay the event from Order Detail.</p>}
    {data.event && <section aria-label="Source event"><h3>Source event: {data.event.event_type}</h3><p>{data.event.occurred_at} · {resourceType}: {resourceType === "order" || resourceType === "shipment" ? <RelatedResource type={resourceType} id={data.event.aggregate_id} onOpen={onOpen} /> : resourceType === "product" && data.shop_id && onOpen ? <button onClick={() => onOpen({ type: "product", id: data.event!.aggregate_id, shopID: data.shop_id! })}>{data.event.aggregate_id}</button> : <code>{data.event.aggregate_id}</code>}</p><details><summary>Canonical event payload</summary><pre>{JSON.stringify(data.event.payload, null, 2)}</pre><p>This is the domain payload. Verify against the exact provider body stored with an attempt below.</p></details></section>}
    {data.attempts?.length ? data.attempts.map(attempt => <section className="timeline" key={attempt.id} aria-label={`Attempt ${attempt.attempt}`}>
      <h3>Attempt {attempt.attempt}: {attempt.status}</h3>
      <p><code>{attempt.id}</code> · Started {attempt.started_at ?? attempt.created_at ?? "not recorded"} · {attempt.duration_ms}ms</p>
      <p>{attempt.response_status ? `HTTP ${attempt.response_status}` : "No HTTP response recorded"}</p>
      {attempt.failure_reason && <p role="note"><b>{attempt.failure_code}</b>: {attempt.failure_reason} {recovery[attempt.failure_code ?? ""]}</p>}
      <p>HTTP attempted: {attempt.http_attempted == null ? "not recorded" : attempt.http_attempted ? "yes (does not prove receipt)" : "no; failed before sending"} · Provider: {attempt.provider_profile ?? "not recorded"}</p>
      <p>Attempt destination: <code>{attempt.request_url ?? "Not recorded for this historical attempt"}</code>{attempt.signing_client_id && <> · Signing Client ID: <code>{attempt.signing_client_id}</code></>}</p>
      <details><summary>Request headers and exact body</summary><p>Application headers used for signing and delivery. HTTP transport headers are not captured. The body below preserves the signed string without reformatting.</p><pre>{JSON.stringify(attempt.request_headers ?? {}, null, 2)}</pre><pre>{attempt.request_body ?? "Exact request body was not recorded. Do not reconstruct it from current configuration."}</pre></details>
      <details><summary>Response headers</summary><pre>{JSON.stringify(attempt.response_headers ?? {}, null, 2)}</pre></details>
      <pre>{attempt.response_body || "No response body"}</pre>
      {attempt.response_body_truncated && <p>Response body truncated to the first 4096 bytes.</p>}
      {attempt.request_body != null && <AttemptVerification attempt={attempt} />}
    </section>) : <p className="empty compact">No delivery attempts recorded.</p>}
  </>;
}
