# Marketplace backend architecture

The API uses a layered boundary for business operations that need durable,
transactional state changes:

`HTTP handler → application service → repository → PostgreSQL/Redis`

Handlers decode transport input, choose the provider response shape, and map
application errors to HTTP. They do not decide authentication validity, order
transition rules, inventory side effects, or outbox behavior.

## Authentication

`internal/auth.Service` owns self-registration, login, and session validation. Its
`IdentityRepository` is implemented by
`internal/repository/auth.PostgreSQLRepository` using sqlc queries.

The service normalizes registration/login emails, only self-registers
`OPERATOR` identities, hashes passwords before persistence, signs sessions,
and compares a token's claims with
the persisted session version. This makes revocation effective immediately.

## Order lifecycle

`internal/orders.Service` owns the canonical transition and cancellation
rules. Its `LifecycleRepository` owns the PostgreSQL transaction, including:

1. Locking the order and reading provider/payment state.
2. Updating the lifecycle and provider-specific cancellation audit fields.
3. Committing or releasing inventory reservations.
4. Writing the durable domain event and transactional outbox record.

The order repository is intentionally the only component in this flow that
depends on pgx transactions, inventory persistence, and outbox persistence.
The service depends only on a small interface, so unit tests use an in-memory
fake while Testcontainers exercises the real PostgreSQL/Redis adapter.

## Catalogue management

`internal/products.Service` owns product-draft normalization and catalogue
rules for create, detail, update, and archive: an SKU and name are required,
price and stock cannot be negative, and status is either `ACTIVE` or
`INACTIVE`. Its repository adapter keeps product changes, warehouse inventory,
and product lifecycle events in one transaction. Archive retains historical
order snapshots and refuses a product with active reservations.

The control-plane product endpoint maps domain errors to stable HTTP errors:
invalid drafts return `400 INVALID_REQUEST`, while a database uniqueness
violation becomes `409 DUPLICATE_SKU`. This keeps database-specific error
types out of HTTP handlers.

## HTTP boundaries and idempotency

`internal/server/routes.go` composes separate control-plane, shared, Shopee-like,
and Tokopedia-like route groups. The transport package is split into focused
control shop/inventory/fulfillment/webhook/admin modules and provider
catalog/fulfillment/webhook/Tokopedia modules. Provider adapters share the
canonical domain services and persistence, while retaining independent
authentication, pagination, status projection, error, and webhook contracts.

All public mutations pass through one idempotency middleware backed by an
atomic PostgreSQL claim. A claim binds credential, logical operation, key, and
request fingerprint. Concurrent duplicates cannot execute twice; completed
successes are replayed byte-for-byte; conflicting payload reuse is rejected;
and expired lease takeover uses a new owner token so a stale worker cannot
complete or release the replacement claim.

## Persistence invariants and background work

Inventory allocation aggregates duplicate order lines and locks products in a
deterministic order. Deferred PostgreSQL constraint triggers reject an empty
package and any package allocation above its order-item quantity; the
referenced order-item row serializes concurrent commits, protecting the
invariant even when writes bypass the application service. Product archival
and order allocation also share a product-row lock so an active reservation
cannot race a catalogue deletion. Deadline
cancellation is revalidated under an order lock before status, reservation,
event, and outbox changes commit atomically.

Webhook registration validates callback URLs. Production delivery resolves the
hostname again at dial time and accepts only public IP addresses; every redirect
is revalidated to resist private-target redirects and DNS rebinding.

## Testing strategy

- Unit tests cover authentication, catalogue management, and lifecycle invariants
  through fake repositories and deterministic clock/id dependencies.
- Server tests cover transport-level behavior.
- Testcontainers integration tests exercise Shopee-like cancellation,
  Tokopedia-like fulfillment/reservations, concurrent idempotency, database
  constraints, multi-package fulfillment, and full lifecycle/shipment paths
  against PostgreSQL and Redis.

The `coverage-core` target enforces at least 80% aggregate statement coverage
for domain and provider policy packages. Generated bindings and infrastructure
adapters are verified by generation/contract tests and Testcontainers rather
than inflating the domain gate.

Future write-heavy domains should follow the same pattern: introduce a focused
repository interface at the consuming service, keep transaction ownership in
the repository adapter, and preserve HTTP handlers as transport-only code.
