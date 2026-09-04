# Implementation Report — Enterprise Integration Simulator

Audit date: 2026-09-04
PRD: Enterprise Integration Simulator v0.2, updated by Order Lifecycle & API Brief  
Scope: Marketplace Simulator initial scope plus replacement order lifecycle

## Result

**85 of 85 applicable requirements are COMPLETE.**

The original Marketplace and Order Lifecycle requirements remain complete. The update replaces the obsolete `CREATED → CONFIRMED → …` order flow with `UNPAID → PAID → PROCESSING → READY_TO_SHIP → SHIPPED → IN_DELIVERY → DELIVERED → COMPLETED`, keeping cancellation only before shipment. The latest update also separates Admin **Shipments** from Orders: creation remains exclusively in the public API, while the control plane lists, inspects, and advances existing fulfillment records. Verification is behavior-driven, not inferred from routes or source-file presence.

The Provider/Payment/Package P0 expansion is complete: provider-specific detail/UI, package workflow/Admin visibility, and worker integration coverage have been implemented and verified with Testcontainers. P1 is also complete: `SHOPEE_LIKE` changes the external integration boundary—not only stored state—through a separate API prefix, signing protocol, pagination/error/rate-limit contract, and webhook representation. P2 is complete: `TOKOPEDIA_LIKE` now models the combined Tokopedia & Shop / TikTok Shop contract with its own authenticated API, status vocabulary, webhook envelope, inventory safety, and return-to-sender behavior.

### Latest update — Backend core coverage hardening

- Added direct table-driven unit tests for idempotency claim acquisition,
  replay/conflict/in-progress decisions, lease renewal, completion, and release.
  A narrow internal database interface makes those failure paths testable while
  preserving the public constructor and production PostgreSQL implementation.
- Added direct unit coverage for warehouse allocation, reservation release, and
  package fulfillment, including scan/query failures, inventory drift, invalid
  reservation state, and duplicate/invalid order lines.
- Expanded the core coverage gate to include `idempotency` and `inventory` and
  to enforce the 80% minimum on every core package as well as the aggregate.
  Current statement coverage is 100.0% for idempotency, 96.6% for inventory,
  98.1% for orders, 98.2% for products, and 93.8% aggregate.
- **Product & DX Review:** domain failure behavior, internal database seams,
  backend tests, local Make targets, CI enforcement, checklist, and audit
  evidence were updated together. Public routes, OpenAPI, Developer Portal,
  Request Simulator, examples, and Admin UI behavior are unchanged.

### Latest update — Audit priority P0 security closure

- Upgraded the reachable vulnerable production dependencies from `pgx v5.7.6`
  to `v5.9.2` and from `quic-go v0.54.0` to `v0.59.1`.
- Upgraded `x/crypto` to the latest Go-1.25-compatible `v0.55.0`. Two
  non-imported SSH advisories require Go 1.26 through `x/crypto v0.56.0`, while
  the deprecated `openpgp` advisory has no fixed release; none of those
  packages are imported or linked into either production binary.
- Pinned Go `1.25.14` consistently in the workspace, both modules, CI jobs, and
  Docker build stage so local, CI, and production binaries use the same patched
  toolchain instead of a floating minor image.
- Added a repository-level `make vuln` command backed by pinned
  `govulncheck v1.7.0`; it is part of `make check` and a mandatory CI quality
  step.
- **Product & DX Review:** dependency provenance, compiler patch level,
  production Docker builds, local verification commands, CI enforcement,
  README, checklist, and audit evidence were updated together. Public API,
  database, and frontend behavior are unchanged.

### Latest update — Audit priority P2 closure

- Pinned `golangci-lint` to `v2.11.4` in CI instead of resolving a mutable
  `latest` release.
- Added `make generate-check` at Marketplace and repository level. It reruns
  OpenAPI and sqlc generation, then rejects both modified and newly generated
  bindings; CI now enforces the same target.
- Corrected stale pagination guidance: shared lists are currently unpaginated,
  Shopee-like lists use page numbers but expose `has_next_page` for products
  and `more` for orders, and Tokopedia-like searches use opaque page tokens
  with `next_page_token`/`has_more`.
- Added a Developer Portal contract regression that locks those provider
  vocabularies to the documented response examples.
- Added direct OpenAPI-to-portal parity checks for every public method/path,
  path/query parameter, request-body presence and example field, and
  idempotency requirement. A route or schema change can no longer silently
  leave the Reference catalogue behind.
- Removed the stale OpenAPI claim that `/api/v1` still exposes a shared
  catalogue after Generic catalogue removal.
- Replaced broad Control Plane `any` usage with explicit session, shop,
  resource, form, scenario, detail, and response types. ESLint now rejects
  future explicit `any` usage instead of exempting it.
