# Webhook guide

Webhooks are delivered asynchronously after the source transaction commits. A 2xx response marks an attempt successful; every other status and network error is retried after 30 seconds, 2 minutes, 10 minutes, and 30 minutes.

## Choose the delivery contract by shop profile

Registration authentication and outbound verification are separate contracts. **The shop's provider profile determines delivery headers, body and signing key**, even if you register through the shared `/api/v1/webhooks` API or Admin Webhooks. Supported shops do not receive `X-Marketplace-*` headers.

| Shop profile | Signature header and hex HMAC-SHA256 input (no separators) | Verification key | Stable event ID |
| --- | --- | --- | --- |
| SHOPEE_LIKE | `X-Shopee-Signature`: `X-Shopee-Event + X-Shopee-Timestamp + RAW_BODY` | Registration webhook secret | `X-Shopee-Event-Id`, also body `request_id` |
| TOKOPEDIA_LIKE | `Authorization`: `APP_KEY + RAW_BODY` | Oldest ACTIVE shop credential's secret; APP_KEY is its Client ID | Body `tts_notification_id` |

Verify the exact raw bytes before parsing or processing. Use constant-time signature comparison and reject timestamps outside your freshness window (the example uses five minutes). After verification, atomically persist and deduplicate by shop/event ID in a durable inbox before acknowledging with 2xx. Process accepted events from that inbox and fetch current provider state before applying eligible actions; lifecycle events can arrive late or out of order.

Webhook registration is configured in **Webhooks** in the Admin UI (or through signed `POST /api/v1/webhooks`). Registration is only a destination and event filter: creating it does not emit a webhook. Create or transition an order to generate the durable event. From **Order Detail**, Replay re-fans the stable event ID, Duplicate adds a fresh delivery for the same event, and Delay schedules a fresh delivery after the selected delay. These controls require an enabled registration that subscribes to the event type.

For non-local operation, set `MARKETPLACE_ENV=production`. Registration then rejects private/local literal targets, and delivery rechecks DNS answers plus every redirect before connecting. This prevents a stored callback from reaching loopback, cloud metadata, or internal network services after DNS rebinding. The private-target override exists only for trusted local exercises.

## SHOPEE_LIKE webhook contract

For a `SHOPEE_LIKE` shop, the worker transforms canonical domain events before delivery. Product events map to `item_update`; shipment movement maps to `logistics_status_update`; order/payment/cancellation/SLA events map to `order_status_update`. The body is an envelope with `code`, `message`, `request_id`, and `response.data`, with the canonical event payload in `response.data`.

Verify `X-Shopee-Event`, `X-Shopee-Event-Id`, `X-Shopee-Timestamp`, and `X-Shopee-Signature`. The signature is `hex(HMAC-SHA256(EVENT + TIMESTAMP + RAW_BODY, WEBHOOK_SECRET))`. Use the webhook registration secret, not the API credential secret. Replacing the webhook secret changes the key for subsequent attempts, including retries. The same retry, duplicate, delay, ordering, and stable-event-ID guarantees apply to both provider contracts.

## TOKOPEDIA_LIKE webhook contract

For a `TOKOPEDIA_LIKE` shop (the combined Tokopedia & Shop / TikTok Shop
contract), the worker sends a separate envelope:

```json
{
  "type": 1,
  "tts_notification_id": "evt_…",
  "shop_id": "shop_…",
  "timestamp": 1760000000,
  "data": {"order_id":"ord_…","status":"PAID"}
}
```

The stable `tts_notification_id` is the idempotency key. `type` is numeric:
product changes use `15`, package/shipment updates use `4`, and order-status
events use `1`. Verify the `Authorization` header as
`hex(HMAC-SHA256(APP_KEY + RAW_BODY, APP_SECRET))`. This provider deliberately
does not send Generic `X-Marketplace-*` or Shopee headers. The optional registration `secret` is retained for compatibility but **is not used for verification**. Admin Webhooks shows the current signing Client ID. The worker selects the oldest ACTIVE credential by `created_at`, then credential `id`, on every attempt. Creating a newer credential does not rotate the key; revoking the oldest selects the next active credential. Update receiver configuration before revocation. If there is no active credential, signing fails and no HTTP request is sent. Its durable retry,
duplicate, delay, and out-of-order guarantees remain unchanged.

## Runnable receiver

Copy [receiver.mjs](../../apps/marketplace/admin/examples/webhook-receiver.mjs), also available in Developer Portal → Webhooks. Run it with Node.js or Bun:

```sh
PROVIDER=SHOPEE_LIKE WEBHOOK_SECRET=your_registration_secret node receiver.mjs
# Or use the signing credential shown in Admin Webhooks:
PROVIDER=TOKOPEDIA_LIKE APP_KEY=your_client_id APP_SECRET=your_app_secret node receiver.mjs
```

Use `/webhooks` on port 9000 as the callback. The URL must be reachable from the worker. For a Docker Desktop worker with this receiver on the host, use `http://host.docker.internal:9000/webhooks`; `localhost` inside a container refers to that container. Local/private targets require the trusted local override. This receiver uses an in-memory inbox for learning, which loses deduplication history on restart; replace it with durable storage for an external application.

Create an order or trigger a transition, then inspect **Webhook Deliveries → Attempts**. Payload data uses canonical simulator fields/statuses, which can differ from the public provider API. Use the event as a notification to read current state, rather than interpreting arrival order as current state.

## Deletion and retention

Admin and shared API deletion stop future fanout while retaining the registration as a deleted record. Existing deliveries and attempts remain accessible in Webhook Deliveries. Pending deliveries become `CANCELLED`; an HTTP attempt already in flight may still finish and record its result. A deleted registration cannot be edited, listed as active, or manually retried (`409 WEBHOOK_DELETED`). Register a new callback and replay the source event to deliver again. **Reset to seed intentionally deletes all shop history**, including retained deleted registrations.

