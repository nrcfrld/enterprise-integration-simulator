# Implementation Report — Enterprise Integration Simulator

Latest Product & DX audit: 2026-09-09 (implementation verification history below begins 2026-09-04)
PRD: Enterprise Integration Simulator v0.2, updated by Order Lifecycle & API Brief  
Scope: Marketplace Simulator initial scope plus replacement order lifecycle

## Latest audit — Marketplace dashboard usability and Developer Experience

**C1–C4 and H1–H17 are implemented. Four Nice-to-Have findings (N1–N4) remain OPEN. C5 is excluded by the user's explicit decision to keep the frontend on port 5173.** Validation limitations for the current High Priority changes are stated below; historical audit text describes the product at that checkpoint.

The [audit index](specs/general/UI-IMPROVEMENTS.md) retains original findings and remediation history. The [2026-09-09 audit snapshot](specs/general/UI-AUDIT-2026-09-09.md) records the source-based walkthrough and links to current implementation status.

| Priority | Current status |
| --- | --- |
| Critical | C1–C4 fixed; C5 excluded (5173 retained). |
| High Priority | H1–H17 implemented; SQLc generator comparison for H14 PASS. |
| Nice to Have | N1 list labels/columns, N2 scenario exercises/reset, N3 durable destinations, N4 account/admin discoverability remain open. |

### Implemented — H11–H14, H16, H17 (2026-09-09)

**C5 is excluded by the user's decision: the supported local frontend origin remains port 5173.** The API CORS allowlist, Vite port configuration, and Playwright destination were not changed. N1–N4 remain open.

| Finding | Implemented behavior | Verification |
| --- | --- | --- |
| H11 | Portal Start Here/Webhooks and a dedicated **Durable consumer exercise** link to provider-specific fresh UNPAID → payment → merchant fulfillment lessons. Downloadable Node 22.13+ consumer uses a SQLite inbox unique by shop/event, commits before 204, serially fetches and persists current provider documents, records processing/errors separately, traverses all order pages, and persists mutation inputs/keys before sending. Lessons cover IDs, explicit/automatic packages, duplicate/restart/out-of-order/retry/return evidence and the next ERP/OMS business intent. The original receiver is explicitly labeled an in-memory starter. | Real temporary SQLite databases test both providers across restart, duplicate acceptance, delayed shipment parent-ID mapping/current-state processing, API failures, pagination, durable retry keys and commit-before-acknowledgement. Public routes/signing were checked against implementation, including Shopee `process` → `/ship-order`. |
| H12 | One request input/preparation model supplies actual fetch, prepared URL/header/body evidence and Node export using edited path/query/raw body/retry key. Credential values use environment variables; webhook body secrets use an environment placeholder. Tokopedia signing-input credential secrets and outgoing access tokens are redacted. Response diagnostics include replay/retry/quota headers, preserved request IDs in provider bodies, explicit HTTP/API failure guidance, and an unformatted response-body view. | Generated exports are executed with mocked fetch and compared against prepared requests for all three contracts; tests assert exact edited query/body/key and credential redaction. HTTP rejection/retry-header regressions pass. Existing CORS already exposes supported diagnostic headers; no allowlist change was needed. |
| H13 | Unfiltered Tokopedia search defaults, runnable receiver callback addresses, body constraints beside Try, per-operation in-memory drafts and keys, explicit Retry same operation/New operation, elapsed time, 1–120s timeout/Stop waiting, request invalidation on reset/unmount/credential changes, and returned-ID/next-page handoffs for both providers. Changing inputs or Client ID cannot silently reuse an earlier mutation's retry identity. | Tests cover reset/late response isolation, abort on unmount, timeout without a rollback claim, draft remount/retry identity, changed-body and changed-credential guards, default filters, returned IDs and opaque next-page tokens. |
| H14 | Global shop/picker collections follow control pagination to completion with filterable choices. Shop selection hydrates from the selected row, persists only its non-secret ID for reload, and restores provider context. Webhooks has pagination/true registration totals and explicitly page-scoped enabled counts. Product source query no longer stops at 1,000 before control pagination. | Tests select/restore shop 21, edit webhook 21, offer product/warehouse 101, and reject incomplete picker loads. Backend pagination test returns product 1001; server tests pass and SQL query bindings compile. **SQLc regeneration comparison PASS:** the approved generator run produced identical bindings. |
| H16 | Generated Shopee webhook secrets have a protected one-time dialog with shop/endpoint context, copy feedback, explicit saved acknowledgement, receiver configuration and lost-secret replacement guidance. Escape cannot discard the only copy. Tokopedia continues to use app-credential verification and receives no irrelevant secret handoff. | Generated-secret form regression checks no generic notice, copy, Escape protection and acknowledgement. Existing Tokopedia contract and credential dialog tests remain passing. |
| H17 | Acknowledged stock drafts are cleared; clean inputs follow refreshed on-hand counts. Unsaved edits retain their baseline, show a conflict if the server count changes, and block replacement until reviewed via Use latest count. Save/Add controls guard duplicate submissions. | Tests cover save 10 → externally refreshed count 8 → unchanged Save sends 8, unsaved edit conflict/review, and pending duplicate submission guards. This is a rendered component regression, not a live concurrent inventory experiment. |