- **Product & DX Review:** CI reproducibility, local developer commands,
  generated artifacts, OpenAPI/Developer Portal contract parity, response
  examples, Control Plane type boundaries, README, integration guidance,
  tests, checklist, and report were updated. Domain behavior, backend routes,
  simulator inputs, and Admin workflows are unaffected.

### Latest update — P1 audit closure

- Made every Developer Portal Node.js/Bun mutation example executable across
  shared, Shopee-like, and Tokopedia-like contracts by deriving
  `Idempotency-Key` from operation metadata. Read-only Tokopedia POST searches
  correctly remain without the header.
- Replaced one generic error example per provider with operation-relevant
  authentication, not-found, callback-validation, or lifecycle-transition
  envelopes while preserving each provider's actual response shape and codes.
- Buffered idempotent handler output and now publish a success only after its
  response has been persisted for replay. If finalization fails, the API emits
  an indeterminate `5xx` and suppresses the unrepeatable success body.
- CI now pins Bun and enforces frontend lint, typecheck, all 22 unit tests,
  production build, and the 80% core-domain coverage threshold in addition to
  existing Go/race/Testcontainers checks.
- **Product & DX Review:** runtime behavior, provider reference examples,
  runnable snippets, retry guidance, focused backend/frontend regressions, CI,
  README, and integration guidance were updated together. Public routes and
  OpenAPI request/response contracts did not change.

### Latest update — Self-service seed reset

- Fixed the Dashboard and Products seed action for Operator accounts. The UI was
  offering the action, but the API rejected every non-Admin request with `403`,
  and the unhandled frontend rejection made the confirmed action appear inert.
- Operators may now reset only shops they own; Admins retain access to every
  shop, while cross-owner reset attempts remain forbidden by the existing shop
  ownership boundary.
- Both seed entry points now show a disabled progress state and surface API
  failures in the notification area instead of failing silently.
- **Product & DX Review:** authorization, ownership isolation, Dashboard and
  Products discoverability, progress/error feedback, operator guidance, and
  regression coverage were updated together.

### Latest update — P0–P2 audit remediation

- Closed the CORS contract gap for all provider authentication, idempotency, rate-limit, and replay headers; preflight behavior is table-tested.
- Replaced best-effort request replay with atomic, payload-bound idempotency claims for every state-changing public route. Concurrent callers, conflicting payloads, expired leases, and empty `204` replays are covered.
- Hardened order/inventory/package concurrency: deadline jobs lock and revalidate state, duplicate product lines cannot oversell, package allocation uses deterministic locks, and deferred database constraints reject empty/over-allocated packages.
- Serialized concurrent package constraint checks and product archive/allocation through row locks, closing write-skew windows even when two transactions commit simultaneously.
- Corrected provider fulfillment behavior for exact pickup validation, partial/multiple packages and shipments, Tokopedia filtered pagination/status mapping, provider error/status headers, and product control-plane create/detail/update/archive.
- Added production webhook SSRF defenses at registration, DNS dial, and redirect time; configurable request-body limits; non-root API, worker, and Admin containers; service health checks; and build-time Admin API configuration.
- Split backend route composition by control/shared/Shopee/Tokopedia boundary and decomposed the 2,200-line Control Plane React component into focused page/form/detail/scenario/webhook components. The frontend no longer uses `@ts-nocheck` or an ESLint exclusion.
- Added a core-domain coverage gate (80% minimum), OpenAPI idempotency contract tests, active PostgreSQL invariant/concurrency tests, and full frontend contract checks.
- **Product & DX Review:** Domain, backend, migrations, OpenAPI/generated client, Developer Portal, Request Simulator, examples/guides, Admin product UI, Docker operations, and tests were updated together. Public mutations are discoverable and runnable without reading backend source.

### Latest update — Detailed API reference navigation

- Replaced the Products and Orders reference summaries with complete operation
  documentation for Products, Warehouses, Orders, Fulfillment, and Webhooks.
  Each endpoint now explains its signing inputs and headers, path/query
  parameters, field-level JSON payload, idempotency behavior, return envelope,
  quota headers, success example, and common error response before offering the
  Request Simulator as an optional next action.
- Added a provider-grouped, active endpoint index on the right side of wide
  layouts. It becomes a horizontally scrollable index before the content at
  narrower widths, preserving DOM, focus, and reading order.
- Added missing Shopee order time-range filter documentation and field metadata
  for all documented request bodies. The reference component and catalogue
  contract are covered by 17 passing frontend tests in total.
- **Product & DX Review:** public API behavior and OpenAPI are unchanged. The
  Developer Portal reference, endpoint catalogue, responsive navigation,
  Request Simulator handoff, accessibility semantics, tests, and production
  Admin build were updated and verified together.

