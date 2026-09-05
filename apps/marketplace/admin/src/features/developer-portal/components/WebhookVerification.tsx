import type { ProviderProfile } from "@/shared/types/controlPlane";

export function WebhookVerification({ provider, signingClientID }: { provider?: ProviderProfile; signingClientID?: string }) {
  return <section className="reference-callout" aria-label="Webhook verification contract">
    <h3>Verify deliveries using the shop’s provider</h3>
    <p>The shop profile determines delivery headers and payload, even when you register through Shared resources or the Admin UI. Request signing and webhook verification use different inputs.</p>
    {provider !== "TOKOPEDIA_LIKE" && <div>
      <h4>Shopee-like deliveries</h4>
      <p>Use the registration’s <b>webhook secret</b>. Verify <code>X-Shopee-Signature</code> as hex HMAC-SHA256 of <code>EVENT + TIMESTAMP + RAW_BODY</code> using <code>X-Shopee-Event</code> and <code>X-Shopee-Timestamp</code>. Do not add separators. Deduplicate on <code>X-Shopee-Event-Id</code>.</p>
      <p>The envelope contains <code>code</code>, <code>message</code>, <code>request_id</code> (event ID), and <code>response.data</code>. Save a generated secret when registering; replacing it changes the key used on subsequent attempts, including retries.</p>
    </div>}
    {provider !== "SHOPEE_LIKE" && <div>
      <h4>Tokopedia-like deliveries</h4>
      <p>Verify <code>Authorization</code> as hex HMAC-SHA256 of <code>APP_KEY + RAW_BODY</code> with the <b>app credential secret</b>. The worker uses this shop’s oldest ACTIVE credential (creation time, then credential ID), evaluated on every attempt. APP_KEY is its Client ID.</p>
      {signingClientID !== undefined && <p>{signingClientID ? <>Current signing Client ID: <code>{signingClientID}</code></> : <strong>No active credential. Create one in Credentials before triggering delivery.</strong>}</p>}
      <p>The optional registration secret is retained for compatibility but is unused for Tokopedia verification. Creating a newer credential does not rotate this key; revoking the oldest selects the next active credential. Update your receiver before revoking it. With no active credential, delivery cannot be signed.</p>
      <p>The envelope contains <code>type</code> (1: order, 4: package/shipment, 15: product), <code>tts_notification_id</code> (deduplication key), <code>shop_id</code>, <code>timestamp</code>, and <code>data</code>. It sends no X-Shopee or X-Marketplace headers.</p>
    </div>}
    <p>Verify the exact raw bytes before parsing or processing; reject timestamps outside your freshness window. Payload data uses canonical simulator fields and statuses. After verification, durably deduplicate the event and fetch current state through the provider API; events can arrive late or out of order.</p>
  </section>;
}