## Failure behavior to test

| Behavior | What the consumer must tolerate | How to trigger it |
| --- | --- | --- |
| Duplicate | More than one delivery for the same stable event ID. Process the first and ignore later copies. | Enable the shop Duplicate scenario or use **Duplicate** on an event. |
| Delay | A delivery arrives after its original order state is already older. | Configure webhook delay or use **Delay** on an event. |
| Out of order | A later lifecycle event can arrive before an earlier one. Never infer the current state from arrival order alone. | Enable the shop Out-of-order scenario; `order.paid` events are delayed. |
| Retry | An HTTP non-2xx response or a network failure is delivered again after 30s, 2m, 10m, and 30m. | Return a non-2xx response or enable webhook failure. |
| Maintenance | Public API calls return `503 MARKETPLACE_MAINTENANCE`; control-plane access remains available. | An administrator enables Maintenance mode on Dashboard. |

## Inspecting an exact delivery attempt

Open an order event's delivery link, or **Webhook Deliveries → Attempts**. The
page links the source order/shipment, stable event ID and registration ID. It
shows the canonical event payload separately from the provider HTTP payload.
Registration URL/enabled state is current context; each attempt's destination,
provider and signing Client ID describe that attempt's configuration.

Migration `015_webhook_attempt_diagnostics.sql` adds immutable attempt evidence:
application request headers, the exact signed body string, request URL, provider,
Tokopedia signing Client ID, start time, whether HTTP was attempted, response
headers/status/body and structured failure code/reason. Response bodies are
limited to 4096 bytes and explicitly marked when truncated. Transport-generated
headers are not captured. Neither API secrets nor webhook secrets are returned.

Legacy attempts have no body/destination snapshot and the UI says so. They must
not be reconstructed from today's URL, timestamp or key. Retry creates a new
attempt; URL changes and key rotation do not change earlier evidence.

| Failure code | Meaning / next action |
| --- | --- |
| SIGNING_ERROR | Signing could not be prepared (including no active Tokopedia app key). No HTTP request; fix credentials, then retry. |
| FORCED_FAILURE | The failure scenario blocked sending. Prepared body/headers are recorded, HTTP was not attempted. Disable the scenario, then retry. |
| REQUEST_ERROR | HTTP request could not be constructed; correct the registration URL. |
| NETWORK_ERROR / TIMEOUT | HTTP client attempted the operation; check worker-to-receiver reachability, TLS/DNS, target policy or latency. This does not prove receipt. |
| HTTP_STATUS | Receiver returned non-2xx; inspect the recorded status, headers and body. |
| RESPONSE_READ_ERROR | The response could not be fully read; diagnose the receiver/connection and deduplicate retries. |

Preflight/signing failures now count as failed attempts and follow the same
bounded retry schedule, instead of only appearing in worker logs. The latest
attempt's failure reason appears in the delivery list. A successful retry clears
that list diagnosis while older failures remain in the attempt history.

For a captured body, expand **Verify this historical attempt locally**. Supply
the key active at that attempt: Shopee webhook secret, or Tokopedia app secret
for its snapshot Client ID. The browser recomputes HMAC against the stored raw
string and headers without sending the secret or resending the request. It
clears the input after the check. This checks historical integrity only; it does
not prove receiver freshness, acceptance, or application processing. Production
receivers still enforce freshness and use constant-time signature comparison.

## Discover events and select their provider category

Open **Event Logs** for the current shop. Filter by resource type, exact resource ID,
or canonical event type; filters apply before pagination. Product details show their
own event trail. Order details include events and deliveries from linked shipments,
including delivery failure and return to sender. Shipment details show the shipment
aggregate events; normal shipping milestones are recorded on the linked order.
Archived product events remain in Event Logs.

| Canonical events | Shopee subscription / header category | Tokopedia subscription / body type |
| --- | --- | --- |
| `product.created`, `product.updated`, `product.deleted` | `item_update` | `PRODUCT_INFORMATION_CHANGE` / 15 |
| `order.shipped`, `order.in_delivery`, `order.delivered`, `shipment.delivery_failed`, `shipment.returning`, `shipment.returned` | `logistics_status_update` | `PACKAGE_UPDATE` / 4 |
| `order.created`, `order.paid`, `order.processing`, `order.ready_to_ship`, `order.completed`, `order.cancelled`, `order.payment_failed`, `order.payment_expired`, `order.sla_expired` | `order_status_update` | `ORDER_STATUS_CHANGE` / 1 |

Admin and `/api/v1/webhooks` accept individual canonical names. Provider registration
expands each category into all its canonical events. Existing registrations keep their
saved event selection: reconfigure provider topics or edit Admin subscriptions to
include newly covered failure/expiry/return events.

Create/edit/archive a product to generate product events. Simulate an order, verify
or fail payment, use legal merchant transitions, and advance its shipment to generate
the corresponding lifecycle events. To exercise deadline events, leave an unpaid
order past its payment deadline or a paid order past its seller deadline while the
worker runs. For return events, report delivery failure from IN_DELIVERY, start
return to sender, then complete return. **Scenario settings alone do not create
domain events**; they alter API or webhook delivery behavior.

Subscribe before triggering an event. To exercise an existing event, choose Replay,
Duplicate, or Delay in its trail. Open its delivery link for exact signed request
bytes and attempts. The canonical payload shown in Event Logs is not the outbound
HTTP body. Verify, durably deduplicate by event ID, and fetch current provider state
before updating the external application's records.