Current verification: `make check` passes the complete lint, frontend, unit,
race-enabled PostgreSQL/Redis Testcontainers, production frontend build, and
93.8% core-domain coverage gate, including `govulncheck`; the frontend suite
contains 74 passing tests. Every package selected by the core gate independently
meets the 80% statement threshold.
`make test-race` and `make lint-full` also pass independently with zero
`golangci-lint` issues. All three production images build, all five Compose
services report healthy, Goose reports applied migration version 12, and API
`/health` plus `/ready` return success while the API, worker, and Admin containers
run as non-root users (UID 100, 100, and 101 respectively).

P0 security verification scans the complete source call graph plus the final
API and worker executables: all report **0 reachable vulnerabilities**. The
running API and worker binaries are built with Go `1.25.14`; the API embeds
`pgx v5.9.2` and `quic-go v0.59.1`, and the worker embeds `pgx v5.9.2`. The
source scanner still reports three module-only `x/crypto` advisories in packages
the application does not import or call; two require a Go 1.26 toolchain and one
has no upstream fixed version.

### Latest update — Developer Portal and API Request Simulator

- Expanded the interactive request simulator from five shared-resource calls to all 25 current public operations: shared warehouses/webhooks, 11 Shopee-like operations, and 9 Tokopedia-like operations.
- The simulator now selects the matching signing contract automatically: shared HMAC headers, Shopee partner headers, or Tokopedia app-key query signing plus the one-time access token. It displays the exact signing input, generated request URL, response status/body, and provider-specific quota headers.
- Added realistic default payloads, success examples, common provider-shaped error examples, Node.js/Bun runnable snippets, and field guidance for path/query/body values.
- Updated the portal’s product, order/fulfillment, authentication, webhook, and error guides. The integration guide now links the hands-on workflow: list/search → simulator payment verification → provider fulfillment action → shipment → webhook verification.
- **Developer Experience Review:** Documentation, OpenAPI alignment, Portal, Simulator, examples, error handling, provider differences, and feature discoverability were reviewed. OpenAPI/backend contracts were unchanged; the new UI catalogue exactly covers their existing public routes.

### Latest update — Warehouse addresses and distributed initial stock

- The Admin Control Plane now captures a warehouse dispatch address, supports editing the compatibility `WH-DEFAULT` warehouse, and preserves its active/inactive status and allocation priority.
- Product creation now accepts one or more initial warehouse allocations. The backend derives aggregate sellable `products.stock` from their total and inserts every inventory row in the same transaction as the product and outbox event.
- Warehouse detail now supports adding a catalogue product to that location and setting on-hand quantities with a clear reservation floor. The public signed warehouse responses, OpenAPI schema, and Developer Portal examples expose the dispatch-address shape.
- **Developer Experience Review:** documentation and operations guidance explain the workflow; OpenAPI documents the response address; the Developer Portal and request simulator show it in executable warehouse responses; errors cover invalid allocation, unknown/cross-shop warehouses, and on-hand below reserved; warehouse selection remains provider-neutral because allocation is shared fulfillment behavior; the Warehouses page exposes create, edit, address, split inventory, and later adjustment actions without backend-source discovery.

### Latest update — Self-service Operator registration

- Added `POST /control/v1/auth/register` and an account-creation state on the Admin sign-in screen. A valid email and 8+ character password create an `OPERATOR` identity, issue its first bearer session, and sign the user in immediately.
- Registration cannot choose a role. Administrators remain created through the secured **Users** control-plane workflow, preventing public privilege escalation.
- **Developer Experience Review:** OpenAPI documents the request, session response, validation, duplicate-email error, and the distinction from integration credentials. Operations guidance adds the initial workflow; the Developer Portal authentication reference provides an executable registration request with generated request/response; provider behavior is unchanged because control-plane sessions never sign provider API requests.

### Current backend architecture refactor

- Extracted authentication into `internal/auth.Service` plus a focused
  sqlc-backed PostgreSQL identity repository. Login and control-plane session
  validation now use the application service rather than handlers reading user
  persistence directly.
- Extracted canonical order transition and cancellation orchestration into
  `internal/orders.Service` plus a transactional pgx repository. The
  repository atomically locks the order, updates state/audit fields, updates
  inventory reservations, and records the durable outbox event.
- Extracted control-plane catalogue creation into `internal/products.Service`
  and a PostgreSQL creator repository. Product validation/defaulting now lives
  in the service; product, default warehouse inventory, and the outbox event
  remain one database transaction in the repository. Duplicate-SKU violations
  are mapped to a domain error before the handler returns `409`.
- Added table-driven service tests with fake repositories and deterministic
  clock/id dependencies. Focused PostgreSQL/Redis Testcontainers coverage for
  lifecycle, provider catalogue access, Shopee cancellation, and Tokopedia
  fulfillment remains green.
- Added direct unit coverage for warehouse defaulting/reservation commits,
  Redis rate-limit decisions including fail-open behavior, Tokopedia signing
  and webhook projections, webhook contract/retry mappings, transactional
  outbox writes, and scenario validation. PostgreSQL repository adapters and
  generated sqlc/OpenAPI code remain covered through integration tests rather
  than duplicated adapter-only unit tests.
