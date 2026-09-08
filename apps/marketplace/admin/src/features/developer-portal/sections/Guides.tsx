import { EventCatalog } from "../components/EventCatalog";
import type { ProviderProfile } from "@/shared/types/controlPlane";
import { WebhookVerification } from "../components/WebhookVerification";
import { CodeSnippet } from "../components/CodeSnippet";
import receiverSource from "../../../../examples/webhook-receiver.mjs?raw";
import { useState, type FormEvent } from "react";
import type { ControlPage } from "@/app/navigation";

interface NavigationProps {
  onNavigate: (page: ControlPage) => void;
  onTry: (endpointID: string) => void;
}

export function QuickStart({ onNavigate, onTry, provider }: NavigationProps & { provider?: ProviderProfile }) {
  const products = provider === "TOKOPEDIA_LIKE" ? "tokopedia-search-products" : "shopee-list-products";
  const orders = provider === "TOKOPEDIA_LIKE" ? "tokopedia-search-orders" : "shopee-list-orders";
  return <><section className="portal-hero"><div><h2>Make a real provider request before reading the reference.</h2><p>The Marketplace Simulator has three public contracts: shared warehouse/webhook resources, Shopee-like APIs, and Tokopedia-like APIs. Each has a distinct signature and response shape.</p><div className="portal-actions"><button type="button" onClick={() => onNavigate("Credentials")}>Create credential</button><button type="button" className="quiet" onClick={() => onTry(products)}>Try a provider request</button></div></div><div className="portal-status"><b>1. Create a credential</b><small>Copy its Client ID and secret once.</small><i /><b>2. Choose the shop provider</b><small>The shop profile determines its public API contract.</small><i /><b>3. List, then act</b><small>Start with a list/search call and reuse the returned id.</small></div></section><section className="guided-start"><div><h3>A safe first workflow</h3></div><ol><li><span>1</span><div><b>Get credentials</b><p>Create an active credential for the selected shop. Tokopedia-like shops also show an access token once.</p><button type="button" className="link-button" onClick={() => onNavigate("Credentials")}>Open Credentials</button></div></li><li><span>2</span><div><b>Read provider data</b><p>Choose a provider in Request simulator, then send a prefilled product or order list/search request.</p><button type="button" className="link-button" onClick={() => onTry(products)}>Open request simulator</button></div></li><li><span>3</span><div><b>Follow fulfillment</b><p>Verify payment in the control plane, process/pack the order through the provider API, create a package or shipment, then inspect webhook delivery.</p><button type="button" className="link-button" onClick={() => onTry(orders)}>Start the order workflow</button></div></li></ol></section><section className="concept-grid"><article><b>Reserved inventory</b><p>When an order is created, stock is held at one warehouse so another order cannot spend it. Cancellation releases it.</p></article><article><b>Package and shipment</b><p>A package allocates order items for fulfillment. A shipment carries pickup, tracking, and delivery state for that package.</p></article><article><b>Idempotency</b><p>Every state-changing public request uses one retry key, so a network retry cannot apply the operation twice. Reusing the key with different input returns a conflict.</p></article></section></>;
}