**Validation:** 174 frontend tests across 45 files; 10 standalone durable-consumer tests; focused server tests and SQL binding compilation. TypeScript, lint and production build PASS; the mechanical detector reports no findings. A final focused rerun of the changed form/portal suites passed 20 tests after the complete frontend suite, and the 10 consumer tests passed again after correcting/locking the Shopee `/ship-order` action mapping. No Docker Compose, browser E2E, database migration, production/shop data mutation, or commit was performed.

**SQLc validation completed after user approval:** `go generate ./internal/store` PASS. The generated bindings exactly match the existing implementation (queries.sql.go blob `b4d0ff3e0536038de0cd3939f74cccfa6bc092b7` before and after; no additional generated-file changes). Backend server tests and binding compilation pass after regeneration. The earlier usage-limit approval block is resolved.

**Validation boundary:** The catalog regression verifies control pagination beyond 1,000, not a new live PostgreSQL performance or concurrency benchmark. Control pickers currently exhaust pages before local filtering; server-side search/virtualization for very large collections is future optimization.

**Product & DX Review:** Admin (shops, webhooks, pickers, warehouse editing), Portal, API Simulator, examples and repository guidance were updated together. Backend change is limited to removing the hidden catalog query cap. Domain rules, public API routes/envelopes, OpenAPI shapes and webhook worker behavior are unchanged; their contracts were reviewed against the new examples. Durable business side effects, multi-worker consumer leasing and production ERP integration remain explicitly outside this local learning exercise. No open Nice-to-Have item is marked implemented.

### Pre-fix reassessment — 2026-09-09 (historical snapshot)

Reviewed **d881cd9** after the H9/H10 work and the subsequent Webhooks/Start Here hierarchy update. The [current audit](/Users/enrico/Documents/engineering-challenge/specs/general/UI-AUDIT-2026-09-09.md) contains all 11 open findings with problem, junior-developer impact, affected feature, concrete recommendation and current source evidence, plus a ten-step walkthrough, documentation/simulator coverage, terminology, obsolete UI and prioritized plan.

**New, not implemented:** C5 confirms the user-reported 5174 login preflight failure against the hard-coded CORS allowlist; H16 records the generated Shopee webhook secret's notification-only handoff; H17 records stale saved on-hand drafts surviving refreshed warehouse data. H11 is narrowed: the runnable receiver, lifecycle guide, inventory example and delivery diagnosis are present; durable external processing/reconciliation remains a missing complete exercise. H14 now records page-only webhook totals and unresolved provider context after selecting an existing later-page shop. The earlier resolved findings are not reopened wholesale.

**Validation:** 152 frontend tests / 40 files PASS under bundled Node; existing CORS middleware test PASS; mechanical detector reports no findings across Admin and portal source. The CORS test does not cover 5174 and is not evidence that the reported failure is fixed. This was a source-based cognitive walkthrough plus the user's supplied CORS evidence, not a new browser execution or visual/accessibility certification. No Compose, browser E2E, rebuild, migration or application data mutation was performed.