- **Developer Experience Review:** this is an internal refactor; no public
  route, OpenAPI operation, request/response shape, provider contract, portal
  page, or API Simulator scenario changed. Existing executable product
  examples and provider-specific catalogue workflows remain valid.

### Latest update — Generic order provider removed

- Added migration `009_remove_generic_order_profile.sql`: existing `GENERIC` shops are converted to `SHOPEE_LIKE`, then the database constraint/default permit only Shopee-like and Tokopedia-like profiles.
- Removed all Generic order/package/shipment HTTP routes and legacy handlers. `/api/v1` remains the shared HMAC boundary solely for warehouses and webhooks.
- Moved package/shipment creation to `POST /api/shopee/v1/orders/{id}/packages|shipments` and `POST /api/tokopedia/v202309/orders/{id}/shipments`; Tokopedia now also owns its cancellation endpoint.
- Removed obsolete Generic order references from OpenAPI and the interactive Developer Portal. The portal now directs order users to the provider-specific API reference.

### Latest update — Provider-specific product catalogue

- Removed `/api/v1/products` and its Generic HMAC public CRUD contract. Canonical products remain shop-scoped in the database for the Admin UI, warehouse inventory, events, and order snapshots.
- Added Shopee-like product list/detail endpoints with partner signing, page-number pagination, `item_*` terminology, and the Shopee response envelope.
- Added Tokopedia-like product search/detail endpoints with app-key signing, access token, opaque page tokens, and `{code,message,request_id,data}` responses.
- Updated OpenAPI, Developer Portal, README, integration guide, and Go/Node provider client examples.

### Latest update — Warehouse-aware fulfillment

- Added migration `008_warehouse_fulfillment.sql`: a shop-owned warehouse model, per-warehouse physical/reserved inventory, and order/package/reservation warehouse references. Every existing and new shop receives `WH-DEFAULT`.
- New orders select the highest-priority active warehouse that can fulfill all requested lines, then atomically reserve it. Legacy `products.stock` remains the aggregate available quantity for compatibility.
- Cancellation, payment expiry, payment failure, and seller-SLA cancellation release the selected warehouse reservation exactly once. Marking a shipment `SHIPPED` deducts physical on-hand stock and releases its reservation atomically.
- Added public signed `GET /api/v1/warehouses` and `GET /api/v1/warehouses/{id}`, control-plane warehouse/inventory routes, a separate `/warehouses` Admin workspace, warehouse references in order/package detail, OpenAPI bindings, and Developer Portal/reference documentation.

### P0 Provider / Payment / Package status

Implemented in the current increment:

- Per-shop Shopee-like and Tokopedia-like provider profiles; the later v9 migration removes the former Generic order profile safely.
- Shopee-like cancellation eligibility by actor (`CUSTOMER`, `SELLER`, `SYSTEM`) and lifecycle position.
- Persisted payment status, expiry, failure metadata, seller deadline, cancellation actor/reason, plus worker enforcement for expiry and SLA cancellation.
- `packages` and `package_items` tables; new shipments atomically receive a package containing the unallocated order items.
- Public package reads/allocation endpoints and an Admin `/packages` listing route.

### P1 Provider-specific external contract status

- `/api/shopee/v1` exposes a partner-style order API with `order_sn`, `order_status`, Unix timestamps, `page_no`/`page_size`, and a `{error,message,request_id,response}` envelope.
- Its HMAC canonical string is `PARTNER_ID + PATH + TIMESTAMP + RAW_BODY`; Generic `X-Client-Id` signing is rejected at this boundary.
- Provider webhook registration accepts `callback_url` and `item_update`, `order_status_update`, or `logistics_status_update`. The worker transforms canonical domain events/payloads and signs `X-Shopee-*` headers independently from Generic webhooks.
- The complete integration matrix verifies happy seller fulfillment, payment expiry, SLA expiry, all cancellation actors, invalid state, partial package allocation, shipment delivery, public contract behavior, and webhook delivery using isolated PostgreSQL and Redis.

### Latest update — Separate Shipments Resource

- Added authenticated `GET /control/v1/shops/:shop_id/shipments?page=&limit=` and `GET /control/v1/shipments/:shipment_id` endpoints, scoped to the shipment’s linked order/shop.
- Replaced the `Shipments → /orders` navigation alias with `/shipments`, an independently active, paginated fulfillment page and detail panel.
- The panel shows tracking, provider, pickup type, linked order, lifecycle timestamps, and exactly one valid next action: `CREATED → SHIPPED → IN_DELIVERY → DELIVERED`.
- Public shipment creation/retrieval and the committed OpenAPI public contract remain unchanged; no schema migration was required.

