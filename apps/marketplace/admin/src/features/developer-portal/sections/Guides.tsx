import { EventCatalog } from "../components/EventCatalog";
import type { ProviderProfile } from "@/shared/types/controlPlane";
import { WebhookVerification } from "../components/WebhookVerification";
import { CodeSnippet } from "../components/CodeSnippet";
import receiverSource from "../../../../examples/webhook-receiver.mjs?raw";
import { useState, type FormEvent } from "react";
import type { ControlPage } from "@/app/navigation";
import type { PortalSection } from "../types";

interface NavigationProps {
  onNavigate: (page: ControlPage) => void;
  onTry: (endpointID: string) => void;
}

interface QuickStartProps extends NavigationProps {
  provider?: ProviderProfile;
  onOpenSection: (section: PortalSection) => void;
}

export function QuickStart({ onNavigate, onTry, onOpenSection, provider }: QuickStartProps) {
  const products = provider === "TOKOPEDIA_LIKE" ? "tokopedia-search-products" : "shopee-list-products";
  const orders = provider === "TOKOPEDIA_LIKE" ? "tokopedia-search-orders" : "shopee-list-orders";
  const providerName = provider === "TOKOPEDIA_LIKE" ? "Tokopedia-like" : provider === "SHOPEE_LIKE" ? "Shopee-like" : "provider";
  return <>
    <section className="portal-hero portal-home-hero">
      <div>
        <h2>Send your first signed request.</h2>
        <p>Start with a prefilled {providerName} product request. The simulator handles the request shape while you learn the contract.</p>
        <div className="portal-actions">
          <button type="button" onClick={() => onTry(products)}>Open request simulator</button>
          <button type="button" className="quiet" onClick={() => onNavigate("Credentials")}>Create credential</button>
        </div>
      </div>
      <ol className="portal-quick-path" aria-label="First request checklist">
        <li><span>1</span><div><strong>Create credentials</strong><small>Copy the one-time secret.</small></div></li>
        <li><span>2</span><div><strong>Match the provider</strong><small>Use the selected shop’s contract.</small></div></li>
        <li><span>3</span><div><strong>List, then act</strong><small>Reuse IDs from the response.</small></div></li>
      </ol>
    </section>
    <section className="docs-task-finder" aria-labelledby="docs-task-finder-title">
      <header>
        <h3 id="docs-task-finder-title">Find what you need</h3>
        <p>Jump straight to the guide for your current task.</p>
      </header>
      <nav className="docs-task-list" aria-label="Documentation shortcuts">
        <button type="button" onClick={() => onOpenSection("authentication")}><span><strong>Sign a request</strong><small>Headers, timestamps, and signature inputs</small></span><span>Request signing</span></button>
        <button type="button" onClick={() => onOpenSection("products")}><span><strong>Find product data</strong><small>Filters, field names, and response shapes</small></span><span>Products</span></button>
        <button type="button" onClick={() => onTry(orders)}><span><strong>Fulfil an order</strong><small>Start with an order list, then reuse the returned ID</small></span><span>Request simulator</span></button>
        <button type="button" onClick={() => onOpenSection("webhooks")}><span><strong>Receive events</strong><small>Registration, verification, retries, and replay</small></span><span>Webhooks</span></button>
      </nav>
    </section>
    <details className="docs-concepts-disclosure">
      <summary>
        <span><strong>Key simulator concepts</strong><small>Inventory, packages, and idempotency</small></span>
        <span className="disclosure-action">Learn more</span>
      </summary>
      <div className="concept-grid">
        <article><b>Reserved inventory</b><p>Creating an order holds stock at one warehouse. Cancellation releases it.</p></article>
        <article><b>Package and shipment</b><p>A package groups order items. A shipment carries tracking and delivery state.</p></article>
        <article><b>Idempotency</b><p>Retry state-changing requests with the same key to prevent duplicate changes.</p></article>
      </div>
    </details>
  </>;
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
  return <>
    <section className="reference-heading"><h2>Receive and verify webhook deliveries</h2><p>Choose a registration path first. Open the technical guides only when you need the signature or receiver details.</p></section>
    <section className="explanation-flow">
      <article><b>Shared registration</b><p>Subscribe using canonical event names such as order.paid. Delivery still follows the shop’s Shopee-like or Tokopedia-like profile.</p><button type="button" onClick={() => onTry("register-webhook")}>Register shared webhook</button></article>
      <article><b>Shopee registration</b><p>Subscribe to item_update, order_status_update, or logistics_status_update.</p><button type="button" onClick={() => onTry("shopee-create-webhook")}>Register Shopee-like callback</button></article>
      <article><b>Tokopedia registration</b><p>Subscribe to ORDER_STATUS_CHANGE, PACKAGE_UPDATE, or PRODUCT_INFORMATION_CHANGE.</p><button type="button" onClick={() => onTry("tokopedia-configure-webhook")}>Configure Tokopedia-like callback</button></article>
    </section>
    <div className="reference-disclosure-list">
      <details className="reference-disclosure">
        <summary><span><strong>Verify incoming deliveries</strong><small>Provider signatures, credentials, payloads, and freshness</small></span><span className="disclosure-action">View guide</span></summary>
        <WebhookVerification />
      </details>
      <details className="reference-disclosure">
        <summary><span><strong>Run a local receiver</strong><small>Docker address, retry timing, and a raw-body example</small></span><span className="disclosure-action">View setup</span></summary>
        <div className="reference-disclosure-body">
          <p>Save the example as <code>receiver.mjs</code> and run it with Node.js or Bun. Use <code>PROVIDER</code> and the matching Shopee webhook secret or Tokopedia app credential.</p>
          <p>For a Docker Compose worker on Docker Desktop, register <code>http://host.docker.internal:9000/webhooks</code> when the receiver runs on your host. Return 2xx after durable acceptance; failures retry after 30 seconds, 2 minutes, 10 minutes, and 30 minutes.</p>
          <CodeSnippet value={receiverSource} />
        </div>
      </details>
      <details className="reference-disclosure">
        <summary><span><strong>Debug a recorded attempt</strong><small>Signed body, response, failure reason, and recovery</small></span><span className="disclosure-action">View checklist</span></summary>
        <div className="reference-disclosure-body">
          <p>Open Webhook Deliveries → Attempts, or follow a delivery from its order event. Compare the canonical event with the exact signed body, destination, provider, signing identity, headers, response, and failure reason.</p>
          <p><code>SIGNING_ERROR</code> means credentials prevented signing; <code>FORCED_FAILURE</code> means the scenario blocked sending. <code>NETWORK_ERROR</code> and <code>TIMEOUT</code> reached the HTTP client; <code>HTTP_STATUS</code> means the receiver returned non-2xx.</p>
        </div>
      </details>
      <EventCatalog />
    </div>
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