**Product & DX Review:** Domain, Backend, OpenAPI, Admin, Developer Portal, API Request Simulator, Examples and Tests reviewed together. Only the audit reports and this implementation report changed. C5/H11–H14/H16/H17/N1–N4 remain OPEN / NOT IMPLEMENTED.

### Original audit validation and boundaries

- Source-based review at commit `0dfdd77` of Admin UI, Developer Portal, simulator, routes/handlers, worker, OpenAPI, repository guides, and example clients. The walkthrough is a cognitive walkthrough, not a completed live integration or user study.
- The documented UI address `localhost:5173` was unreachable during a connection check. No services were started or application records changed. No Docker Compose or browser E2E was run.
- Existing focused frontend checks passed: `bun run test -- src/features/developer-portal/data/endpoints.contract.test.ts src/features/developer-portal/components/RequestSimulator.test.tsx src/features/developer-portal/components/CodeExamples.test.tsx src/features/developer-portal/sections/Guides.test.tsx` — **18 tests in 4 files**. These tests do not establish semantic documentation parity or end-to-end usability; the report identifies their relevant blind spots.
- All 25 public operations already have simulator entries. The missing capabilities concern optional fields, pagination inputs, realistic examples, request chaining/export, and diagnostics. No absent endpoint was inferred merely from an absent standalone resource screen.
- The historical limitation below excluding partial shipments is superseded for current behavior: partial package allocation and multiple package-linked shipments are implemented. H1/H2 now cover package workflow and relationship discoverability; other response/filter/pagination documentation gaps remain under H3. Returns/refunds/disputes and a separate Shipping Simulator should be scoped independently; current return-to-sender behavior does not imply a full returns/refunds workflow.

### Remaining implementation plan

1. N1: task-oriented list columns and unambiguous counts/dates/actions.
2. N2: scenario presets, consistent language and explicit clear-faults behavior.
3. N3: durable non-secret lesson/detail destinations and navigation semantics.
4. N4: optional account registration placement and Admin user-management entry.

The requested High Priority work and SQLc validation are complete. N1–N4 remain proposed; retain the user-selected 5173 origin.

**Original audit Product & DX Review:** reviewed Domain, Backend, OpenAPI, Developer Portal, API Request Simulator, Examples, Admin/Control Plane, and Tests together. That audit updated only this implementation report and the audit artifact; the subsequent C1–C4 implementations and verification are recorded below.

## Prior remediation — H9/H10 events and inventory discovery (2026-09-09)

**H9 and H10 FIXED.** Earlier uncommitted work was preserved. At this checkpoint, the remaining audit findings were H11–H14 and N1–N4; the current reassessment above adds C5, H16 and H17.

- **H9:** Real shop Event Logs with resource/type filters before pagination, canonical payload inspection, replay/duplicate/delay, and resource/delivery links. Product and shipment details expose trails; order trails include linked shipment failures/returns and deliveries. Admin/portal/simulator share all 18 event names, trigger guidance and provider mapping. Shopee logistics and Tokopedia order subscription expansion now include the missing failure/expiry/return events. Existing subscription selections are preserved; the guide explains how to reconfigure them.
- **H10:** Explicit Warehouses & Inventory navigation, stable product stock/status columns, per-product warehouse ledgers and stock-editor links, and clear order/warehouse/product-edit help. Portal and warehouse simulator explain on-hand/reserved/available accounting, largest-priority/single-warehouse allocation, tie-breaking, a worked multi-line example, and physical count replacement.