### Latest update — TOKOPEDIA_LIKE (Tokopedia & Shop / TikTok Shop)

- Implemented `TOKOPEDIA_LIKE` as a real third provider boundary, representing the current combined Tokopedia & Shop / TikTok Shop model rather than a legacy standalone Tokopedia contract.
- Added `/api/tokopedia/v202309` order search/detail, seller pack/handover, and webhook configuration endpoints. They use `app_key`/`timestamp`/`sign` query signing, `x-tts-access-token`, opaque page tokens, provider status terms, and `{code,message,request_id,data}` results.
- Added encrypted one-time access tokens to control-plane credential creation and an adapter that sends numeric, `Authorization`-signed provider webhooks.
- Added atomic inventory reservations so concurrent customer orders cannot oversell; cancellation, payment failure, and worker deadline cancellation release stock exactly once.
- Added operational return-to-sender states: `DELIVERY_FAILED → RETURNING → RETURNED`. Failure reasons/timestamps are available from shipment APIs and Admin detail; linked orders become `RETURNED` when every shipment is returned.

## Defects found and fixed

| Defect | Impact | Resolution | Verification |
|---|---|---|---|
| Production Admin UI crashed with `ReferenceError: Prism is not defined`. | Control plane rendered a blank page, blocking every admin workflow. | Removed Vite's forced Prism manual chunk, which violated Prism plug-in initialization order. | Rebuilt Docker image; authenticated browser session rendered every Admin page without console errors. |
| Name-only `PATCH /api/v1/products/{id}` reset omitted `price` and `stock` to zero. | Public partial update corrupted product data. | Replaced value fields with pointer-based `productPatchInput`; OpenAPI now uses `ProductPatchInput`. | New Testcontainers regression test and extended Compose E2E test both pass. |
| Existing Compose data could not migrate from the old order states because its old database constraint rejected `UNPAID`. | API and worker exited at startup on a persistent volume. | Migration `005` now removes the old constraint before mapping `CREATED → UNPAID` and `CONFIRMED → PAID`, then applies the new constraint and payment/shipment fields. | Rebuilt/recreated Compose; both API and worker report Goose version 5 and `/ready` returns ready. |
| Seed confirmation appeared to do nothing for Operators. | The Dashboard exposed the action, but the API returned `403` and the UI did not catch the rejected request. | Allowed owner-scoped Operator resets, retained cross-shop isolation, and added progress/error feedback to both seed entry points. | Frontend regression tests and a race-enabled PostgreSQL/Redis Testcontainers permission/reset test pass. |

## Tests run

