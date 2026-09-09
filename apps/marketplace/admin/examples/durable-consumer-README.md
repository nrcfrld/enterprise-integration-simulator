# Durable external consumer exercise

Use the **Developer Portal → Durable consumer exercise** for the same runnable files and provider-specific steps. This exercise connects the simulator to a small external application with a persistent inbox and order projection. A delivered webhook proves acceptance; `processed_at` plus a saved current-state document proves application processing.

## Setup (both providers)

1. Keep the Admin on `http://localhost:5173`; API defaults to `http://localhost:18080`. Select/create one shop and note its ID/profile. Create a product with physical stock in an ACTIVE warehouse, or use optional seed reset **before** creating credentials/webhooks. Seeded orders are historical COMPLETED records. Simulate a **fresh UNPAID** order later.
2. Create an API credential; save its Client ID, secret and, for Tokopedia, access token. Do not use the console login bearer token for public requests.
3. Use Node **22.13+**, which includes `node:sqlite`. Copy `apps/marketplace/admin/examples/durable-consumer.mjs` and `webhook-receiver.mjs` into the same private directory. The latter supplies verification; the new program supplies persistence and processing. The original standalone receiver remains an explicitly in-memory starter.
4. Create `consumer.env` locally. Replace every placeholder; do not commit this file or the SQLite database/WAL files. Use a different database for each shop. API credentials determine the API shop; ensure they belong to SHOP_ID. Run only **one processing worker** per database; `status` may run while serving, but stop the server before separate `work` or `reconcile` commands.

```dotenv
PROVIDER=SHOPEE_LIKE
SHOP_ID=replace-with-shop-id
MARKETPLACE_BASE_URL=http://localhost:18080
MARKETPLACE_CLIENT_ID=replace-with-client-id
MARKETPLACE_CLIENT_SECRET=replace-with-client-secret
CONSUMER_DB=consumer.sqlite
PORT=9000
WEBHOOK_SECRET=replace-with-saved-webhook-secret
```

For Tokopedia change PROVIDER to `TOKOPEDIA_LIKE`, add `MARKETPLACE_ACCESS_TOKEN`, and replace WEBHOOK_SECRET with `APP_KEY` and `APP_SECRET` from the shop's **oldest ACTIVE credential**, shown in Webhooks → verification guide. API calls can use another active credential; webhook verification must use the displayed signing identity. A returned registration secret is unused for Tokopedia. Shopee verification uses the webhook registration secret, not the API client secret. If the generated Shopee secret is lost, edit the registration to replace it and update WEBHOOK_SECRET together.

5. In Admin → Webhooks register `http://host.docker.internal:9000/webhooks` for a Docker Desktop worker and host receiver. For a native worker use `http://localhost:9000/webhooks`. In other container setups use an explicitly reachable receiver address. Subscribe to order lifecycle and shipment return/failure events (optionally product events), save/copy the Shopee secret, then start the receiver:

```sh
node --env-file=consumer.env durable-consumer.mjs serve
```

In the API Simulator, callbacks default to the Docker Desktop host receiver address. Required fields and provider event names are visible beside the body. Run the receiver before sending test events. Verification failures return 400, storage failures 503, and verified committed inserts or duplicates 204.

## Shopee-like: fresh order to shipment

1. Admin → Orders → Simulate order. Select a stocked product and quantity. Note the returned **order ID** (`ord_…`), package/warehouse links and UNPAID state. The display order number (`order_sn`/SIM-…) is never the `{id}` path value.
2. Request Simulator → Shopee-like → List orders (`GET /api/shopee/v1/orders`). No restrictive filter is required. Use a returned order ID to open its detail. The consumer also fetches this detail after accepting `order.created`.
3. Admin order detail → **Pay** simulates marketplace payment (UNPAID → PAID). Wait for DELIVERED in Webhook Deliveries, then run `status` below; the current document should show PAID. Stop the serving process before running action commands, then restart it afterward to process new events.
4. Replace `ord_actual` in these commands with the returned order ID. Choose operation names once; repeat exactly the same name/arguments to retry:

```sh
node --env-file=consumer.env durable-consumer.mjs action ord_actual process accept-order-01
node --env-file=consumer.env durable-consumer.mjs action ord_actual ready-to-ship ready-order-01
node --env-file=consumer.env durable-consumer.mjs action ord_actual shipments ship-order-01 '{"shipping_provider":"provider_express","pickup_type":"PICKUP"}'
```

The CLI `process` action calls `POST /api/shopee/v1/orders/{id}/ship-order` (the provider route name). Expect PROCESSING → READY_TO_SHIP → a CREATED shipment. Omitting `package_id` allocates remaining unallocated lines automatically. For explicit allocation, use the Shopee Allocate package operation with returned `item_list[].id`/remaining quantities, then include its package ID in the shipment body and use a new operation name. Do not omit package_id when all lines are already allocated.

## Tokopedia-like: fresh order to shipment

