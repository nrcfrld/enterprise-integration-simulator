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

1. Sign `POST /api/v1/webhooks` and register an endpoint for `order.created`, `order.paid`, `order.ready_to_ship`, and `order.shipped`. Registrations reject unsupported event types; product lifecycle subscriptions include `product.created`, `product.updated`, and `product.deleted`.
2. Use the control plane to seed a shop or progress an order.
3. Consume webhook events idempotently using `X-Marketplace-Event-Id`.
4. Inspect delivery attempts in the control plane, then enable scenarios to test your recovery path.

List endpoints return cursor pagination under `pagination.next_cursor` and `pagination.has_more`.

Products are provider-specific at the public boundary. Shopee-like uses `GET /api/shopee/v1/products?page_no=&page_size=` with `item_*` fields and partner signing; Tokopedia-like uses `POST /api/tokopedia/v202309/products/search` with `data.products`, opaque page tokens, app-key signing, and an access token. Use each provider’s product detail endpoint for one product. Catalogue creation, updates, stock, and archive remain Admin Control Plane operations so warehouse inventory and product events stay atomic.

Use `pagination.next_cursor` exactly as returned and keep `sort` and `direction` unchanged on the following request. The cursor is opaque and rejects incompatible sorting.

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
`order_status`, `time_from`, and `time_to` filters. It returns `order_sn`,
`order_status`, Unix timestamps, and an envelope such as:

```json
{"error":"","message":"success","request_id":"req_…","response":{"order_list":[],"more":false}}
```

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

Only the simulator verifies payment (`UNPAID → PAID`) and completes delivery. There is no Generic public order API. A `SHOPEE_LIKE` credential uses `POST /api/shopee/v1/orders/:id/ship-order`, `ready-to-ship`, `cancel`, `packages`, and `shipments`; its package request supports partial item allocations. A `TOKOPEDIA_LIKE` credential uses `POST /api/tokopedia/v202309/orders/:id/pack`, `handover`, `cancel`, and `shipments` with its query-signing/access-token contract. Both shipment endpoints require `READY_TO_SHIP`, a non-empty `shipping_provider`, and exactly `pickup_type: "PICKUP"`. They create one `CREATED` shipment per eligible package; responses expose the full `shipments` collection and keep the first `shipment` field for compatibility. Use the provider order-detail endpoint to inspect all packages and shipments. There is deliberately no public endpoint for arbitrary order-status changes.

## Warehouses and inventory

Every shop starts with `WH-DEFAULT` and may have additional control-plane-managed warehouses. A warehouse is a fulfillment origin: give each operational warehouse its dispatch address, then set its allocation priority. `WH-DEFAULT` exists for compatibility and starts without an address; edit it in the Admin Control Plane before using it as a real dispatch origin. At order creation, the simulator selects the highest-priority **active** warehouse that can fulfill every requested item. The selected warehouse appears in the order's `fulfillment` object, is copied to each v1 package, and is returned as `warehouse_id` when a shipment is created.

Use signed `GET /api/v1/warehouses` to discover the shop's fulfillment origins and dispatch addresses, and signed `GET /api/v1/warehouses/:id` to inspect per-product `on_hand_quantity`, `reserved_quantity`, and `available_quantity`. These endpoints are read-only for an external developer; create or edit warehouses and adjust their inventory in the Admin Control Plane.

When creating a product in the Admin Control Plane, assign its initial physical quantity to one or more warehouses. The product's global `stock` becomes the sum of those quantities. To move or correct stock later, open a warehouse, set a product's **on-hand** quantity, or add that product to the warehouse. The console rejects an on-hand value lower than a pending reservation.

Inventory is reserved atomically in the selected warehouse when the order is created. A payment failure, payment-expiry cancellation, or permitted pre-shipment cancellation releases that reservation exactly once. Marking a shipment `SHIPPED` deducts its package quantity from physical `on_hand_quantity` and removes the reservation in the same transaction. A delivery failure advances the shipment through
`DELIVERY_FAILED → RETURNING → RETURNED`; the order becomes `RETURNED` only
after all its shipments are returned. The failure reason and all failure/return
timestamps are returned by shipment detail.