| Verification | Result |
| --- | --- |
| Frontend suite using bundled Node runtime | PASS — 152 tests across 40 files. Includes catalog parity, event filters/paging, late previous-shop response isolation, event replay and delivery links, subscription choices, stock columns, and warehouse editor navigation. Bun runs ended prematurely without complete summaries; Node completed the full suite. |
| Frontend typecheck, ESLint, production build | PASS |
| Go package tests, vet, golangci-lint | PASS — no static-check issues. |
| Isolated race-enabled integration/worker suites | Worker PASS (44.801s). Full integration run passed all behavior checks except one PostgreSQL startup timeout in the existing idempotency test; focused retry of that test plus both H9/H10 suites PASS (18.492s). |
| OpenAPI generation | PASS — event feed, product/shipments’ event trails, warehouse projections and full shared subscription enums documented; bindings regenerated. |
| UI mechanical detector | PASS — no findings in new event/inventory surfaces. |
| Docker Compose / browser E2E | NOT RUN. Existing running services were not rebuilt or migrated. |

**Product & DX Review:** Domain accounting and event emission were checked against the source of truth; no canonical lifecycle or inventory rules changed. Backend projections/provider subscription coverage, OpenAPI, Admin, Developer Portal, API Simulator guidance, repository workflow examples, and regression tests were updated together. No new public event API is introduced: Event Logs is an authenticated control-plane inspection tool. Public warehouse APIs remain read-only. Existing event selections are not silently broadened. Product archive history remains available in the event feed even when its resource detail is no longer available; normal shipment milestones are found on the linked order. A complete external consumer exercise, exact request export and deeper pagination work remain separately open.

## Prior remediation — H5/H6/H8 context, lifecycle guidance and delivery diagnostics (2026-09-09)

**H5, H6 and H8 FIXED.** Existing uncommitted H3/H4/H7/H15 changes were preserved. At that checkpoint, H9–H14 and N1–N4 remained open; H9/H10 are resolved in the latest remediation above.

- **H5:** Provider context throughout console/portal, matching provider defaults and quick starts, in-memory one-time credential handoff back to the current edited request, direct return from Credentials, provider mismatch prevention and honest ownership/lost-key guidance. Portal state lives for the authenticated selected shop across console visits and is cleared on shop switch/reset/sign-out/reload. No secret is placed in browser storage or URLs.
- **H6:** Domain-derived action eligibility/cancellation options, authoritative payment state and canonical/provider status labels, separate payment/customer/merchant/carrier instruction, explicit cancellation actor and reason, and a portal lifecycle/actor/mapping guide. Backend mutations retain locked validation; legacy empty control cancellation requests retain SELLER/OUT_OF_STOCK for compatibility.
- **H8:** Migration 015 stores immutable attempt destination, exact signed body, provider, signing identity, timestamp, HTTP-attempted marker, structured failures and response truncation. Signing failures become visible bounded retries. Delivery inspection joins source event/registration/attempt evidence with related-resource navigation and a local historical signature check. Legacy missing snapshots remain explicitly unavailable; successful retries clear the current list diagnosis while preserving failed attempts.

| Verification | Result |
| --- | --- |
| Frontend suite | PASS — 146 tests across 37 files, including credential round trips with preserved request body, provider mismatch/clearing, legal actions/cancellation/payment authority, and both providers’ local snapshot verification. |
| Frontend typecheck, ESLint, production build | PASS |
| Go package tests, domain race tests, formatting/vet, golangci-lint | PASS — no static-check issues. |
| Full isolated race-enabled integration/worker suites | PASS — integration 96.481s; worker 38.462s. Covers migration, lifecycle, provider signatures/retries, cancellation retention and diagnostic snapshots. |
| Final delivery-list recovery regression | PASS — successful retry does not retain an obsolete failure diagnosis; earlier attempts remain inspectable. |
| OpenAPI and sqlc generation | PASS — control order/action/delivery contracts documented and bindings regenerated. |
| UI mechanical detector | PASS — no findings in changed context/lifecycle/diagnostic components. |
| Docker Compose / browser E2E | NOT RUN. Running services were not rebuilt or migrated. |

