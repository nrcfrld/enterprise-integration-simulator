# Enterprise Integration Simulator

Marketplace Simulator is a local learning environment for practicing signed APIs, webhooks, retries, failures, and recovery against Shopee-like and Tokopedia-like contracts. It is designed for entry-level and junior integration developers.

## Start here

1. Start the complete local stack:

   ```bash
   docker compose up --build
   ```

2. Open [Admin UI](http://localhost:5173) and sign in with `admin@example.test` / `change-me-now`, or select **Create account** to create an Operator.
3. Select the demo shop or create one, then create an API credential and save its one-time secret.
4. Open **Documentation → Request simulator**, choose the shop's provider, and send a product list/search request.
5. Continue with an order and webhook exercise from **Documentation → Start here**.

Control Plane accounts only open the Admin UI. Public API requests use a shop integration credential; the two credential types are not interchangeable.

## Choose your guide

| Goal | Start here |
| --- | --- |
| Send a first signed request and follow an order workflow | [Integration guide](docs/marketplace/integration-guide.md) |
| Receive, verify, and retry webhook deliveries | [Webhook guide](docs/marketplace/webhook-guide.md) |
| Configure or troubleshoot the local environment | [Operations guide](docs/marketplace/operations-guide.md) |
| Understand services, persistence, and worker boundaries | [Backend architecture](docs/marketplace/backend-architecture.md) |
| Inspect every public request and response schema | [OpenAPI](apps/marketplace/openapi/openapi.yaml) or [Swagger UI](http://localhost:18080/swagger/index.html) |

Minimal signed clients are available in [Go](apps/marketplace/examples/go-client) and [Node.js/TypeScript](apps/marketplace/examples/node-client).

## Local endpoints

- Admin UI: http://localhost:5173
- API: http://localhost:18080
- OpenAPI: http://localhost:18080/openapi.yaml
- Swagger UI: http://localhost:18080/swagger/index.html
- Metrics: http://localhost:18080/metrics

The first Compose volume includes **Marketplace Demo Store**, 100 products, 50 historical orders, an unusable sample credential, and a disabled webhook. Create a credential when you need a usable one-time secret. Resetting a shop deletes its credentials, catalogue, orders, events, and webhook history; the UI shows the full impact before confirmation.

The bootstrap account and default `MARKETPLACE_*` values are for local development only. Follow the [operations guide](docs/marketplace/operations-guide.md#safe-local-operation) before running outside a trusted local environment.

## Development shortcuts

Run `make help` from the repository root or `apps/marketplace`. Use `make test-fast` without Docker, `make test` for the complete test suite, and `make check` for the full quality gate.

## Contract and code generation

[`apps/marketplace/openapi/openapi.yaml`](apps/marketplace/openapi/openapi.yaml) is the public API source of truth. It drives both the served Swagger UI and the committed Go client/types in `apps/marketplace/internal/api/openapi/client.gen.go`. After a contract change, regenerate both public bindings and database bindings:

```bash
make generate
```

Database changes are versioned Goose migrations under `apps/marketplace/migrations`. Application startup applies pending migrations. Domain SQL used by control-plane catalogue, shop, and order reads/writes is declared in `internal/store/queries.sql` and generated with sqlc; keep handler code free of new static domain SQL where a sqlc query applies.

CI reruns both OpenAPI and sqlc generators and rejects any resulting tracked or
untracked drift. Commit generated bindings together with their source contract
or query changes. Run `make generate-check` locally for the same verification.

Generic deterministic dummy data belongs in `packages/dummy-generator`; Marketplace-specific SKU, price, and stock rules belong in `apps/marketplace/internal/products`.

## Verification

Fast checks run without containers:

```bash
make test-fast
```

The full quality gate includes lint, a pinned reachable-vulnerability scan,
frontend checks and coverage (minimum 60% for statements, branches, functions,
and lines), core-domain coverage (minimum 80%), and isolated PostgreSQL/Redis
Testcontainers:

```bash
make check
```

Use `make vuln` for only the Go vulnerability gate,
`make test-integration` for the race-enabled integration/worker matrix, or
`make admin-coverage` to generate the Admin UI text, HTML, and LCOV reports.
For the production-browser journey, install Chromium once with
`cd apps/marketplace/admin && bunx playwright install chromium`, then run
`make browser-smoke` from the repository root. The target builds and waits for
the Compose stack, then verifies login, shop creation/selection, seed reset,
concurrent inventory contention, one-time credential creation, and a signed
catalogue request. CI installs the browser and runs the same journey automatically.
Use `make docker-build` to verify all production images. The Go patch release
is pinned consistently across the workspace, CI, and production build image.
