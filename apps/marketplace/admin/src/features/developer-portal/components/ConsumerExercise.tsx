import type { ProviderProfile } from "@/shared/types/controlPlane";
import type { ControlPage } from "@/app/navigation";
import type { ReactNode } from "react";
import { CodeSnippet } from "./CodeSnippet";
import consumer from "../../../../examples/durable-consumer.mjs?raw";
import verification from "../../../../examples/webhook-receiver.mjs?raw";
import lesson from "../../../../examples/durable-consumer-README.md?raw";

function ExerciseStep({ number, title, summary, open = false, children }: {
  number: number;
  title: string;
  summary: string;
  open?: boolean;
  children: ReactNode;
}) {
  return <details className="consumer-step" open={open}>
    <summary><span className="consumer-step__number">{number}</span><span><b>{title}</b><small>{summary}</small></span></summary>
    <div className="consumer-step__content">{children}</div>
  </details>;
}

export function ConsumerExercise({ provider, onNavigate, onTry }: {
  provider?: ProviderProfile;
  onNavigate: (page: ControlPage) => void;
  onTry: (id: string) => void;
}) {
  const toko = provider === "TOKOPEDIA_LIKE";
  const commands = toko ? ["pack pack-order-01", "handover handover-order-01"] : ["process accept-order-01", "ready-to-ship ready-order-01"];
  return <article className="consumer-exercise">
    <header className="guide-heading consumer-heading">
      <h2>Build a durable {toko ? "Tokopedia-like" : "Shopee-like"} consumer</h2>
      <p>Connect a fresh order to a runnable Node 22.13+ consumer that stores webhook events before acknowledging them, then fetches current provider state.</p>
    </header>
    <dl className="guide-facts consumer-facts" aria-label="Exercise outcomes">
      <div><dt>Runtime</dt><dd>Node 22.13+ and SQLite</dd></div>
      <div><dt>Delivery model</dt><dd>Durable inbox before 204</dd></div>
      <div><dt>You will prove</dt><dd>Retry, restart, and reconciliation</dd></div>
    </dl>
    {!provider && <p className="page-hint alert alert-info">Select a shop to tailor the commands. This view currently uses the Shopee-like contract.</p>}
    <section className="consumer-steps" aria-label="Durable consumer setup steps">
      <ExerciseStep number={1} title="Prepare the shop and credentials" summary="Product stock, a fresh order, and API credentials" open>
        <p>Create or select a shop, then add a product with stock in an ACTIVE warehouse. Run seed reset before creating credentials and webhooks. This exercise needs a fresh UNPAID order.</p>
        <div className="step-actions"><button className="btn btn-primary" onClick={() => onNavigate("Credentials")}>Create API credential</button></div>
        <p>Save the Client ID and secret{toko ? ", plus the access token" : ""}. The console login token cannot sign provider requests.</p>
      </ExerciseStep>
      <ExerciseStep number={2} title="Download and configure the consumer" summary="Three files and a private consumer.env">
        <p>Save the files together, create <code>consumer.env</code>, and replace every placeholder. Keep environment and SQLite files out of version control; use one database per shop.</p>
        <div className="portal-actions">{[["durable-consumer.mjs", consumer], ["webhook-receiver.mjs", verification], ["durable-consumer-exercise.md", lesson]].map(([name, value]) => <a key={name} className="btn btn-ghost" download={name} href={`data:text/plain;charset=utf-8,${encodeURIComponent(value)}`}>Download {name}</a>)}</div>
        <CodeSnippet language="text" value={`PROVIDER=${toko ? "TOKOPEDIA_LIKE" : "SHOPEE_LIKE"}\nSHOP_ID=replace-with-shop-id\nMARKETPLACE_BASE_URL=http://localhost:18080\nMARKETPLACE_CLIENT_ID=replace-with-client-id\nMARKETPLACE_CLIENT_SECRET=replace-with-client-secret\nCONSUMER_DB=consumer.sqlite\nPORT=9000\n${toko ? "MARKETPLACE_ACCESS_TOKEN=replace-with-access-token\nAPP_KEY=oldest-active-credential-client-id\nAPP_SECRET=oldest-active-credential-secret" : "WEBHOOK_SECRET=replace-with-saved-webhook-secret"}`} />
      </ExerciseStep>
      <ExerciseStep number={3} title="Register and run the receiver" summary="Subscribe to events and start the serving process">
        <p>Subscribe to order lifecycle and shipment failure/return events. Docker Desktop uses <code>http://host.docker.internal:9000/webhooks</code>; a native worker uses <code>http://localhost:9000/webhooks</code>.</p>
        <p>{toko ? "Set APP_KEY and APP_SECRET from the oldest ACTIVE credential shown in the Webhooks verification guide. API requests may use another active credential from the same shop." : "Copy the one-time webhook secret into WEBHOOK_SECRET. It is separate from the API secret; replace both registration and receiver values if it is lost."}</p>
        <div className="step-actions"><button className="btn btn-primary" onClick={() => onNavigate("Webhooks")}>Configure webhook</button></div>
        <CodeSnippet language="text" value="node --env-file=consumer.env durable-consumer.mjs serve" />
      </ExerciseStep>
      <ExerciseStep number={4} title="Create and discover a fresh order" summary="Simulate payment, fetch the provider ID, and check processing">
        <p>Simulate order creates UNPAID. Use its returned <code>order_id</code>, not the display order number. Open detail to see reserved stock, then simulate payment.</p>
        <div className="step-actions"><button className="btn btn-primary" onClick={() => onNavigate("Orders")}>Simulate an order</button><button className="btn btn-outline" onClick={() => onTry(toko ? "tokopedia-search-orders" : "shopee-list-orders")}>{toko ? "Search orders (POST)" : "List orders (GET)"}</button></div>
        <p>{toko ? "POST orders/search starts with {\"page_size\":20}; canonical PAID appears as ON_HOLD." : "GET orders returns response.order_list[].order_id; PAID means the seller can process the order."} A DELIVERED webhook only proves the inbox was committed.</p>
        <CodeSnippet language="text" value="node --env-file=consumer.env durable-consumer.mjs status" />
        <p>Expect one inbox row per shop/event, a populated <code>processed_at</code>, and a saved current provider order.</p>
      </ExerciseStep>
      <ExerciseStep number={5} title="Fulfill with durable operation keys" summary="Persist each mutation before sending and reuse keys only for retry">
        <p>Stop serve before separate action commands. Replace <code>ord_actual</code> with the returned ID. Repeat the identical command after a lost response or restart.</p>
        <CodeSnippet language="text" value={[...commands.map(command => `node --env-file=consumer.env durable-consumer.mjs action ord_actual ${command}`), `node --env-file=consumer.env durable-consumer.mjs action ord_actual shipments ship-order-01 '{"shipping_provider":"provider_express","pickup_type":"PICKUP"}'`].join("\n")} />
        {!toko && <p>The process action calls <code>POST /api/shopee/v1/orders/&#123;id&#125;/ship-order</code>.</p>}
        <p>{toko ? "ON_HOLD → AWAITING_SHIPMENT → AWAITING_COLLECTION" : "PAID → PROCESSING → READY_TO_SHIP"} precedes the CREATED shipment. Omit <code>package_id</code> to allocate all remaining lines, or pass a returned package ID. Restart serve afterward.</p>
      </ExerciseStep>
      <ExerciseStep number={6} title="Prove recovery" summary="Duplicate, restart, ordering, retry, reconciliation, and return tests">
        <div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>Exercise</th><th>Action</th><th>Expected evidence</th></tr></thead><tbody>
          <tr><td>Duplicate</td><td>Duplicate or replay a processed event.</td><td>Same event ID and one inbox row; no repeated application processing.</td></tr>
          <tr><td>Restart</td><td>Pause the worker, trigger an event, then restart.</td><td>The pending inbox row is processed from the same SQLite file.</td></tr>
          <tr><td>Delayed event</td><td>Delay an event, advance the order, then deliver it.</td><td>Current provider state wins over the old payload status.</td></tr>
          <tr><td>Same-key retry</td><td>Repeat an action with the same name, ID, and body.</td><td>Same persisted retry_key is reused; changed inputs are rejected.</td></tr>
          <tr><td>Reconciliation</td><td>Stop serve, reconcile, then restart.</td><td>Every provider page is visited and full order details are persisted.</td></tr>
          <tr><td>Return to sender</td><td>Progress a failed shipment through Returned.</td><td>The saved order and warehouse ledger reflect the current return.</td></tr>
        </tbody></table></div>
        <CodeSnippet language="text" value={'PAUSE_WORKER=1 node --env-file=consumer.env durable-consumer.mjs serve\n# Stop serve before a separate processing or reconciliation pass:\nnode --env-file=consumer.env durable-consumer.mjs work\nnode --env-file=consumer.env durable-consumer.mjs reconcile'} />
        <div className="step-actions"><button className="btn btn-outline" onClick={() => onNavigate("Events")}>Open Event Logs</button><button className="btn btn-outline" onClick={() => onNavigate("Deliveries")}>Inspect deliveries</button></div>
      </ExerciseStep>
      <ExerciseStep number={7} title="Connect business processing" summary="Add ERP or OMS work after the provider document commit">
        <p>Persist each outgoing business intent with a unique shop/order/action key and use the external system’s idempotency contract. A receiver 204 does not prove the later business action completed.</p>
        <p>Keep reconciliation and pending-inbox monitoring. Run one serial worker per database, and inspect current state after credential rotation or simulator reset.</p>
        <details className="source-disclosure"><summary>Inspect durable consumer source</summary><CodeSnippet value={consumer} language="javascript" /></details>
      </ExerciseStep>
    </section>
  </article>;
}