**Product & DX Review:** Domain policy projection, Backend/worker, migration, OpenAPI, Admin, Developer Portal, API Simulator context/handoff, examples/guides and tests were updated together. Public provider endpoints and signing formulas remain unchanged. New diagnostic snapshots require migration 015 and updated API/worker services; older records remain readable but cannot gain historical bodies retroactively. Header evidence covers application headers rather than transport-generated HTTP headers; response bodies explicitly report truncation. Historical verification proves integrity only, not freshness or downstream processing. Broad per-operation draft history, event catalog completion, inventory teaching and the complete persisted integration exercise remain separate open findings.

## Prior remediation — H4/H7 setup and asynchronous feedback (2026-09-08)

**H4 and H7 FIXED.** Manage shops is directly reachable next to the selector; a newly created shop is selected and opens its Dashboard even outside the first selector page. Actual configuration checks are separated from explicitly untracked signed-request and receiver-processing verification. Metrics state their global scope. Sample reset is separated from catalog management and names the shop, irreversible losses, retained warehouse/scenario definitions and required credential/receiver recovery.

Lists now distinguish shop selection from resource-specific empty states. Archive/revoke/retry and order/event actions show pending and recoverable errors. Resource lists and details have Refresh and last-successful-update timestamps, retain data on background failures and offer read retry. Pending/awaiting-creation delivery views perform at most twelve sequential checks five seconds apart, stop on completion/error/navigation, and restart manually. Single-order simulation opens the returned order; delivery summaries link to attempts. Health text makes only claims supported by the actual API read and separates maintenance state from health.

H3/H15 status above is carried forward from their existing remediation notes in the audit; their pre-existing changes were preserved. This remediation does not claim H5/H6/H8–H14 or the Nice to Have findings are fixed.

**Verification:** Full frontend suite passed (138 tests across 34 files with `bun run test --maxWorkers=4`); typecheck, lint and production build passed. New tests cover new-shop selection, created-order handoff, state-derived configuration, reset consequences/cancellation, pending/failed mutation recovery, refresh failure recovery and retained data, and polling limits/manual restart/slow requests/scope cleanup. A later verification rerun hit a five-second timeout in an existing portal credential-switching test; all five portal tests passed when rerun alone. The final shop-context guard also passed the 13 app journey tests. The UI mechanical detector returned no findings. Docker Compose and browser E2E were not run, per the requested boundary.

**Product & DX Review:** Admin/Control Plane, frontend tests, integration guidance, audit and implementation report were updated. Domain reset semantics, backend response IDs/setup counts/delivery states, and OpenAPI were checked as the source of truth and required no changes for H4/H7. Portal/Simulator entry actions and provider-specific first-request instructions were clarified in the runbook and repository guide; public endpoint contracts and request examples did not change. Credential transfer, complete integration exercises and deeper delivery diagnostics remain separately scoped findings.

## Prior remediation — H1/H2 explicit packages and fulfillment relationships (2026-09-05)

**H1 and H2 FIXED.** Both shipment simulators offer **Ship an existing package** and **Automatically package remaining items**, with synchronized JSON, package_id help/examples and preserved raw-body signing. Successful Shopee allocation offers a shipment handoff carrying returned order/package IDs and retaining credentials. The Admin allocation form selects eligible orders across pages and real order lines, displays allocation totals, prevents excess quantities through input limits plus backend validation, and exposes the returned package ID. Tokopedia's explicit package flow is documented through Admin because there is no public Tokopedia allocation endpoint.

Order Detail shows all packages and shipments, grouped allocation contents, per-line totals and the single warehouse origin. Each shipment's actions target that shipment. Package, shipment and warehouse detail navigation includes a return path and remounts resource state; package/shipment lists expose related order, package and warehouse links. Additive control-plane fields provide the previously missing relationship IDs/contents. Order-line reads, including provider details, now report allocated_quantity and remaining_quantity. Compatibility response fields remain available; the UI prefers the complete collection.

The reachable fulfillment guide, both provider detail examples, shipment metadata, generated Node example instructions, OpenAPI description/bindings, and integration/operations guides teach explicit versus automatic packaging, one warehouse per order, and creating all shipments before movement. No storage migration or lifecycle/allocation rule change was required.