| Command / check | Result |
|---|---|
| `cd apps/marketplace && GOCACHE=$(pwd)/.gocache go test ./...` | PASS |
| `cd packages/dummy-generator && GOCACHE=$(pwd)/.gocache go test ./...` | PASS |
| `cd apps/marketplace && bun test && bun run typecheck && bun run lint && bun run build` | PASS — 2 frontend tests, TypeScript, ESLint, production bundle |
| `cd apps/marketplace && GOCACHE=$(pwd)/.gocache go generate ./internal/api/openapi ./internal/store` | PASS — OpenAPI and sqlc bindings regenerated |
| `cd apps/marketplace && GOCACHE=$(pwd)/.gocache go test -count=1 -race -tags=testcontainers ./integration ./cmd/worker` | PASS — integration 22.692s; worker 7.519s |
| `cd apps/marketplace && GOCACHE=$(pwd)/.gocache go test -count=1 -tags=integration ./integration` | PASS — Compose E2E 43.937s |
| `docker compose up --build -d` | PASS — Admin UI, API, worker, PostgreSQL, Redis all started; DB and Redis healthy |
| Browser verification at `http://localhost:5173` | PASS — authenticated Dashboard, Shops, Products, Credentials, Webhooks, Orders, Deliveries, Scenarios, Documentation, Users, and Order Detail rendered with live data and no console errors |
| Go and Node/TypeScript example clients | PASS — each made a real signed request to Compose and returned 10 products |
| `cd apps/marketplace && GOCACHE=$(pwd)/.gocache go test ./...` after lifecycle update | PASS |
| `cd apps/marketplace/admin && bun test && bun run typecheck && bun run lint && bun run build` after lifecycle update | PASS — 2 frontend tests, TypeScript, ESLint, production bundle |
| `cd apps/marketplace && GOCACHE=$(pwd)/.gocache go test -count=1 -race -tags=testcontainers ./integration ./cmd/worker` | PASS — integration 24.480s; worker 6.766s, including new lifecycle/shipment contract test |
| `cd apps/marketplace && GOCACHE=$(pwd)/.gocache go test -count=1 -v -tags=integration ./integration -run TestOrderLifecycleAndShipmentAPIsEndToEnd` | PASS — 2.51s against the real Compose API, worker, PostgreSQL, Redis, and webhook receiver |
| Compose retry E2E + worker logs | PASS — first 500 retry scheduled for 30 seconds and second delivery succeeded (actual worker log) |
| `docker compose up --build -d --force-recreate` and `/ready` | PASS — migration applied to persistent old data; API, worker, Admin, PostgreSQL, and Redis are Up; served OpenAPI contains `ready-to-ship` and `order.paid` |
| Browser runtime at `http://localhost:5173` | PASS — authenticated Orders and Developer Portal show new lifecycle, public shipment guide, live `UNPAID` order, and no console errors |
| `cd apps/marketplace/admin && bun run typecheck && bun run lint && bun run test && bun run build` after separate Shipments update | PASS — TypeScript, ESLint, 3 unit tests, production bundle |
| `cd apps/marketplace && GOCACHE=/Users/enrico/Documents/engineering-challenge/apps/marketplace/.gocache go test ./...` after separate Shipments update | PASS |
| `cd apps/marketplace && GOCACHE=/Users/enrico/Documents/engineering-challenge/apps/marketplace/.gocache go test -tags=testcontainers ./integration -run TestContainerOrderLifecycleAndShipmentAPIs -v` | PASS — real PostgreSQL/Redis Testcontainers verifies scoped list/detail, pagination metadata, access isolation, atomic shipment/order updates, timestamps, and rejected invalid transition |
| Compose/browser E2E for separate Shipments update | NOT RUN — explicitly excluded by the requested test constraint |
| `go test ./...` after Provider/Payment/Package increment | PASS — backend unit/regression suite |
| `bun run typecheck && bun run lint && bun run test && bun run build` after Provider/Payment/Package increment | PASS — TypeScript, ESLint, 3 frontend tests, production build |
| `go test -tags=testcontainers ./integration -run TestContainerOrderLifecycleAndShipmentAPIs -v` after migration 006 | PASS — PostgreSQL/Redis migration through `006_provider_payment_packages.sql`; lifecycle and shipment-created package retrieval verified |
| `go test -tags=testcontainers ./cmd/worker -run TestContainerWorkerEnforcesPaymentExpiryAndSellerSLA -v` | PASS — real PostgreSQL/Redis verifies payment expiry becomes `EXPIRED` + `CANCELLED`, seller SLA becomes `CANCELLED`, and both durable domain events are written |
| `go test -tags=testcontainers ./integration -run TestContainerShopeeLikePublicContract -v` | PASS — isolated PostgreSQL/Redis verifies separate route/signing, pagination, errors, rate-limit headers, webhook registration, seller flow, package, shipment, and delivery |
| `go test -tags=testcontainers ./cmd/worker -run TestContainerWorkerDeliversShopeeLikeWebhookContract -v` | PASS — provider event mapping, payload envelope, `X-Shopee-*` headers, and worker delivery against a live receiver |
| `go generate ./internal/api/openapi` | PASS — regenerated committed client types for the TOKOPEDIA_LIKE routes, headers, request bodies, and lifecycle enums |
| `go test ./...` after TOKOPEDIA_LIKE/RTS update | PASS — backend unit and regression suite |
| `bun run typecheck && bun run lint && bun run test && bun run build` in `apps/marketplace/admin` | PASS — TypeScript, ESLint, 3 unit tests, production bundle |
| `go test -count=1 -tags=testcontainers ./integration -run TestContainerTokopediaLikeRTSAndInventoryReservation -v` | PASS — isolated PostgreSQL/Redis verifies migration 007, provider auth/signing, pack/handover/status projection, opaque listing, concurrent stock reservation, stock release, and return-to-sender transition |
| `go test -count=1 -tags=testcontainers ./cmd/worker -run TestContainerWorkerDeliversTokopediaLikeWebhookContract -v` | PASS — isolated worker/live receiver verifies numeric webhook type, stable notification ID, no Generic headers, and `Authorization` signing |
| `go test -count=1 -race -tags=testcontainers ./integration ./cmd/worker` after P2 | PASS — complete PostgreSQL/Redis integration and worker matrix, including Generic, SHOPEE_LIKE, TOKOPEDIA_LIKE, retries, payment expiry, SLA, packages, and return-to-sender behavior |
| `go generate ./internal/api/openapi && go test ./internal/api/openapi ./internal/server` after warehouse contract update | PASS — committed OpenAPI client bindings regenerated and server regressions pass |
| `bun run typecheck && bun run lint && bun test && bun run build` in `apps/marketplace/admin` after warehouse UI update | PASS — TypeScript, ESLint, 3 unit tests including `/warehouses` navigation, and production bundle |
| `go test ./...` and `cd packages/dummy-generator && go test ./...` after warehouse update | PASS — all in-process Marketplace and generator tests |
| `go test -count=1 -tags=testcontainers ./integration -run 'TestContainerWarehouse(MigrationBackfillsExistingInventory|AllocationReservationAndFulfillment)' -v` | PASS — populated v7-to-v8 migration backfill, priority allocation, public API isolation, cancellation release, package link, and physical shipment deduction |
| `go test -count=1 -tags=testcontainers ./cmd/worker -run TestContainerWorkerEnforcesPaymentExpiryAndSellerSLA -v` | PASS — worker expiry/SLA cancellation plus warehouse-reservation release |
| `go test -count=1 -race -tags=testcontainers ./integration ./cmd/worker` after warehouse update | PASS — full Generic, SHOPEE_LIKE, TOKOPEDIA_LIKE, lifecycle, package, worker, webhook, and warehouse regression matrix |
| `cd apps/marketplace && go generate ./internal/api/openapi && go test ./...` after Generic-order removal | PASS — regenerated public bindings; no legacy Generic order routes or handlers compile. |
| `cd apps/marketplace/admin && bun run typecheck && bun run lint && bun test && bun run build` after Generic-order removal | PASS — 3 frontend tests, TypeScript, ESLint, production bundle. |
| `cd apps/marketplace && go test -count=1 -race -tags=testcontainers ./integration ./cmd/worker` after Generic-order removal | PASS — full PostgreSQL/Redis provider, inventory, package, shipment, worker, and webhook regression matrix; Generic order route is asserted absent. |
| `go test -tags=testcontainers ./integration -run TestContainerProviderProductContracts -v` | PASS — PostgreSQL/Redis verification of Shopee-like and Tokopedia-like product contracts, provider field/envelope distinction, and removal of `/api/v1/products`. |
| `go test -race -count=1 -tags=testcontainers ./integration -run TestContainerSelfRegistrationCreatesOperatorSession -v` | PASS — registration issues an OPERATOR session, permits authenticated control-plane access, rejects duplicate email, and rejects invalid input. |
| `go vet $(go list ./... \| grep -v '/admin/node_modules/') && golangci-lint run ./...` after seed reset fix | PASS — Go static analysis and lint report zero issues. |
| `bun run typecheck && bun run lint && bun run test && bun run build` after seed reset fix | PASS — TypeScript, ESLint, 19 frontend tests across 8 files, and production bundle. |
| `go test -count=1 -race -tags=testcontainers ./integration -run '^TestContainerResetPermissionAndTransactionalOutbox$' -v` | PASS — Operator can reset an owned shop to 100 products/50 orders, cannot reset another owner's shop, and transactional persistence is verified. |
| Rebuild/recreate `marketplace-api` and `marketplace-admin`, then `/ready` and Compose health checks | PASS — both rebuilt containers are healthy and the API reports ready. |
| `cd apps/marketplace && make check` after P1 audit closure | PASS — zero Go lint issues; 22 frontend tests plus lint/typecheck/build; race-enabled Testcontainers integration 64.045s and worker 17.423s; core coverage 81.1%. |
| `cd apps/marketplace && make test-race` after idempotency buffering | PASS — all Go packages, including the finalization-failure regression, pass the race detector. |
| Rebuild/recreate P1 `marketplace-api` and `marketplace-admin`, then runtime checks | PASS — both containers healthy; `/ready` returns ready, `/docs` returns 200, and containers remain non-root (UID 100/101). |
| `cd apps/marketplace && make check` after audit-priority P2 closure | PASS — generated bindings clean; zero lint issues; 25 frontend tests plus typecheck/build; race-enabled Testcontainers integration 81.905s and worker 23.631s; core coverage 81.1%. |
| Rebuild/recreate Admin after audit-priority P2 closure | PASS — all five Compose services healthy; `/ready` is ready, `/docs` returns 200, and the served production bundle contains all three provider pagination markers. |
| `make check` after audit-priority P0 security closure | PASS — generated bindings clean; zero lint issues; `govulncheck` reports 0 reachable vulnerabilities; 25 frontend tests plus typecheck/build; race-enabled Testcontainers integration 106.414s and worker 38.073s; core coverage 81.1%. |
| Final API/worker Docker build, binary metadata, and binary-mode vulnerability scan | PASS — both binaries use Go 1.25.14 and patched dependency versions; both scans report 0 reachable vulnerabilities; recreated services are healthy and `/health` plus `/ready` succeed. |
| `cd apps/marketplace && make check` after backend core coverage hardening | PASS — generated bindings clean; zero Go lint issues; 0 reachable vulnerabilities; 74 frontend tests plus coverage/build; race-enabled PostgreSQL/Redis Testcontainers; all 10 core packages independently meet 80%; aggregate core coverage 93.8%. |
| `go test -race ./internal/idempotency ./internal/inventory ./internal/orders ./internal/products` | PASS — focused race detection covers all packages changed by the backend coverage work. |
| `make coverage-core CORE_COVERAGE_MIN=99` negative gate check | EXPECTED FAIL — packages below 99% are reported individually, proving the per-package threshold cannot be masked by aggregate coverage. |