function ControlPlaneRegistrationSimulator({ api }: { api: string }) {
  const [email, setEmail] = useState("developer@example.test");
  const [password, setPassword] = useState("practice-password");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const body = JSON.stringify({ email, password }, null, 2);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setResponse("");
    setSending(true);
    try {
      const result = await fetch(`${api}/control/v1/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await result.json() as { error?: { message?: string } };
      setResponse(`HTTP ${result.status}\n${JSON.stringify(data, null, 2)}`);
      if (!result.ok) setError(data.error?.message || "Registration failed. Check the request and try again.");
    } catch {
      setError("The registration request could not reach the API. Check that the simulator API is running.");
    } finally {
      setSending(false);
    }
  };
  return <section className="account-simulator"><div><h3>Try account registration</h3><p>This creates a separate Operator account and returns a Control Plane session. It never creates an integration credential or an Admin role.</p></div><pre>{`POST ${api}/control/v1/auth/register\nContent-Type: application/json\n\n${body}`}</pre><form onSubmit={(event) => void submit(event)}><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button disabled={sending}>{sending ? "Sending…" : "Send registration request"}</button></form>{error && <p className="error" role="alert">{error}</p>}{response && <pre aria-live="polite">{response}</pre>}</section>;
}

export function Authentication({ api }: { api: string }) {
  return <><section className="reference-heading"><h2>Choose the signature that matches the path</h2><p>A dashboard login or Operator registration never authenticates a public integration request. All three integration contracts use the credential secret, but their signing inputs differ.</p></section><section className="explanation-flow"><article><b>Shared resources</b><p>For <code>/api/v1</code>, send X-Client-Id, X-Timestamp, and X-Signature. Sign <code>METHOD + PATH + TIMESTAMP + raw body</code>.</p></article><article><b>Shopee-like</b><p>For <code>/api/shopee/v1</code>, send X-Shopee-Partner-Id, X-Shopee-Timestamp, and X-Shopee-Signature. Sign <code>PARTNER_ID + PATH + TIMESTAMP + raw body</code>; the HTTP method is not included.</p></article><article><b>Tokopedia-like</b><p>For <code>/api/tokopedia/v202309</code>, send app_key, timestamp, sign, and x-tts-access-token. Sort query keys before signing; exclude sign and access_token.</p></article></section><section className="reference-callout"><b>HMAC signature</b><p>An HMAC is a tamper-check made with your secret. Never send the secret itself. Requests older than five minutes are rejected, so generate a new timestamp for every attempt.</p></section><section className="reference-callout"><b>Control Plane accounts</b><p>Registering at <code>/control/v1/auth/register</code> needs no signature. It creates only an Operator account; an existing Admin creates other Admin users. The returned bearer token is only for the console.</p></section><ControlPlaneRegistrationSimulator api={api} /></>;
}

export function Webhooks({ onTry }: Pick<NavigationProps, "onTry">) {
  return <><EventCatalog />
    <section className="reference-heading"><h2>Receive and verify webhook deliveries</h2><p>Registration chooses a destination and event filter. The shop provider chooses the delivery contract.</p></section>
    <WebhookVerification />
    <section className="explanation-flow">
      <article><b>Shared registration</b><p>Subscribe using canonical event names such as order.paid. Delivery still follows the shop’s Shopee-like or Tokopedia-like profile.</p><button type="button" onClick={() => onTry("register-webhook")}>Register shared webhook</button></article>
      <article><b>Shopee registration</b><p>Subscribe to item_update, order_status_update, or logistics_status_update.</p><button type="button" onClick={() => onTry("shopee-create-webhook")}>Register Shopee-like callback</button></article>
      <article><b>Tokopedia registration</b><p>Subscribe to ORDER_STATUS_CHANGE, PACKAGE_UPDATE, or PRODUCT_INFORMATION_CHANGE.</p><button type="button" onClick={() => onTry("tokopedia-configure-webhook")}>Configure Tokopedia-like callback</button></article>
    </section>
    <section className="reference-callout"><h3>Run a local receiver</h3><p>Save the example below as receiver.mjs and run it with Node.js or Bun. For Shopee set PROVIDER=SHOPEE_LIKE and WEBHOOK_SECRET. For Tokopedia set PROVIDER=TOKOPEDIA_LIKE, APP_KEY, and APP_SECRET using the signing credential shown in Admin Webhooks.</p><p>Register a worker-reachable URL ending in /webhooks. For the Docker Compose worker on Docker Desktop, use http://host.docker.internal:9000/webhooks when the receiver runs on your host; localhost inside the worker refers to that container. Private targets must be enabled for local exercises.</p><p>Create an order or change its state, then open Webhook Deliveries → Attempts. Return 2xx after durable acceptance. Other statuses and network errors retry after 30 seconds, 2 minutes, 10 minutes, and 30 minutes. The example’s memory-only inbox is for learning; use a database inbox with a unique shop/event key and process committed events in a worker in your application.</p><p>Deleting a registration preserves delivery history and cancels pending deliveries. An in-flight attempt may still finish. A deleted registration cannot be retried; register a new callback and replay the event. Reset to seed intentionally clears shop history.</p></section>
    <section className="reference-callout"><h3>Debug a recorded attempt</h3><p>Open Webhook Deliveries → Attempts, or follow a delivery from its order event. The canonical event payload is separate from the exact signed HTTP body. Each attempt records its destination, provider, signing identity, application headers, start time, response, truncation flag, and failure code/reason. Current registration changes do not rewrite old attempts.</p><p>SIGNING_ERROR means credentials prevented signing; FORCED_FAILURE means the scenario prevented sending. NETWORK_ERROR/TIMEOUT means the HTTP client tried; HTTP_STATUS means the receiver returned non-2xx. Use the recorded evidence and the recovery guidance before retrying. Signing failures count toward the same bounded retry schedule.</p><p>Historical attempts predating snapshot storage cannot be reconstructed. The local signature exercise uses the key active at that attempt and clears it after checking. It sends no secret and verifies integrity only; freshness and your application’s durable processing remain separate checks.</p></section>
    <details><summary>Raw-body receiver example (Node.js / Bun)</summary><CodeSnippet value={receiverSource} /></details>
  </>;
}

export function Errors() {
  const rows = [
    ["Shared: 401 INVALID_SIGNATURE", "Client ID, timestamp, exact body bytes, or HMAC is wrong.", "Regenerate the timestamp and signature from the exact sent request."],
    ["Shopee-like: error_auth", "Partner headers are missing, stale, or signed with the wrong input.", "Sign partner_id + path + timestamp + body, without the method."],
    ["Tokopedia-like: 36000001", "The app key, access token, query signature, or profile is invalid.", "Use a TOKOPEDIA_LIKE credential and include x-tts-access-token."],
    ["429 / provider rate-limit headers", "This credential has reached its minute quota.", "Wait for the documented reset header, then retry with backoff."],
    ["Invalid transition", "The order is not in the state required by that action.", "Fetch the order, follow the provider workflow, and use the control plane for payment or delivery progression."],
  ];
  return <><section className="reference-heading"><h2>Recover from common responses</h2><p>Provider error formats differ. Treat codes as stable client behavior and messages as guidance for a developer.</p></section><div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>Response</th><th>Meaning</th><th>What to do</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}><td><code>{row[0]}</code></td><td>{row[1]}</td><td>{row[2]}</td></tr>)}</tbody></table></div></>;
}
