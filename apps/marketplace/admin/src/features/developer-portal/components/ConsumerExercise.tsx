import type { ProviderProfile } from "@/shared/types/controlPlane";
import type { ControlPage } from "@/app/navigation";
import { CodeSnippet } from "./CodeSnippet";
import consumer from "../../../../examples/durable-consumer.mjs?raw";
import verification from "../../../../examples/webhook-receiver.mjs?raw";
import lesson from "../../../../examples/durable-consumer-README.md?raw";

export function ConsumerExercise({ provider, onNavigate, onTry }: {
  provider?: ProviderProfile;
  onNavigate: (page: ControlPage) => void;
  onTry: (id: string) => void;
}) {
  const toko = provider === "TOKOPEDIA_LIKE";
  const commands = toko ? ["pack pack-order-01", "handover handover-order-01"] : ["process accept-order-01", "ready-to-ship ready-order-01"];
  return <article className="consumer-exercise">
    <h2>Build a durable {toko ? "Tokopedia-like" : "Shopee-like"} consumer</h2>
    <p>Connect a fresh order to an external application. This runnable Node 22.13+ example commits an inbox to SQLite before acknowledging a webhook, then fetches and saves current provider state. One receiver and serial worker own each shop database.</p>
    {!provider && <p>Select a shop first. The exercise below uses Shopee; selecting a Tokopedia shop changes the commands and verification setup.</p>}
    <h3>1. Prepare a shop and save your credentials</h3>
    <p>Select/create a shop, then create a product with stock in an ACTIVE warehouse. If using seed reset, do it before creating credentials and webhooks. Seeded COMPLETED orders are historical; this exercise needs a fresh UNPAID order.</p>
    <button onClick={() => onNavigate("Credentials")}>Create API credential</button>
    <p>Save Client ID, client secret{toko ? ", and access token" : ""}. API calls use these credentials; the console login token cannot sign provider requests.</p>
    <h3>2. Download the consumer and verification helper</h3>
    <p>Save both files in the same private directory. Save the configuration as <code>consumer.env</code> and replace every placeholder. Keep environment and SQLite files out of version control. Use a separate database per shop.</p>
    <div className="portal-actions">{[["durable-consumer.mjs", consumer], ["webhook-receiver.mjs", verification], ["durable-consumer-exercise.md", lesson]].map(([name, value]) => <a key={name} className="btn btn-ghost" download={name} href={`data:text/plain;charset=utf-8,${encodeURIComponent(value)}`}>Download {name}</a>)}</div>
    <CodeSnippet language="text" value={`PROVIDER=${toko ? "TOKOPEDIA_LIKE" : "SHOPEE_LIKE"}\nSHOP_ID=replace-with-shop-id\nMARKETPLACE_BASE_URL=http://localhost:18080\nMARKETPLACE_CLIENT_ID=replace-with-client-id\nMARKETPLACE_CLIENT_SECRET=replace-with-client-secret\nCONSUMER_DB=consumer.sqlite\nPORT=9000\n${toko ? "MARKETPLACE_ACCESS_TOKEN=replace-with-access-token\nAPP_KEY=oldest-active-credential-client-id\nAPP_SECRET=oldest-active-credential-secret" : "WEBHOOK_SECRET=replace-with-saved-webhook-secret"}`} />
    <h3>3. Register a callback, then run the receiver</h3>
    <p>In Webhooks subscribe to order lifecycle and shipment failure/return events. For Docker Desktop use <code>http://host.docker.internal:9000/webhooks</code>; a native worker uses <code>http://localhost:9000/webhooks</code>. Other deployments need their own worker-reachable address.</p>
    <p>{toko ? "Set APP_KEY and APP_SECRET from the oldest ACTIVE credential shown in the Webhooks verification guide. A registration secret is unused. API requests may use another active credential from this same shop." : "Copy the one-time webhook secret into WEBHOOK_SECRET. It is separate from the API secret. If lost, edit the registration to replace the secret and update the receiver together."}</p>
    <button onClick={() => onNavigate("Webhooks")}>Configure webhook</button>
    <CodeSnippet language="text" value="node --env-file=consumer.env durable-consumer.mjs serve" />
    <h3>4. Create, discover and pay a fresh order</h3>
    <p>Orders → Simulate order creates UNPAID. Use its returned <code>order_id</code>, never the display order number. Open order detail to see the assigned warehouse and reserved stock, then choose Pay to simulate marketplace payment.</p>
    <button onClick={() => onNavigate("Orders")}>Simulate an order</button>{" "}
    <button onClick={() => onTry(toko ? "tokopedia-search-orders" : "shopee-list-orders")}>{toko ? "Search orders (POST)" : "List orders (GET)"}</button>
    <p>{toko ? "POST orders/search starts with {\"page_size\":20} and no status filter; canonical PAID appears externally as ON_HOLD." : "GET orders returns response.order_list[].order_id; PAID means the seller can process the order."} A DELIVERED webhook means the receiver committed the inbox. Check application processing separately:</p>
    <CodeSnippet language="text" value="node --env-file=consumer.env durable-consumer.mjs status" />
    <p>Expect one inbox row per shop/event, a populated <code>processed_at</code>, and a document containing the current provider order. Pending rows retain error, attempt count and next retry time.</p>
    <h3>5. Fulfill with durable operation keys</h3>
    <p>Stop the serving process before separate action/worker commands. Replace <code>ord_actual</code> with your returned ID. Operation names persist a request and key before sending; repeat the identical command to retry after a lost response or restart.</p>
    <CodeSnippet language="text" value={[...commands.map(command => `node --env-file=consumer.env durable-consumer.mjs action ord_actual ${command}`), `node --env-file=consumer.env durable-consumer.mjs action ord_actual shipments ship-order-01 '{"shipping_provider":"provider_express","pickup_type":"PICKUP"}'`].join("\n")} />
    {!toko && <p>The CLI process action calls <code>POST /api/shopee/v1/orders/&#123;id&#125;/ship-order</code>, the Shopee provider route.</p>}
    <p>{toko ? "ON_HOLD → AWAITING_SHIPMENT → AWAITING_COLLECTION" : "PAID → PROCESSING → READY_TO_SHIP"} precedes the CREATED shipment. Omitting package_id allocates remaining lines automatically. For explicit packages, {toko ? "allocate through Admin Packages" : "use the Shopee Allocate package request"}, then include the returned package_id. A retry keeps the same operation name/body; a different operation needs a new name. Restart serve afterward.</p>
    <h3>6. Prove recovery</h3>
    <div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>Exercise</th><th>Action</th><th>Expected evidence</th></tr></thead><tbody>
      <tr><td>Duplicate</td><td>Event Logs → duplicate/replay a processed event.</td><td>New delivery attempt, same event ID, one inbox row; no repeated application processing.</td></tr>
      <tr><td>Restart before processing</td><td>Start serve with PAUSE_WORKER=1, trigger an event, stop and restart without that setting.</td><td>204 plus an initially pending inbox row; after restart processed_at and document appear from the same SQLite file.</td></tr>
      <tr><td>Delayed/out-of-order</td><td>Delay an event not yet received, advance the order, then deliver it.</td><td>The worker fetches current state; the old payload status never rolls the saved order back.</td></tr>
      <tr><td>Same-key retry</td><td>Repeat an action command with identical name, ID and raw JSON.</td><td>Same persisted retry_key and Idempotent-Replayed response header. Changed inputs are rejected locally.</td></tr>
      <tr><td>Missed notification / pagination</td><td>Stop serve, run reconcile, then restart serve.</td><td>Every order page is visited using Shopee page numbers or unchanged Tokopedia next_page_token; full details are persisted. 429 waits honor retry/reset headers.</td></tr>
      <tr><td>Return to sender</td><td>Shipments → Shipped → In delivery → Delivery failed → Returning → Returned.</td><td>Saved order shipment_list and warehouse ledger reflect the current return. Tokopedia maps RETURNED to CANCEL; inspect shipment_list to distinguish it.</td></tr>
    </tbody></table></div>
    <CodeSnippet language="text" value={'PAUSE_WORKER=1 node --env-file=consumer.env durable-consumer.mjs serve\n# Stop serve before a separate processing or reconciliation pass:\nnode --env-file=consumer.env durable-consumer.mjs work\nnode --env-file=consumer.env durable-consumer.mjs reconcile'} />
    <button onClick={() => onNavigate("Events")}>Open Event Logs</button>{" "}<button onClick={() => onNavigate("Deliveries")}>Inspect webhook deliveries</button>
    <h3>7. Connect business processing</h3>
    <p>This application saves current provider documents. Add an ERP/OMS worker after that commit: persist an outgoing business intent with a unique shop/order/action key and use the external system's idempotency contract. A receiver 204 does not prove that later business action completed. Keep reconciliation and pending-inbox monitoring.</p>
    <p>Run one serial processing worker per database. Reconciliation pages are not a frozen snapshot; repeat reconciliation after interruption. Credential rotation or simulator data reset requires inspecting current state before repeating mutations. The downloaded lesson explains identifiers, returns, storage, failure evidence and recovery in detail.</p>
    <details><summary>Inspect durable consumer source</summary><CodeSnippet value={consumer} language="javascript" /></details>
  </article>;
}