## E2E flows verified

- Verify that signed `GET /api/v1/orders` returns `404`, then use only the selected Shopee-like or Tokopedia-like order boundary.
- For Shopee-like: pay through the control plane; call `ship-order`, `ready-to-ship`, partial package allocation, shipment creation, and progress the shipment with simulator controls.
- For Tokopedia-like: cancel through the versioned, query-signed provider endpoint; then execute `pack`, `handover`, provider shipment creation, and return-to-sender progression.

- Authenticate to the control plane, create a shop, reset/seed it, and create a one-time integration credential.
- Sign a public API product request using the documented HMAC canonical string; replay the same idempotency key; paginate signed product results.
- Run the published Go and Node/TypeScript client examples against Compose with a freshly created, one-time credential.
- Apply a name-only product PATCH without changing price/stock; explicitly set zero values when intended.
- Create random and custom simulated orders, preserve customer/item snapshots, and inspect order detail/event timeline/shipment.
- Register a webhook, receive asynchronous `order.created`, validate its stable event ID and HMAC signature, and inspect delivery history.
- Return HTTP 500 from a consumer endpoint and observe a second actual delivery after approximately 30 seconds.
- Replay, duplicate, and delay an event; confirm the stable event identity and separate delivery records.
- Verify Redis rate-limit headers and 429 behavior, plus per-shop scenario isolation.
- Exercise random 500, slow-response, timeout, duplicate, delayed, out-of-order, and forced-webhook-failure scenarios.
- Enable maintenance mode and receive documented `503 MARKETPLACE_MAINTENANCE` from the public API while control-plane calls remain usable.
- Verify health, readiness, OpenAPI, Swagger, Prometheus metrics, worker/outbox delivery, and Docker service startup.
- Create an `UNPAID` order from the control plane; reject public `UNPAID → PROCESSING`; verify payment; call signed merchant `process` and `ready-to-ship` actions.
- Create a public `generic_express`/`PICKUP` shipment in `CREATED`, retrieve it by order and shipment ID, move it through SHIPPED/IN_DELIVERY/DELIVERED with simulator controls, then complete the order.
- Open the separate Shipment resource through its control-plane API, obtain the linked order/tracking detail, reject another shop’s operator, and advance each valid fulfillment state atomically in isolated PostgreSQL/Redis Testcontainers.
- Subscribe a real webhook receiver and receive `order.paid`, `order.processing`, `order.ready_to_ship`, `order.shipped`, `order.in_delivery`, `order.delivered`, and `order.completed`; reject cancellation after shipment.
- Use `/api/shopee/v1` with partner-style signing, page-number order pagination, provider error/rate-limit behavior, customer cancellation, seller process/ready-to-ship, webhook registration, package allocation, shipment creation, and delivery for a `SHOPEE_LIKE` shop.
- Create a priority warehouse, stock it independently, create an order, and verify that the order/package/shipment all reference it; then verify reserve, cancellation/expiry release, and physical stock deduction on shipment.