| Verification | Result |
| --- | --- |
| Frontend tests | PASS — 115 tests across 31 files. Added provider shipment-mode/body checks, Shopee returned-package handoff, paginated allocation choices/limits, cross-resource navigation with two shipments, and parity for all optional/required ShipmentInput properties. |
| Frontend typecheck, lint, production build | PASS |
| Go formatting/static checks and package tests | PASS — make lint and go test ./... |
| Focused fulfillment Testcontainers regressions | PASS — explicit full-allocation shipment success for both providers, omission failure, linked control list/detail responses, partial allocation, and final-shipment order completion. |
| Full race-enabled integration suite | PASS — 54.958s |
| OpenAPI/sqlc generation | PASS — generated bindings updated; no database schema migration needed. |
| UI mechanical detector | PASS — no findings in the new fulfillment components and touched package/shipment views. |
| Compose / browser E2E | NOT RUN, per the requested boundary. Running services were not rebuilt. |

**Product & DX Review:** Domain rules were verified unchanged. Backend/control and provider read projections, OpenAPI, Developer Portal, Request Simulator, generated/request examples, Admin UI, tests and reports were updated together. H1/H2 are closed; H3–H15 and N1–N4 remain open. This does not claim closure of the broader lifecycle, pagination, diagnostics, credential-handoff or dialog accessibility findings.

## Prior remediation — C2–C4 webhook contracts, shop context, and history (2026-09-05)

**C2, C3, and C4 FIXED.** The remaining High Priority and Nice to Have findings remain open; these targeted fixes do not claim a complete redesign or end-to-end learning curriculum.

- **C2 — Provider-specific webhook verification:** Portal Webhooks now mounts the receiver guide and a runnable Node.js/Bun raw-body receiver, embedded from [the same example source](apps/marketplace/admin/examples/webhook-receiver.mjs). Admin, simulator, endpoint reference, repository guides and outbound OpenAPI explain that the shop profile selects delivery, regardless of registration route. Shopee uses its registration secret and X-Shopee headers; Tokopedia uses Authorization with the oldest ACTIVE app credential. Admin displays that credential's Client ID or missing-credential guidance; its Tokopedia form hides the ineffective registration-secret input. The API retains that legacy field for compatibility and explicitly labels it unused. Both metadata and worker use creation time then credential ID, including on retries; rotation/revocation and deduplication/freshness/consumer next steps are explained.
- **C3 — Scoped asynchronous state:** Requests carry session/route/shop/page scope and generation checks; stale results/errors cannot replace current data. Context switches hide old resources/actions immediately, with loading and retryable error states. A keyed workspace resets drafts, dialogs, notices, and scenario input for each shop/path while keeping navigation/header stable. Shop forms and detail dialogs show their shop identity. Already-submitted mutations may finish against the original shop, but their detached UI state cannot appear in the new context.
- **C4 — Retained delivery history:** [Migration 014](apps/marketplace/migrations/014_webhook_history.sql) adds `webhooks.deleted_at` and delivery status `CANCELLED`. Both deletion APIs retain registrations and their diagnostic history; pending deliveries/leases are cancelled in the same transaction. Active lists, setup counts, updates, fanout, and retries respect deletion. Row locks serialize fanout/retry with deletion. An in-flight HTTP attempt may finish and record its outcome without changing CANCELLED back to a deliverable state. Deliveries UI labels deleted registrations and removes Retry; API retry returns `409 WEBHOOK_DELETED`. Confirmation, OpenAPI, portal and repository guides document retention and replacement/replay. Reset to seed intentionally clears all shop history.