1. Repeat setup with a TOKOPEDIA_LIKE shop and its own database/configuration. Admin → Simulate order starts UNPAID. Public discovery is **POST** `/api/tokopedia/v202309/orders/search` with `{"page_size":20}`. Copy `data.orders[].order_id` or use the simulator's returned-ID button; there is no generic public GET-orders endpoint for this provider.
2. Admin order detail → Pay. Canonical PAID appears externally as ON_HOLD. The receiver verifies Authorization using APP_KEY + exact raw bytes and saves the current order state.
3. Stop the receiver, replace the ID and run:

```sh
node --env-file=consumer.env durable-consumer.mjs action ord_actual pack pack-order-01
node --env-file=consumer.env durable-consumer.mjs action ord_actual handover handover-order-01
node --env-file=consumer.env durable-consumer.mjs action ord_actual shipments ship-order-01 '{"shipping_provider":"provider_express","pickup_type":"PICKUP"}'
```

Expect ON_HOLD → AWAITING_SHIPMENT → AWAITING_COLLECTION → CREATED shipment. Restart `serve`. Explicit packages are allocated through Admin → Packages, then passed as package_id; Tokopedia has no public package-allocation endpoint. Preserve canonical vs provider labels when comparing Admin and consumer documents.

## Inspect durable evidence and recover

```sh
node --env-file=consumer.env durable-consumer.mjs status
# After stopping the serving receiver:
node --env-file=consumer.env durable-consumer.mjs work
node --env-file=consumer.env durable-consumer.mjs reconcile
```

- **Inbox acceptance:** unique `(shop,event_id)` and raw body are committed synchronously before 204. Event IDs are Shopee `X-Shopee-Event-Id`/body `request_id` or Tokopedia `tts_notification_id`. Failed verification is never stored. Tokopedia shop_id must match configuration; Shopee uses one unique shop webhook secret per receiver.
- **Processing:** a serial worker resolves product `id` or order `order_id ?? id`. For shipment events, `id` is a shipment ID, so it uses `order_id` to fetch the parent order. It signs a fresh provider detail request and commits the current document and inbox processed_at in one transaction. API outages leave the inbox pending with error/attempt/next_at evidence. A processing crash can repeat a read; it cannot lose an acknowledged inbox entry. This is not an exactly-once network-delivery claim.
- **Duplicate:** Event Logs → duplicate/replay an event, then inspect its new delivery attempt. The same event ID produces one inbox row and no extra processing once completed. A newly created event ID is a different event, even if its payload looks similar.
- **Restart before processing:** stop the receiver, start it with `PAUSE_WORKER=1 node --env-file=consumer.env durable-consumer.mjs serve`, trigger an event and confirm 204 plus pending inbox row. Stop it and restart without PAUSE_WORKER. The row becomes processed from the same database. Do not delete `consumer.sqlite`, `-wal`, or `-shm` while testing recovery.
- **Delayed/out-of-order:** after paying/fulfilling, replay or delay an earlier created/paid event through Event Logs. Its old payload status must not roll back the document: the worker fetches current provider state. Replaying an already processed ID is a dedupe exercise; replaying a previously unreceived event demonstrates current-state processing.
- **Idempotent retry:** repeat one `action` command with the same operation name and exact raw JSON, preferably immediately. The SQLite operations table persists method, path, body and retry_key **before** sending. The API returns its cached result and `Idempotent-Replayed: true`. A lost HTTP response/restart uses the same stored key. Changed inputs with the same operation name are rejected locally. Keys are scoped to credentials. Completed responses remain stored until the simulator data is cleared; after credential rotation or a data reset inspect current state rather than blindly creating another shipment.
- **Pagination/reconciliation:** stop serve and run `reconcile`; it traverses Shopee page_no/more or Tokopedia opaque next_page_token/has_more, fetching full order details per returned order_id. It has no status filter and works beyond one page. It guards empty/repeated pagination, waits for 429 retry/reset headers (bounded attempts), and persists each fetched document. Run it again after interruption or missed notifications; pages are not a transactionally frozen snapshot, so reconcile periodically. It reconciles orders; product events fetch products, but a full deleted-product reconciliation is outside this exercise.
- **Returns:** restart serve; Admin → Shipments simulates Shipped → In delivery → Delivery failed → Returning → Returned. Read current `shipment_list` in the saved order document and compare warehouse on-hand/reserved counts in Admin. Tokopedia maps canonical RETURNED to CANCEL; shipment_list distinguishes the return. Do not book a return/restock merely because one delayed notification says “returned”; confirm current shipment state and use a unique business-operation record for any downstream ERP write.

## What the external application does next

This exercise persists verified inbox records and current provider documents; it deliberately does not create ERP orders or automatically dispatch shipments. Attach your business worker **after** the document/inbox commit. Persist an outgoing business intent with a unique shop/order/action key, then use the external system's idempotency contract. A 204 from this receiver is not proof of that later business action. Monitor pending inbox rows, reconcile periodically, and distinguish transport retries, projection refreshes, and business side effects.

The example is a local teaching application: one configured shop, one serial processing worker, SQLite on persistent local disk, and bounded HTTP timeouts. Multi-worker leasing, hosted secret management and a production ERP connector are separate exercises. No changes to simulator domain rules or public API contracts are required.