- Receive a transformed `order_status_update` webhook with `X-Shopee-*` signature headers from the background worker.
- Create a `TOKOPEDIA_LIKE` shop and one-time app credential; make real query-signed/access-token authenticated pack, handover, and opaque order-search calls, receiving the mapped `AWAITING_SHIPMENT` and `AWAITING_COLLECTION` statuses.
- Submit two simultaneous orders against one unit of stock and observe exactly one creation; cancel the accepted order and observe stock restored.
- Create a shipment, report a delivery failure with reason, progress the package through return to sender, and verify both shipment (`RETURNED`) and linked order (`RETURNED`) state after the final return.
- Receive the provider-specific numeric webhook body at a live HTTP receiver and validate its `Authorization` HMAC rather than Generic/Shopee headers.

## Remaining gaps / known limitations

There are **no remaining gaps against the initial Marketplace Simulator PRD v0.2, Order Lifecycle & API Brief, or the requested P0/P1/P2 provider-profile expansion**.

Operational notes, not PRD gaps:

- The final audit reran the full Compose build/start and runtime smoke checks for Admin, API, worker, PostgreSQL, and Redis. Browser-driven E2E was not repeated because the affected UI behavior is covered by frontend typecheck/lint/unit/build checks and the backend behavior by isolated PostgreSQL/Redis Testcontainers.
- This is intentionally a local sandbox. Before any non-local use, replace the documented development credentials and encryption/session secrets.
- The Compose volume is persistent and now contains audit-created sample shops/orders. It was deliberately not deleted; a destructive volume reset was outside the audit scope.
- SAP, Shipping, Payment, and Identity simulators are future work explicitly outside this initial Marketplace-only scope.
- Returns, refunds, disputes, partial shipments, and a separate Shipping Simulator remain intentionally outside v1, as specified by the new brief.