| Verification | Result |
| --- | --- |
| Frontend suite | PASS — 109 tests across 28 files, including late A → B results, failed B/retry/scenario saves, modal clearing, portal receiver reachability, signing-credential guidance and deletion errors. |
| Frontend typecheck / lint / production build | PASS |
| Runnable receiver contract tests | PASS — both providers, exact raw bytes, wrong keys, modified body, freshness, malformed/missing signatures, event identity. |
| Go package tests | PASS — `go test ./...`. |
| Race-enabled isolated Testcontainers suites | PASS — integration 83.284s; worker 41.106s. Includes actual outbound signature checks, Tokopedia creation/revocation/missing-credential rules, both delete APIs retaining attempts, and in-flight cancellation/fanout. |
| Final retention regression | PASS — rerun after moving retry authorization before its database transaction and tightening manual-fanout assertions. |
| Go static checks / generation | PASS — formatting and vet; OpenAPI/sqlc regenerated with repeat generation producing the same files. |
| UI mechanical detector | PASS — no findings in changed UI targets. |
| Docker Compose / browser E2E | NOT RUN, as requested. Existing running stack was not rebuilt or migrated. |

**Release boundary:** Migration 014 was applied in isolated test databases. Apply it before running the updated API and worker against an existing environment. Retention starts with this implementation; data already hard-deleted by the old behavior cannot be recovered. The example receiver uses a memory-only inbox for local learning and explicitly requires durable storage in the external application.

**Product & DX Review:** Domain/storage and backend delivery lifecycle, OpenAPI and generated bindings, Developer Portal, Request Simulator, runnable examples, Admin/Control Plane and relevant tests were reviewed and updated together. Order/inventory domain semantics are unchanged. Reports close only C2–C4 in this task; C1 remains fixed from the prior remediation.

## Prior remediation — C1 Shopee API order identifiers (2026-09-05)

**C1 FIXED.** Learners now use the returned order_id for Shopee detail and action paths; order_sn is explicitly labeled as the display order number.

- Corrected shared order-ID guidance and every Shopee order path helper, plus list/detail and cancellation/process/ready-to-ship response examples.
- Added **Use this order** to successful Shopee list results. Selecting a returned order opens the detail operation with its API ID prefilled while retaining credentials. Invalid/error responses and rows without order_id do not expose an action; there is no fallback to order_sn.
- Updated OpenAPI list/path descriptions and the repository integration guide with distinct illustrative API ID/display-number values and the simulator handoff.
- Added frontend semantic/example and rendered list-to-detail regressions. Extended the existing Shopee API contract test to fetch detail using a listed order_id, assert both identities match, and verify the display number produces 404/error_not_found.

| Verification | Result |
| --- | --- |
| Developer Portal tests | PASS — 35 tests across 9 files, including the new list-to-detail and invalid/missing-ID response cases. |
| Frontend typecheck, lint, production build | PASS |
| Focused Testcontainers Shopee public contract | PASS — real HTTP API with isolated PostgreSQL/Redis, 200 for listed order_id and 404 for order_sn. |
| OpenAPI generation | PASS — no generated binding drift from the description-only contract update. |
| UI mechanical detector | PASS — no findings in changed UI targets. |
| Docker Compose build / browser E2E | NOT RUN — outside this focused remediation. |

**Product & DX Review:** Domain and backend identifier semantics were confirmed and preserved. OpenAPI descriptions, Developer Portal reference/examples, Request Simulator list-to-detail navigation, repository integration guidance, frontend/backend contract tests, and reports were updated together. Admin resource screens and standalone catalogue clients need no changes for C1. Remaining audit findings are not marked implemented.

## Historical implementation result

**85 of 85 applicable requirements are COMPLETE.**

The original Marketplace and Order Lifecycle requirements remain complete. The update replaces the obsolete `CREATED → CONFIRMED → …` order flow with `UNPAID → PAID → PROCESSING → READY_TO_SHIP → SHIPPED → IN_DELIVERY → DELIVERED → COMPLETED`, keeping cancellation only before shipment. The latest update also separates Admin **Shipments** from Orders: creation remains exclusively in the public API, while the control plane lists, inspects, and advances existing fulfillment records. Verification is behavior-driven, not inferred from routes or source-file presence.

The Provider/Payment/Package P0 expansion is complete: provider-specific detail/UI, package workflow/Admin visibility, and worker integration coverage have been implemented and verified with Testcontainers. P1 is also complete: `SHOPEE_LIKE` changes the external integration boundary—not only stored state—through a separate API prefix, signing protocol, pagination/error/rate-limit contract, and webhook representation. P2 is complete: `TOKOPEDIA_LIKE` now models the combined Tokopedia & Shop / TikTok Shop contract with its own authenticated API, status vocabulary, webhook envelope, inventory safety, and return-to-sender behavior.

