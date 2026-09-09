# Marketplace integration guide

The simulator is an external system. Do not query its database or rely on control-plane behavior from an integration client.

The committed OpenAPI contract is available as `/openapi.yaml`; use `/swagger/index.html` for an interactive view of the same specification.

## Developer Portal and request simulator

Open **Documentation → Request simulator** in the Admin UI to run every public
integration operation without writing a client first. Select **Shared
resources**, **Shopee-like**, or **Tokopedia-like**; the simulator switches its
headers, query parameters, signing input, request example, response examples,
and rate-limit headers to the selected contract.

The **Reference** page also provides a runnable Node.js/Bun request for every
operation. Its generated headers include `Idempotency-Key` for shared,
Shopee-like, and Tokopedia-like mutations, while read-only POST searches omit
it. Common errors are selected by operation: authentication for list/search,
not-found for detail reads, validation for callback configuration, and invalid
state for lifecycle actions.

Start with a provider list/search request, then copy a returned product or
order id into the next operation. This makes the fulfillment workflow
discoverable without inspecting source code:

`List/search order → verify payment in Control Plane → provider process/pack → ready/handover → package or shipment → verify webhook`.

The simulator keeps credentials only in the current browser state. A
Tokopedia-like request additionally needs the one-time access token shown when
the credential is created.

## Signed API requests

Use the credential shown once by the control plane. Sign the exact raw request body (empty string for GET) with:

```text
hex(HMAC-SHA256(METHOD + REQUEST_PATH + UNIX_TIMESTAMP + RAW_BODY, CLIENT_SECRET))
```

Set `X-Client-Id`, `X-Timestamp`, and `X-Signature`. Timestamps older/newer than five minutes are rejected. Every state-changing public endpoint across the shared, Shopee-like, and Tokopedia-like contracts also requires a stable `Idempotency-Key`. An identical retry replays the first successful response and includes `Idempotent-Replayed: true`; reuse with different input returns `409`, while a concurrent request with the same key returns `409` plus `Retry-After`. The API buffers a successful response until the replay record is durable. If that finalization fails, the API returns an indeterminate `5xx` response and never publishes the buffered success body; investigate the operation state before deciding whether to retry. Generate a new key for the next logical operation.

The request path in the signature excludes query parameters. Always sign the exact bytes sent as the JSON body, and do not reserialize a retry differently.

## Error and rate-limit contract

Errors use a stable envelope:

```json
{"error":{"code":"RATE_LIMIT_EXCEEDED","message":"rate limit exceeded"}}
```

Treat `error.code` as programmatic and `message` as developer-facing text. Public API errors include authentication (`INVALID_CLIENT`, `INVALID_SIGNATURE`, `REQUEST_EXPIRED`), request validation (`INVALID_REQUEST`, `INVALID_CURSOR`, `INVALID_DATE`, `INVALID_SORT`), resource lookup (`NOT_FOUND`), idempotency (`IDEMPOTENCY_KEY_REQUIRED`), and simulation behavior (`RATE_LIMIT_EXCEEDED`, `SIMULATED_FAILURE`, `MARKETPLACE_MAINTENANCE`).

