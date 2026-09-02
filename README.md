# Enterprise Integration Simulator

Marketplace Simulator is a local, multi-user sandbox for practicing production-like marketplace integrations. Its public boundary is a signed REST API and signed webhooks; the control plane is available at the bundled admin UI.

## Quick start

```bash
docker compose up --build
```

## Development shortcuts

Run `make help` from the repository root (or `apps/marketplace`) to see the
available shortcuts. `make test` and `make check` run the complete suite,
including Testcontainers; use `make test-fast` when Docker is unavailable.
Other common commands are `make docker-build` and `make compose-up`.

- Admin UI: http://localhost:5173
- API: http://localhost:18080
- OpenAPI: http://localhost:18080/openapi.yaml
- Interactive Swagger UI: http://localhost:18080/swagger/index.html
- Metrics: http://localhost:18080/metrics

The bootstrap account is `admin@example.test` / `change-me-now`. Override all `MARKETPLACE_*` variables before using a non-local environment.

On a fresh Compose volume, the API automatically creates **Marketplace Demo Store** with 100 realistic products, 50 completed historical orders, one active integration credential, and one disabled example webhook registration. Seed and reset never reveal a client or webhook secret. Create a credential from **Credentials** when you need a one-time client secret.

Orders use the lifecycle `UNPAID → PAID → PROCESSING → READY_TO_SHIP → SHIPPED → IN_DELIVERY → DELIVERED → COMPLETED`. The external order boundary is provider-specific: payment verification, shipment movement, and completion remain simulator control-plane operations.

Each shop has either a `SHOPEE_LIKE` or `TOKOPEDIA_LIKE` profile. `SHOPEE_LIKE` applies payment expiry, a seller fulfillment SLA, and customer/seller/system-specific cancellation eligibility; `TOKOPEDIA_LIKE` represents the combined Tokopedia & Shop / TikTok Shop integration boundary. Every shop has a default **Warehouse** and may add more fulfillment origins. At order creation, the simulator atomically selects the highest-priority active warehouse that can fulfill every item, reserves its inventory, and records it on the order. A **Package** contains allocated order items for that warehouse, and a Shipment carries logistics/tracking for that package. Payment and SLA expiry are enforced asynchronously by the worker.

`SHOPEE_LIKE` has an intentionally separate external integration contract at `/api/shopee/v1`: partner-style signing headers, page-number pagination, provider-specific errors/rate-limit headers, `order_sn` and `item_*` terminology, package/shipment creation, and transformed webhook event/payloads. It is a simulator-owned Shopee-like adapter contract, not a claim of production Shopee API compatibility. The shared `/api/v1` HMAC API is limited to warehouse and webhook resources.

`TOKOPEDIA_LIKE` exposes `/api/tokopedia/v202309`: `app_key`/`timestamp`/`sign` query signing, `x-tts-access-token`, opaque page tokens, an external status mapping, `{code,message,request_id,data}` responses, and numeric signed webhook envelopes. It models one contemporary combined Tokopedia & Shop / TikTok Shop contract rather than the retired standalone Tokopedia Open API.

For `SHOPEE_LIKE`, cancellation reasons are validated: customer (`CHANGE_OF_MIND`, `DUPLICATE_ORDER`, `ADDRESS_ISSUE`), seller (`OUT_OF_STOCK`, `SELLER_UNFULFILLABLE`), and system (`PAYMENT_EXPIRED`, `PAYMENT_FAILED`, `SELLER_SLA_EXPIRED`). Packages may allocate partial quantities of one order item; a package must not exceed the remaining unallocated quantity.

In Admin UI, **Shipments** is a separate fulfillment workspace. It lists only the selected shop’s shipment records and can advance an existing shipment one valid state at a time. Tracking/provider/pickup details are set only when an external developer creates the shipment through that shop’s Shopee-like or Tokopedia-like order contract.

Inventory is reserved atomically during order creation and released for permitted cancellation/payment failure or expiry. Marking a shipment `SHIPPED` atomically converts its package reservation into physical warehouse stock usage. The shared HMAC API exposes read-only `GET /api/v1/warehouses` and `GET /api/v1/warehouses/{id}`; warehouse setup and stock adjustment are control-plane operations. A shipment can also take the return-to-sender path `DELIVERY_FAILED → RETURNING → RETURNED`; the linked order becomes `RETURNED` once every shipment has returned.

See the [integration guide](docs/marketplace/integration-guide.md), [webhook guide](docs/marketplace/webhook-guide.md), and [operations guide](docs/marketplace/operations-guide.md). For minimal signed clients, use `go run ./examples/go-client` or the [Node.js/TypeScript example](apps/marketplace/examples/node-client) after exporting its credential as environment variables.

## Contract and code generation

[`apps/marketplace/openapi/openapi.yaml`](apps/marketplace/openapi/openapi.yaml) is the public API source of truth. It drives both the served Swagger UI and the committed Go client/types in `apps/marketplace/internal/api/openapi/client.gen.go`. After a contract change, regenerate both public bindings and database bindings:

```bash
make generate
```

Database changes are versioned Goose migrations under `apps/marketplace/migrations`. Application startup applies pending migrations. Domain SQL used by control-plane catalogue, shop, and order reads/writes is declared in `internal/store/queries.sql` and generated with sqlc; keep handler code free of new static domain SQL where a sqlc query applies.

Generic deterministic dummy data belongs in `packages/dummy-generator`; Marketplace-specific SKU, price, and stock rules belong in `apps/marketplace/internal/products`.

## Verification

Fast checks run without containers:

```bash
make test
```

The isolated PostgreSQL/Redis suite uses Testcontainers and requires a running Docker daemon:

```bash
make test-integration
```
