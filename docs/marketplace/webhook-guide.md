# Webhook guide

Webhooks are delivered asynchronously after the source transaction commits. A 2xx response marks an attempt successful; every other status and network error is retried after 30 seconds, 2 minutes, 10 minutes, and 30 minutes.

Each payload is the event payload stored with the order/product event. Verify the following headers before processing:

```text
X-Marketplace-Event
X-Marketplace-Event-Id
X-Marketplace-Timestamp
X-Marketplace-Signature
```

The webhook signature is `hex(HMAC-SHA256(TIMESTAMP + "." + RAW_BODY, WEBHOOK_SECRET))`. Reject an old timestamp and use the event ID as a durable idempotency key. Do not assume order lifecycle events are in order: the scenario engine can duplicate, delay, or reorder them.

Webhook registration is configured in **Webhooks** in the Admin UI (or through signed `POST /api/v1/webhooks`). Registration is only a destination and event filter: creating it does not emit a webhook. Create or transition an order to generate the durable event. From **Order Detail**, Replay re-fans the stable event ID, Duplicate adds a fresh delivery for the same event, and Delay schedules a fresh delivery after the selected delay. These controls require an enabled registration that subscribes to the event type.

## SHOPEE_LIKE webhook contract

For a `SHOPEE_LIKE` shop, the worker transforms canonical domain events before delivery. Product events map to `item_update`; shipment movement maps to `logistics_status_update`; order/payment/cancellation/SLA events map to `order_status_update`. The body is an envelope with `code`, `message`, `request_id`, and `response.data`, rather than the Generic raw event payload.

Verify `X-Shopee-Event`, `X-Shopee-Event-Id`, `X-Shopee-Timestamp`, and `X-Shopee-Signature`. The signature is `hex(HMAC-SHA256(EVENT + TIMESTAMP + RAW_BODY, WEBHOOK_SECRET))`. Generic and Shopee-like webhook headers must not be mixed. The same retry, duplicate, delay, ordering, and stable-event-ID guarantees apply to both provider contracts.

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
does not send Generic `X-Marketplace-*` or Shopee headers. Its durable retry,
duplicate, delay, and out-of-order guarantees remain unchanged.

## Failure behavior to test

| Behavior | What the consumer must tolerate | How to trigger it |
| --- | --- | --- |
| Duplicate | More than one delivery for the same stable event ID. Process the first and ignore later copies. | Enable the shop Duplicate scenario or use **Duplicate** on an event. |
| Delay | A delivery arrives after its original order state is already older. | Configure webhook delay or use **Delay** on an event. |
| Out of order | A later lifecycle event can arrive before an earlier one. Never infer the current state from arrival order alone. | Enable the shop Out-of-order scenario; `order.paid` events are delayed. |
| Retry | An HTTP non-2xx response or a network failure is delivered again after 30s, 2m, 10m, and 30m. | Return a non-2xx response or enable webhook failure. |
| Maintenance | Public API calls return `503 MARKETPLACE_MAINTENANCE`; control-plane access remains available. | An administrator enables Maintenance mode on Dashboard. |