Rate-limited responses use HTTP `429` and expose `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (Unix seconds). Back off until the reset time; scenarios can force this path for one shop. The same headers are present on successful authenticated public requests, so a client can make a proactive decision before it receives a `429`.

## First integration

Use **Manage shops** beside **Current shop** to create or select a shop. A newly
created shop becomes the current selection and opens its Dashboard. Dashboard
counts cover **all accessible shops**; configuration checks describe only the
selected shop. They record catalog/credential/webhook configuration, not proof
that you saved a secret, signed a request, or processed a callback.

For a first request, open the API Simulator, choose the selected shop's provider,
and use credentials you saved when creating them. Test Shopee's
`GET /api/shopee/v1/orders` or Tokopedia's
`POST /api/tokopedia/v202309/orders/search`. A successful response verifies this
request; the dashboard does not persist completion of this learning exercise.

The optional **Reset shop to sample data** action (also **Reset to seed** in
Products) permanently deletes credentials, webhook registrations and delivery
history, orders/packages/shipments/events, products and warehouse inventory.
It creates 100 products, 50 completed historical orders, a sample credential
whose secret is unavailable, and a disabled example webhook. Warehouse
definitions and scenario settings remain. The confirmation names the affected
shop. To keep existing data, add products instead. After reset, create and save
a new credential, revoke the unusable sample credential, and configure your
receiver again. Historical orders do not demonstrate successful delivery.

Resource lists and details expose **Refresh** and the last successful update
time. Delivery lists and order/delivery details check asynchronous work every
five seconds, up to twelve sequential checks while deliveries are pending (or
while waiting for delivery creation). Checking stops on completion, error,
navigation, or that limit. Use Refresh to start another check window for longer
delays. A failed refresh leaves previous data visible with an error; initial
load failures offer retry. "No deliveries yet" is not proof of a missing webhook.
Single-order simulation opens the created order, whose delivery links open its
attempts. Verify your receiver's durable processing separately from HTTP success.

1. Select/create the intended shop. If you want seed fixtures, use Reset to seed **before** creating credentials and webhooks; reset deletes earlier setup and history.
2. Create an API credential and start the [provider-specific receiver](webhook-guide.md#runnable-receiver). The shop profile selects outbound verification even when you register through the shared API. Tokopedia uses the oldest ACTIVE app credential shown in Admin Webhooks; its callback secret is unused.
3. Sign `POST /api/v1/webhooks` and register a worker-reachable endpoint for `order.created`, `order.paid`, `order.ready_to_ship`, and `order.shipped`. For Shopee, save the registration secret and configure the receiver with it before triggering an event. Registrations reject unsupported event types; product lifecycle subscriptions include `product.created`, `product.updated`, and `product.deleted`.
4. Create or progress an order. Verify exact raw bytes before processing, then durably accept/deduplicate using `X-Shopee-Event-Id` for Shopee or body `tts_notification_id` for Tokopedia. Return 2xx after durable acceptance and fetch current provider state from your inbox worker before acting.
5. Inspect delivery attempts in the control plane, then enable scenarios to test your recovery path. Do not reset the shop between registration and delivery testing.


Products are provider-specific at the public boundary. Shopee-like uses `GET /api/shopee/v1/products?page_no=&page_size=` with `item_*` fields and partner signing; Tokopedia-like uses `POST /api/tokopedia/v202309/products/search` with `data.products`, opaque page tokens, app-key signing, and an access token. Use each provider’s product detail endpoint for one product. Catalogue creation, updates, stock, and archive remain Admin Control Plane operations so warehouse inventory and product events stay atomic.

Pagination is resource- and provider-specific. The shared warehouse list returns
the complete shop-scoped collection and has no pagination object. The shared
webhook list uses `page` and `limit` (default `20`, maximum `100`) and returns
`pagination.page`, `pagination.limit`, `pagination.total`,
`pagination.total_pages`, `pagination.has_previous`, and `pagination.has_next`.
Shopee-like product and order lists use `page_no` plus `page_size`:
product responses expose `has_next_page`, while order responses expose `more`.
Tokopedia-like searches use an opaque `page_token`; send the returned
`next_page_token` unchanged while `has_more` is true.

## SHOPEE_LIKE provider contract

`SHOPEE_LIKE` is a separate provider boundary, not a renamed Generic API. Use
`/api/shopee/v1` only with a credential owned by a `SHOPEE_LIKE` shop. Its
partner ID is the credential's `client_id` and its signature is:

```text
hex(HMAC-SHA256(PARTNER_ID + REQUEST_PATH + UNIX_TIMESTAMP + RAW_BODY, CLIENT_SECRET))
```

Send `X-Shopee-Partner-Id`, `X-Shopee-Timestamp`, and `X-Shopee-Signature`.
The path excludes query parameters and the method is deliberately not part of
this contract. Generic headers will be rejected at this boundary.

The order list is `GET /api/shopee/v1/orders?page_no=1&page_size=20`, with
`order_status`, `time_from`, and `time_to` filters. `time_from` and `time_to` are
inclusive Unix-second bounds on `create_time`; they do not filter `update_time`.
It returns `order_id`, `order_sn`, `order_status`, both timestamps, and an
envelope such as:

```json
{"error":"","message":"success","request_id":"req_…","response":{"order_list":[],"more":false}}
```

Use `response.order_list[].order_id` in every Shopee order `{id}` path,
including detail, cancellation, processing, package allocation, and shipment
creation. `order_sn` is the human-readable order number, not the API identifier.
For example, a row with `order_id: "ord_example_01"` and
`order_sn: "SIM-EXAMPLE-01"` opens at
`GET /api/shopee/v1/orders/ord_example_01`. These are illustrative values;
use the actual `order_id` returned for your shop. In the Request Simulator,
**Use this order** opens the detail operation with that ID already filled in.

Errors use the same top-level envelope and provider codes such as
`error_auth`, `error_param`, `error_invalid_state`, `error_not_found`, and
`error_too_many_requests`. Rate-limit metadata is exposed through
`X-Shopee-Api-Call-Limit` and `X-Shopee-RateLimit-Reset`.

Use `POST /api/shopee/v1/orders/{id}/cancel` with `cancel_reason` for customer
cancellation. Seller processing routes are `ship-order` and `ready-to-ship`.
Register provider-style webhooks using `POST /api/shopee/v1/webhooks` with
`callback_url` and `event_types` (`item_update`, `order_status_update`, or
`logistics_status_update`).

## TOKOPEDIA_LIKE contract (Tokopedia & Shop / TikTok Shop)

`TOKOPEDIA_LIKE` is a third, intentionally incompatible provider boundary for
the combined Tokopedia & Shop / TikTok Shop integration model. Create a
credential from a `TOKOPEDIA_LIKE` shop and save both the returned app secret
and `access_token`: neither is displayed again.

Its routes are under `/api/tokopedia/v202309`. Send the credential client ID as
`app_key`, current Unix seconds as `timestamp`, the one-time token in
`x-tts-access-token`, and `sign` in the query string. Sign the **exact raw
body** using this canonical representation:

```text
hex(HMAC-SHA256(APP_SECRET + PATH + SORTED_QUERY_WITHOUT_sign_OR_access_token + RAW_BODY + APP_SECRET, APP_SECRET))
```

`POST /orders/search` accepts `page_size`, opaque `page_token`, and an optional
external `order_status`; use the returned token unchanged. The external states
are mapped from the canonical domain: `PAID → ON_HOLD`, `PROCESSING →
AWAITING_SHIPMENT`, `READY_TO_SHIP → AWAITING_COLLECTION`, and shipment transit
becomes `IN_TRANSIT`. Seller actions are `POST /orders/{id}/pack` and
`POST /orders/{id}/handover`.

Responses use `{"code", "message", "request_id", "data"}` rather than the
Generic or Shopee envelopes. A non-zero `code` is the programmatic error;
notably `36000001` is an authentication failure and `36000003` is an invalid
state transition. Rate-limit responses use HTTP 429 and `X-TTS-Api-Call-Limit`
plus `X-TTS-RateLimit-Reset`.

Configure callbacks with `PUT /webhooks`, passing `callback_url`, a callback
`secret`, and one or more `ORDER_STATUS_CHANGE`, `PACKAGE_UPDATE`, or
`PRODUCT_INFORMATION_CHANGE` event types. See the webhook guide for the
different delivery envelope and signature.

## Order lifecycle and shipments

Orders follow one enforced path:

`UNPAID → PAID → PROCESSING → READY_TO_SHIP → SHIPPED → IN_DELIVERY → DELIVERED → COMPLETED`.

Only the simulator verifies payment (`UNPAID → PAID`) and completes delivery. There is no Generic public order API. A `SHOPEE_LIKE` credential uses `POST /api/shopee/v1/orders/:id/ship-order`, `ready-to-ship`, `cancel`, `packages`, and `shipments`; its package request supports partial item allocations. A `TOKOPEDIA_LIKE` credential uses `POST /api/tokopedia/v202309/orders/:id/pack`, `handover`, `cancel`, and `shipments` with its query-signing/access-token contract. Both shipment endpoints require canonical `READY_TO_SHIP`, a non-empty `shipping_provider`, and exactly `pickup_type: "PICKUP"`. A create response contains the single new object at Shopee `response.shipment` or Tokopedia `data.shipment`; it includes `id`, `package_id`, `warehouse_id`, `order_id`, `tracking_number`, `shipping_provider`, `pickup_type`, and `status`. Use the provider order-detail `shipment_list` to inspect all shipments. There is deliberately no public endpoint for arbitrary order-status changes.

## Warehouses and inventory

Every shop starts with `WH-DEFAULT` and may have additional control-plane-managed warehouses. A warehouse is a fulfillment origin: give each operational warehouse its dispatch address, then set its allocation priority. `WH-DEFAULT` exists for compatibility and starts without an address; edit it in the Admin Control Plane before using it as a real dispatch origin. At order creation, the simulator selects the highest-priority **active** warehouse that can fulfill every requested item. The selected warehouse is visible in Admin Order Detail, is copied to each package, and is returned as `warehouse_id` when a shipment is created. Provider order-detail projections do not include a separate warehouse or `fulfillment` object.

Use signed `GET /api/v1/warehouses` to discover the shop's fulfillment origins and dispatch addresses, and signed `GET /api/v1/warehouses/:id` to inspect per-product `on_hand_quantity`, `reserved_quantity`, and `available_quantity`. These endpoints are read-only for an external developer; create or edit warehouses and adjust their inventory in the Admin Control Plane.

When creating a product in the Admin Control Plane, assign its initial physical quantity to one or more warehouses. The product's global `stock` becomes the sum of those quantities. To move or correct stock later, open a warehouse, set a product's **on-hand** quantity, or add that product to the warehouse. The console rejects an on-hand value lower than a pending reservation.

Inventory is reserved atomically in the selected warehouse when the order is created. A payment failure, payment-expiry cancellation, or permitted pre-shipment cancellation releases that reservation exactly once. Marking a shipment `SHIPPED` deducts its package quantity from physical `on_hand_quantity` and removes the reservation in the same transaction. A delivery failure advances the shipment through
`DELIVERY_FAILED → RETURNING → RETURNED`; the order becomes `RETURNED` only
after all its shipments are returned. The failure reason and all failure/return
timestamps are returned by shipment detail.

### Webhook verification depends on the shop

A shared registration does not select a generic delivery format. Shopee-like shops send `X-Shopee-*` headers and use the registration secret to sign `EVENT + TIMESTAMP + RAW_BODY`. Tokopedia-like shops send `Authorization` and sign `APP_KEY + RAW_BODY` using the oldest ACTIVE shop credential (creation time, then credential ID). APP_KEY is that credential's Client ID; the registration secret is unused. Admin Webhooks shows the current signing Client ID. Revoking it changes the signing credential on the next attempt, including retries.

Follow the [webhook guide and runnable receiver](webhook-guide.md#runnable-receiver) to verify raw bytes, durably deduplicate, acknowledge, and fetch current provider state. Deleting a registration preserves delivery history and cancels pending deliveries; an in-flight attempt may finish. Reset to seed still clears shop history.

### Explicit packages and multiple shipments

One warehouse supplies an order in this simulator. Packages split its order-line quantities within that warehouse; a shipment carries one package. You cannot split a single order across warehouses.

1. Read provider order detail: Shopee `item_list`, Tokopedia `line_items`. Use each line's `id` as `order_item_id`; `allocated_quantity` and `remaining_quantity` report allocation progress.
2. Verify payment, then process/ready-to-ship (Shopee) or pack/handover (Tokopedia). The order must be canonical `READY_TO_SHIP` / Tokopedia `AWAITING_COLLECTION`.
3. Allocate quantities using Shopee `POST /orders/{id}/packages`, or **Admin Packages → Allocate package** for either provider. The Admin form loads eligible orders and remaining line quantities. Tokopedia has no public package-allocation route.
4. Set `package_id` in the shipment request to the returned package `id` (or `package_list[].package_id` from order detail). The Shopee simulator offers **Create shipment for package …** directly from an allocation response, preserving order and package IDs.

```json
{"package_id":"pkg_example_01","shipping_provider":"provider_express","pickup_type":"PICKUP"}
```

Replace the example ID. In the simulator, **Ship an existing package** exposes this field; **Automatically package remaining items** omits it. Omission creates a new package for unallocated quantities and fails if everything is already allocated. Create all package shipments before progressing shipment movement. Creation returns one shipment; order detail's `shipment_list` contains all shipments.

For a two-unit line, allocate two packages of one unit each and create a shipment for each package. In Admin Order Detail, inspect both packages, their quantities and shipment statuses. Follow Package → Shipment → Warehouse links and use **Back to previous resource** to return. Delivering only one shipment leaves the order unfinished; progress both shipments to delivery. The existing partial-package lifecycle rules remain authoritative.

## Keeping provider and credential context (Admin learning workflow)

The console shows the selected shop and provider on every resource screen. The
Developer Portal carries that context and defaults to that provider's catalogue
request. Its order quick start uses Shopee GET orders or Tokopedia POST
orders/search as appropriate. Shared warehouse/webhook operations use the same
shop credential with the shared signing algorithm.

From a request, open Credentials, create a credential and choose **Use in
simulator** in its one-time dialog. The dialog names the shop/provider; the
handoff returns to the current request with Client ID, secret and, for Tokopedia,
access token. **Return to request simulator** also returns from Credentials
without replacing the request. Typed request data and credentials survive these
console visits for the same shop, in memory only. They are never put in URLs,
local storage or session storage. Clear credential, change shops, reset the
shop, sign out or reload to erase the credential. Changing provider operations
still starts a new request; per-operation draft history is a separate feature.

A known provider mismatch disables sending until you select the matching
provider or change shops. Arbitrarily pasted credential ownership is explicitly
unverified; the backend is authoritative. Lost or seeded secrets cannot be
recovered: revoke the unusable credential, create and save a new one, and use
the handoff. For Tokopedia callbacks, remember the oldest active app credential
signs deliveries, which may differ from the newest request credential.

## Order status, payment status, and actors

Order Detail uses `operations.payment_status` as authoritative: PENDING, PAID,
FAILED, or EXPIRED. The compatibility `payment.status` is only a paid-at check
(UNPAID/PAID) and cannot describe failure/expiry. Payment success commits the
inventory reservation; physical shipment movement consumes stock. Failed or
expired payment cancels the order and releases reservations.

| Canonical / Shopee order status | Tokopedia API order_status | Next actor / work |
| --- | --- | --- |
| UNPAID | UNPAID | Payment simulation (only pending, unexpired payments can succeed) |
| PAID | ON_HOLD | Merchant: Shopee ship-order / Tokopedia pack |
| PROCESSING | AWAITING_SHIPMENT | Merchant: Shopee ready-to-ship / Tokopedia handover |
| READY_TO_SHIP | AWAITING_COLLECTION | Merchant: allocate packages and create shipments |
| SHIPPED / IN_DELIVERY | IN_TRANSIT | Carrier simulation on each shipment |
| DELIVERED | DELIVERED | Customer confirmation simulation to COMPLETED |
| COMPLETED | COMPLETED | Terminal |
| CANCELLED / RETURNED | CANCEL | Terminal; inspect cancellation or return history |

Pack is processing and handover is readiness; neither creates a shipment.
Create all package shipments before carrier movement. IN_TRANSIT and CANCEL
are many-to-one projections, so do not infer a single canonical status from them.
Both providers' webhook payload data retains canonical statuses when present;
the numeric Tokopedia topic is an event category, not the order status. Fetch
current provider details after accepting a webhook before deciding what to do.

Admin presents legal actions from `operations.available_actions` and
`cancellation_options`, derived from domain policy. The server revalidates each
mutation under its order lock. Customer cancellation reasons are CHANGE_OF_MIND,
DUPLICATE_ORDER, ADDRESS_ISSUE; seller reasons are OUT_OF_STOCK and
SELLER_UNFULFILLABLE. Shopee customers may cancel UNPAID/PAID, sellers
PAID/PROCESSING. Tokopedia allows either actor through READY_TO_SHIP. The public
cancel endpoints represent CUSTOMER; Admin explicitly submits the chosen actor
and reason. Legacy empty Admin cancel requests retain SELLER/OUT_OF_STOCK.
SYSTEM cancellations come from payment failure, payment expiry or seller-deadline
simulation. The deadline worker updates asynchronously; read and mutation state
can differ, so refresh after a rejected action.

## Inventory discovery and allocation example

Use **Warehouses & Inventory → View inventory** to adjust physical counts. Products
always show status and available stock; **View product → Inventory by warehouse**
shows each warehouse's on-hand, reserved, available, status, and priority, with a
link to its editor. Edit product changes catalog fields; stock is managed at the
warehouse. Public warehouse calls remain read-only and are available in the API
Request Simulator with example ledger values.

Available = on hand − reserved. Creating an order increases reserved quantity and
reduces available stock without changing on hand. Payment keeps the reservation.
Cancellation or payment expiry releases unshipped reservations. Shipping a package
reduces both on hand and reserved, so available is not deducted twice. Completing
return to sender does not automatically restock inventory; inspect returned goods
before changing the physical count.

The allocator uses one ACTIVE warehouse for every order line. Highest priority wins
among eligible warehouses; ties use warehouse code alphabetically. Aggregate product
stock includes inactive warehouses and cannot prove that allocation will succeed.

For example, A (priority 20) has 5 mugs and 0 plates available; B (priority 10) has
2 mugs and 3 plates. An order for 2 mugs and 1 plate selects B. An order for 4 mugs
and 1 plate fails, despite aggregate availability of 7 mugs and 3 plates, because
neither warehouse can fulfill both lines. Add inventory to one eligible warehouse
or reduce the order quantities before retrying.

The on-hand editor **replaces the physical count**, rather than adding a delta.
With 10 on hand and 2 reserved, entering 15 produces 13 available. To add 5 units,
enter 15, not 5. The new physical count cannot be below the reserved quantity.

## Durable external application exercise

Continue with the [durable consumer exercise](durable-consumer-exercise.md) for both providers. It supplies a SQLite inbox, processing worker, current-state projection, full pagination and stable retry keys, with duplicate/restart/out-of-order/return evidence. The same lesson and downloadable files are in the Developer Portal.