### Latest update — Frontend architecture and browser hardening

- Reduced `ControlPlaneApp.tsx` from 458 to 130 lines by moving session
  persistence, resource loading/filtering/pagination, and seed-reset behavior
  into focused hooks. Routing and shell chrome now live in dedicated modules,
  leaving the app component responsible for composition and modal state.
- Reduced the roughly 500-line `DetailPanel.tsx` to an 80-line dispatcher and
  separated Product, Order, Warehouse, Package, Shipment, and Delivery detail
  views. Product rows now open a first-class product detail view as well.
- Expanded focused component and app regression coverage to 82 frontend tests.
  Frontend aggregate coverage is now 86.52% statements, 80.28% branches,
  81.52% functions, and 89.28% lines; `DetailPanel.tsx` reaches 100% statement,
  function, and line coverage.
- Removed the duplicate frontend test execution from `make check`: Vitest now
  runs once through the coverage gate, while lint, typecheck, build, backend,
  security, and integration gates remain unchanged.
- Added a Playwright Chromium smoke test for the production Compose stack. It
  signs in, creates and selects a shop, resets it to 100 products/50 orders,
  creates a one-time credential, and sends a successful signed request through
  the Developer Portal. CI installs the matching browser, waits for healthy
  services, runs the journey, preserves diagnostics on failure, and tears the
  stack down.
- **Product & DX Review:** the `react-vite-expert` architecture guidance drove
  the feature-level hook/component boundaries and colocated behavior tests.
  Public API contracts and backend behavior are unchanged; maintainability,
  frontend coverage, local quality-gate speed, and browser-level confidence
  are improved together.

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
contains 82 passing tests and reaches 86.52% statement / 81.52% function
coverage. Every package selected by the core gate independently meets the 80%
statement threshold. The frontend tests execute once inside that gate, and the
separate `make browser-smoke` production-Compose journey also passes.
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
| `make check` after frontend architecture hardening | PASS — generated bindings clean; zero Go lint issues; 0 reachable vulnerabilities; race-enabled PostgreSQL/Redis Testcontainers; 82 frontend tests executed once with 86.52% statement / 81.52% function coverage; production build; all core packages independently meet 80% and aggregate coverage remains 93.8%. |
| `make browser-smoke` | PASS — production Compose images build, all five services become healthy, and Playwright Chromium completes login → shop creation/selection → seed reset → credential creation → signed Shopee catalogue request with `200 OK`. |

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

The earlier implementation review reported **no remaining gaps against the initial Marketplace Simulator PRD v0.2, Order Lifecycle & API Brief, or the requested P0/P1/P2 provider-profile expansion**. That historical scope is distinct from the **11 open Product & DX findings (C1–C4, H1–H10, and H15 retain their fixes)** recorded in the 2026-09-05 audit above.

Operational notes, not PRD gaps:

- The final audit reran the full Compose build/start and runtime smoke checks for Admin, API, worker, PostgreSQL, and Redis. Browser-driven E2E was not repeated because the affected UI behavior is covered by frontend typecheck/lint/unit/build checks and the backend behavior by isolated PostgreSQL/Redis Testcontainers.
- This is intentionally a local sandbox. Before any non-local use, replace the documented development credentials and encryption/session secrets.
- The Compose volume is persistent and now contains audit-created sample shops/orders. It was deliberately not deleted; a destructive volume reset was outside the audit scope.
- SAP, Shipping, Payment, and Identity simulators are future work explicitly outside this initial Marketplace-only scope.
- Historical brief exclusions were returns, refunds, disputes, partial shipments, and a separate Shipping Simulator. Later increments implemented partial package allocation, multiple shipments, and return-to-sender progression; see the current support clarification in the 2026-09-05 audit above. This does not claim a full returns/refunds/disputes workflow.
