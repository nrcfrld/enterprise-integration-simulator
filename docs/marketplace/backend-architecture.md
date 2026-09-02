# Marketplace backend architecture

The API uses a layered boundary for business operations that need durable,
transactional state changes:

`HTTP handler → application service → repository → PostgreSQL/Redis`

Handlers decode transport input, choose the provider response shape, and map
application errors to HTTP. They do not decide authentication validity, order
transition rules, inventory side effects, or outbox behavior.

## Authentication

`internal/auth.Service` owns login and session validation. Its
`IdentityRepository` is implemented by
`internal/repository/auth.PostgreSQLRepository` using sqlc queries.

The service normalizes login emails, hides unknown-account details behind one
invalid-credential error, signs sessions, and compares a token's claims with
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

## Catalogue creation

`internal/products.Service` owns product-draft normalization and catalogue
rules: an SKU and name are required, price and stock cannot be negative, and
status is either `ACTIVE` or `INACTIVE`. Its `Creator` repository adapter
atomically creates the product, provisions the shop's default warehouse when
needed for legacy single-stock inputs or initializes the submitted per-warehouse
stock allocation, and records `product.created` in the
transactional outbox.

The control-plane product endpoint maps domain errors to stable HTTP errors:
invalid drafts return `400 INVALID_REQUEST`, while a database uniqueness
violation becomes `409 DUPLICATE_SKU`. This keeps database-specific error
types out of HTTP handlers.

## Testing strategy

- Unit tests cover authentication, catalogue creation, and lifecycle invariants
  through fake repositories and deterministic clock/id dependencies.
- Server tests cover transport-level behavior.
- Testcontainers integration tests exercise Shopee-like cancellation,
  Tokopedia-like fulfillment/reservations, and full lifecycle/shipment paths
  against PostgreSQL and Redis.

Future write-heavy domains should follow the same pattern: introduce a focused
repository interface at the consuming service, keep transaction ownership in
the repository adapter, and preserve HTTP handlers as transport-only code.
