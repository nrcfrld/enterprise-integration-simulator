# Marketplace Simulator operations guide

## Runtime checks

The API has three unauthenticated operational endpoints:

- `GET /health` verifies that the HTTP process is alive.
- `GET /ready` verifies PostgreSQL and Redis connectivity and returns `503` while either dependency is unavailable.
- `GET /metrics` exposes process-local Prometheus text metrics for requests, in-flight requests, and response classes.

Every API response includes `X-Request-ID`. Send a safe ID containing only letters, digits, `-`, `_`, or `.` to correlate an integration request with the API's structured JSON log. The simulator generates one if the supplied value is invalid or absent. Logs never contain credential secrets or webhook secrets.

## Safe local operation

Run `docker compose up --build -d` from the repository root. The local endpoints are Admin UI on port `5173`, Marketplace API on `18080`, PostgreSQL on `5432`, and Redis on `6379`.

The initial administrator is supplied only for local development. Set distinct `MARKETPLACE_ADMIN_PASSWORD`, `MARKETPLACE_ENCRYPTION_KEY`, and `MARKETPLACE_SESSION_SECRET` values before running outside a trusted local environment. `MARKETPLACE_REQUEST_TIMEOUT` accepts a positive Go duration such as `20s` and limits API reads and writes. `MARKETPLACE_REQUEST_BODY_LIMIT_BYTES` caps signed request bodies (default 1 MiB). `MARKETPLACE_RATE_LIMIT_PER_MINUTE` configures the public API quota (default `100`), and `MARKETPLACE_SEED_ON_BOOT=true` creates demo data only when the database has no shops.

Set `MARKETPLACE_ENV=production` outside local development. Production policy rejects webhook URLs containing credentials or resolving to loopback, private, link-local, multicast, or unspecified IP space; the delivery client repeats this check after DNS resolution and on redirects. Local mode permits private callback targets for exercises. `MARKETPLACE_ALLOW_PRIVATE_WEBHOOK_TARGETS` is an explicit override and should remain unset in production.

On that first seeded boot, **Marketplace Demo Store** contains 100 active products with realistic names, 50 completed orders with item/customer snapshots, one active credential, and a disabled example webhook. Seed and reset never expose a credential or webhook secret in a response, toast, or log. Create a credential through the Admin UI when needed; its secret is returned once at creation and is never readable afterward.

## Control Plane access

New users can create their own **Operator** account from the Admin sign-in screen, or call `POST /control/v1/auth/register` with an email and an 8+ character password. Registration returns a bearer session and signs the user in immediately. An Operator can create, manage, and reset seed data for shops they own, but cannot access another user's shop, create administrators, assign another user as shop owner, or use the session as an integration API credential. Existing administrators create Admin users from **Users** in the Control Plane.

Workflow: `Register Operator → create shop → configure warehouse/catalogue → create integration credential → use Developer Portal request simulator`.

## Data isolation and reset

An operator can access and reset only shops they own; an administrator can reset any selected shop. Reset removes only that shop's products, orders, webhook history, credentials, and domain events, then creates 100 active products, 50 completed historical orders, an active credential, and a disabled example webhook. It preserves the shop's warehouse records and rebuilds the default warehouse inventory for the fresh catalog. An operator can never reset another participant's shop. Create a new credential afterward if the integration needs a secret.

## Warehouse operations

Each shop has an automatically created `WH-DEFAULT` warehouse. The control-plane **Warehouses** page lists origins, dispatch addresses, priority, and aggregate available stock; its detail view shows on-hand, reserved, and available quantity per product. Use **New warehouse** to add an origin with its address, or **Edit warehouse** to complete the default warehouse address and change its status/priority. Use `POST /control/v1/shops/:shop_id/warehouses` to add an origin, `PATCH /control/v1/warehouses/:warehouse_id` to edit it, and `PUT /control/v1/warehouses/:warehouse_id/inventory/:product_id` to set its physical on-hand quantity. The latter rejects a value below the currently reserved quantity and adjusts the compatibility aggregate `products.stock` atomically.

Create a product with the **Initial inventory by warehouse** rows. The screen derives global sellable stock from the row total, so operators do not have to reconcile a separate product-stock field. Later, use **Adjust** for a listed product or **Add inventory** to assign another catalogue product to the warehouse.

## Failure scenario reference

All scenarios are scoped to one shop. They are intentionally visible in the control plane and never need database access by an integration client.

| Scenario | Effect |
| --- | --- |
| API slow response | Delays a public API response by the configured milliseconds when its per-shop probability is selected. |
| Random 500 / timeout | Injects probabilistic public-API failures. |
| Force rate limit | Returns the normal 429 error contract for that shop. |
| Webhook duplicate / delay / out-of-order | Creates repeated, delayed, or reordered webhook deliveries. |
| Webhook force failure | Records failed delivery attempts and advances the normal retry schedule. |
| Maintenance | Global admin-only mode; public API requests return 503 while control-plane access stays available. |

`webhook_out_of_order` delays `order.paid` by at least ten seconds, which permits a later lifecycle event to be delivered first. This is intentional: consumers must treat the event ID as their deduplication key and query the order if they need the current state.

## Verification suite

`go test ./...` remains a quick unit/in-process check. The tagged Testcontainers suite starts an isolated PostgreSQL 16 and Redis 7 instance and verifies transactional outbox writes, Redis-backed rate limits, reset and permission isolation, scenario isolation, outbox publishing, durable delivery attempts, and retry scheduling:

```bash
cd apps/marketplace
go test -race -tags=testcontainers ./integration ./cmd/worker
```

Use the Admin UI delivery detail to inspect immutable attempt history. Manual retry re-queues one delivery; event replay fans the same durable event ID out again to currently matching webhooks. In Order Detail, the per-event **Duplicate** and **Delay** actions create additional delivery records for currently enabled, matching registrations; they never mutate the original event or delivery attempt history.
