# Marketplace Simulator — UI, usability, and Developer Experience audit

Audit date: 2026-09-05 · Baseline: commit 0dfdd77 · Audience: entry-level and junior integration developers.

**Current status (2026-09-10): C1–C4, H1–H20 and N1–N3 are implemented. N4 remains OPEN; N5–N7 remain proposed. C5 is excluded: retain local frontend origin 5173.** See the [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--n1n3-h18h20-2026-09-10). H20 checks Admin inventory saves; legacy control API calls omitting the optional version retain unconditional replacement semantics.

Read the [latest post-remediation re-audit and implementation plan](UI-REAUDIT-2026-09-09.md) for current recommendations, evidence and the updated ten-step journey. It supersedes the earlier audit snapshots below. Prior problem statements and status notes are historical, not a current backlog.

The [earlier audit snapshot](UI-AUDIT-2026-09-09.md) and the original findings below retain IDs and remediation history for traceability. Original problem statements do not mean fixed behavior is still missing.

## Scope, method, and limits

Reviewed the Admin shell, dashboard, resource lists/forms/details, Developer Portal, API Request Simulator, public/control routes, domain projections, worker delivery behavior, OpenAPI, repository integration/operations/webhook guides, and example clients against [the product context](/Users/enrico/Documents/engineering-challenge/CONTEXT.md).

The original audit was a **source-based heuristic audit and cognitive walkthrough**, not an observed user study or completed live integration. A connection check to the documented UI address, localhost:5173, failed. During the original audit, no services were started, no shops or credentials were created, and no Docker Compose or browser E2E was run. C1–C4 remediation subsequently used frontend regression tests and isolated Testcontainers as recorded below; the original walkthrough remains a source-based assessment. Runtime timing issues below are explicitly identified as source-supported risks, not reproduced browser failures. Visual preference, actual contrast, responsive clipping, and measured task completion times are not used as evidence.

Ran the existing endpoint contract, RequestSimulator, CodeExamples, and Guides tests: **18 tests passed across four files**. These validate selected metadata/component behavior, not the complete junior-developer journey. In particular, endpoint parity does not validate identifier semantics, all optional fields, real response completeness, or whether a tested guide is actually reachable.

Severity: **Critical** blocks a central documented workflow or risks misleading writes/data loss; **High Priority** causes significant discovery, diagnosis, or learning failure; **Nice to Have** improves efficiency after the core journey is reliable.

## What already works and should be preserved

- Navigation groups distinguish operations, integration, simulation, and developer resources. Orders, Products, Warehouses, Packages, Shipments, Webhooks, Webhook Deliveries, and Scenarios have explicit entries.
- The dashboard explains registration versus event creation versus asynchronous delivery. The dedicated webhook settings screen reinforces this distinction.
- All **25 public operations** have simulator entries: 5 shared, 11 Shopee-like, and 9 Tokopedia-like. A missing standalone public shipment-read operation is not a missing simulator route: the current public route design uses order detail for those reads.
- Reference pages have provider-grouped endpoint indexes, request/authentication tables, examples, operation-specific errors, and a simulator handoff. Provider request signing, mutation idempotency keys, status/body output, and quota headers already exist.
- API credentials have a dedicated one-time dialog with individual copy buttons. Secret persistence is deliberately limited. Warehouse detail already separates on-hand, reserved, and available quantities.
- Login, forms, seed reset, scenarios, and detail reads contain useful error/progress handling. Shipment actions already narrow the offered next states. Improvements should extend these patterns to the remaining paths.

## Critical

C1–C4 are fixed. **C5 is excluded by user decision:** keep the supported local frontend origin on 5173. The original 5174 observation remains historical evidence, not an active implementation request. Original C1–C4 statements below are audit history.

### C1 — Shopee instructions tell the learner to use the wrong order identifier

**Status: FIXED — 2026-09-05.** The original problem and recommendation below are retained as audit history.

**Implemented:** All Shopee order path help and list guidance now instruct the learner to use order_id; list/detail examples distinguish ord_example_01 from display number SIM-EXAMPLE-01. Mutation examples return order_id, matching the backend. Successful list results now offer **Use this order**, which opens the signed detail request with the returned order_id prefilled and the credential retained. Invalid/error responses or rows without an API ID offer no handoff and never fall back to order_sn. OpenAPI path descriptions and the repository integration guide explain the same rule. Backend route behavior is unchanged.

**Verified:** 35 Developer Portal tests passed, including a rendered list → select the second returned order → signed detail request regression and malformed/missing-ID response cases. The focused real-API TestContainerShopeeLikePublicContract passed with isolated PostgreSQL/Redis: a listed order_id returns matching detail with HTTP 200; the display order_sn returns HTTP 404/error_not_found. Frontend typecheck, lint, production build, and the UI mechanical detector passed. OpenAPI generation completed with no generated binding changes. No Compose build or browser E2E was run.

**Product & DX surfaces:** Portal reference, Request Simulator, OpenAPI descriptions, repository examples/guidance, frontend/backend contract tests, and reports updated together. Domain/backend behavior and Admin resource screens were reviewed and did not need changes. C2–C4, H1–H3, and H15 were subsequently fixed as recorded below. H11–H14 and N1–N4 remain open.

**Problem:** List guidance says to copy order_sn; the shared Order ID help accepts either order_id or order_sn. The example places an ord_… identifier in order_sn and omits order_id. Actual list responses contain order_id as the API identifier and order_sn as the human order number. Detail queries and mutations use the internal order ID. Following the documented copy/paste path therefore produces not-found or transition errors.

**Why it matters for juniors:** Their first successful GET orders becomes a failing detail/action call despite following instructions; they may incorrectly debug signing or permissions.

**Affected:** Shopee Orders reference, Request Simulator path help and examples, list-to-detail workflow.

**Recommendation:** Clearly label order_id as the value for every {id} path and order_sn as the display number. Show both in a realistic list/detail example; offer “Use this order” from a response. Add a contract exercise that takes the identifier recommended by the rendered docs into a real detail call.

**Evidence:** [endpoint guidance/examples](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/data/endpoints.ts:5), [backend list and ID lookup](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/provider_fulfillment.go:73).

### C2 — The documented webhook verification contract can be wrong for the selected shop

**Status: FIXED and verified on 2026-09-05.** The problem/evidence below records the original audit.

**Implemented:** Mounted the receiver guide from portal Webhooks navigation; added a runnable raw-body receiver shared by the portal and repository example. Admin, Request Simulator, reference metadata, integration/webhook guides, and outbound OpenAPI now distinguish registration authentication from shop-selected delivery. Shopee uses the registration secret and X-Shopee headers; Tokopedia uses Authorization and the oldest ACTIVE shop app credential. Admin shows the current signing Client ID (or missing-credential guidance), and the Tokopedia form hides its unused callback-secret field. Creation/revocation/rotation behavior, exact bytes, freshness checks, event identity, deduplication, and consumer next steps are explained. Credential-ID ordering resolves equal creation timestamps consistently in metadata and worker selection.

**Verification:** Portal navigation/form/metadata and runnable receiver tests pass. Actual Shopee/Tokopedia worker HTTP payloads are checked against raw-byte HMAC formulas; Tokopedia regression covers a distinct unused registration secret, newer credentials, revocation selecting the next key, and no active credential. OpenAPI bindings regenerated. Full validation is recorded in IMPLEMENTATION_REPORT.md.

**Problem:** The integration guide's “First integration” registers through the shared API and instructs consumers to use X-Marketplace-Event-Id. The worker selects delivery headers/envelopes from the **shop provider**, regardless of registration route: supported Shopee/Tokopedia shops receive provider headers. OpenAPI's outbound webhook definition describes only X-Marketplace headers. The portal renders registration API reference but never renders its existing Webhooks learning component. Tokopedia registration offers a callback “verification secret,” but its worker actually signs with the oldest active app credential's ID/secret; the callback secret is not the verification key. That credential selection rule is absent from the learner workflow.

**Why it matters for juniors:** A correct-looking registration can lead to permanent verification failures, wrong deduplication keys, and confusion after creating or revoking credentials.

**Affected:** Developer Portal Webhooks, Admin webhook form, shared/provider callback examples, OpenAPI outbound webhooks, repository first-integration guide.

**Recommendation:** Document registration authentication separately from delivery format, selected by shop profile. Surface exact raw-body verification examples, event identity, header names, and key ownership for each supported provider. Explain the current Tokopedia key-selection behavior and make the signing credential explicit in the product before changing it. Label or remove the ineffective Tokopedia callback-secret control according to the finalized contract. Connect the receiver guide to portal navigation and synchronize OpenAPI and examples.

**Evidence:** [worker signing/key selection](/Users/enrico/Documents/engineering-challenge/apps/marketplace/cmd/worker/main.go:230), [unmounted guide](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/sections/Guides.tsx:43), [portal section composition](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/DeveloperPortal.tsx:30), [first integration](/Users/enrico/Documents/engineering-challenge/docs/marketplace/integration-guide.md:56), [outbound OpenAPI](/Users/enrico/Documents/engineering-challenge/apps/marketplace/openapi/openapi.yaml:336).

### C3 — Shop changes can leave previous-shop data and actions under the new context

**Status: FIXED and verified on 2026-09-05.** The problem/evidence below records the original audit.

**Implemented:** Resource results/errors are scoped by session and request route (including shop/resource/page), with request generations rejecting late responses. Context changes immediately hide mismatched data and actions; loading and failed-load retry states are explicit. Forms, detail dialogs, scenario drafts, credential dialogs, and notices are reset through a shop/path keyed workspace; navigation/header remain stable. Actionable shop forms/details include shop name, profile, and ID. A session change remounts all authenticated state.

**Verification:** Regressions cover delayed A responses arriving after B, a failed B scenario load with no Save action, retrying B and saving B's own values, and closing old-shop forms/details. Existing session/navigation/form/seed flows pass. Already-submitted requests may finish against their original shop; they do not reopen a dialog or replace data in the newly selected context.

**Problem:** Resource fetching retains the previous data until completion and has no cancellation or response-generation guard. A slow response for shop A can replace shop B's data. Forms/details close on pathname changes only, not shop changes. Scenario inputs can consequently still contain A's values while Save targets B's shop ID; ID-addressed detail actions can still operate on A while the header shows B. This is a source-supported timing/context risk, not a reproduced authorization bypass.

**Why it matters for juniors:** The selected shop is their main assurance of isolation. Inconsistent context makes test results untrustworthy and can change another shop they legitimately own.

**Affected:** Shop selector, all resource screens, Scenarios, open forms and details.

**Recommendation:** Key loaded data and drafts by shop/resource/page; ignore stale responses, expose loading, and disable actions until their displayed resource context matches. Close or explicitly preserve a modal's original shop when switching; include shop identity inside actionable dialogs. Verify rapid A→B switching with delayed responses and a failed B request.

**Evidence:** [resource hook](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/hooks/useControlPlaneResources.ts:39), [pathname-only dialog reset](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/ControlPlaneApp.tsx:54), [scenario state/save target](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/Scenario.tsx:28).

### C4 — Webhook deletion promises to preserve history, but deletes it

**Status: FIXED and verified on 2026-09-05.** The problem/evidence below records the original audit.

**Implemented:** Migration 014 adds registration soft deletion and CANCELLED delivery status. Admin and shared DELETE retain registrations, deliveries, and attempts; pending deliveries are cancelled and leases cleared atomically. Active registration lists, dashboard setup counts, worker/manual fanout, and edits exclude deleted registrations. Retry rejects them with WEBHOOK_DELETED. Row locks serialize deletion with fanout/retry; an HTTP attempt already in flight may finish and record history without resurrecting a cancelled delivery. Deliveries UI labels retained history, removes Retry for deleted callbacks, and explains registering a replacement/replaying. UI confirmation, request reference, OpenAPI, and guides agree. Reset to seed remains explicitly destructive to all shop history.

**Verification:** Isolated HTTP/database tests cover both deletion APIs, wrong-shop protection, all prior delivery states, retained attempt bodies, registration list/edit exclusion, cancelled leases, retry rejection, and manual fanout exclusion. Worker tests cover in-flight cancellation, retained attempts, and no subsequent fanout/delivery. Migration was exercised in isolated databases, not applied to the existing Compose stack; already hard-deleted historical data cannot be recovered by this migration.

**Problem:** The confirmation states “Existing delivery history remains.” The handler deletes the webhook row; schema foreign keys cascade from webhook to deliveries and then to attempts. No later migration found changes those relationships.

**Why it matters for juniors:** They may delete a faulty registration expecting to keep the very evidence needed to debug it, then lose delivery and attempt history.

**Affected:** Webhooks → Delete; shared API deletion guidance and delivery history expectations.

**Recommendation:** Prefer disabling/soft deletion while retaining immutable diagnostic history, or explicitly disclose the actual loss before destructive deletion. Align UI, API guidance, storage semantics, and a retention regression test. Do not claim retention until implemented.

**Evidence:** [delete confirmation](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/WebhookSettings.tsx:22), [hard deletion](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/control_webhooks.go:91), [cascade relationships](/Users/enrico/Documents/engineering-challenge/apps/marketplace/migrations/001_initial.sql:102).

## High Priority

### H1 — The explicit-package workflow is missing a necessary simulator capability

**Status: FIXED and verified on 2026-09-05.** Original problem and source evidence below are retained as audit history.

**Implemented:** Both shipment simulators now expose package selection modes and package_id guidance/examples. Existing-package mode writes the selected ID into the signed body; automatic mode removes it and explains why it fails after full allocation. A successful Shopee allocation offers a direct shipment handoff that retains the returned order/package IDs and credentials. Tokopedia uses Admin allocation because it has no public allocation endpoint. The Admin form loads eligible READY_TO_SHIP orders across pagination, displays real line IDs and ordered/allocated/remaining quantities, and supports selecting multiple lines within their remaining limits. Allocation success surfaces the returned package ID. Provider detail examples, the reachable fulfillment guide, generated Node example instructions, OpenAPI and repository guides explain both paths and creating all shipments before movement.

**Verified:** Both simulator modes, rendered Shopee allocation-to-shipment handoff, later-page eligible-order selection, exhausted-line controls, and all ShipmentInput properties (including optional package_id) have regression coverage. Real HTTP/container tests for both providers allocate all quantities into two packages, reproduce omission failure, and successfully create shipments using each explicit ID. Full frontend and backend verification is recorded in IMPLEMENTATION_REPORT.md.

**Problem:** Both shipment endpoints accept optional package_id in OpenAPI and backend, but portal body-field metadata and default examples omit it. Omitting it creates a new package for remaining unallocated items. After a learner explicitly allocates all items, the default shipment request fails with “order has no remaining items to package.” Admin allocation asks for order/item IDs with no picker or source guidance; order detail does not display item IDs.

**Why it matters for juniors:** “Allocate package → create shipment” appears supported but fails, and the missing input must be discovered outside the normal workflow.

**Affected:** Packages allocation form, fulfillment reference, both shipment simulator operations.

**Recommendation:** Add package_id help and examples, distinguish “ship an existing package” from “automatically package remaining items,” and carry the returned package ID forward. Offer eligible order lines and remaining quantities in Admin allocation. Check optional OpenAPI fields in parity tests, not just fields already present in examples.

**Evidence:** [ShipmentInput](/Users/enrico/Documents/engineering-challenge/apps/marketplace/openapi/openapi.yaml:511), [package-selection behavior](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/provider_fulfillment.go:320), [simulator shipment fields](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/data/endpoints.ts:14), [allocation form](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/ControlForm.tsx:108).

### H2 — The UI does not explain or connect Order → Package → Shipment → Warehouse

**Status: FIXED and verified on 2026-09-05.** Original problem and source evidence below are retained as audit history.

**Implemented:** Order Detail uses the complete packages/shipments collections, groups shipments under their packages, displays each package's quantities and each order line's allocated/remaining amounts, and names the shared warehouse. Shipment actions apply to the displayed shipment. Package and shipment details link to related resources; package/shipment list rows link to the order and warehouse, and shipment rows also link to the package. Linked detail views replace the current view with a Back action and remount their data/action state. Control responses now supply missing package/warehouse identities, package contents, and allocation totals. Portal and repository guidance explain the one-warehouse-per-order rule and why one delivered package does not finish a multi-shipment order.

**Verified:** Rendered regression follows an order with two packages through Package → Shipment → Warehouse and back, and confirms the compatibility singleton cannot hide the second shipment. Both-provider HTTP/database tests check list/detail relationship IDs and complete allocation collections. The existing multiple-package delivery-completion and partial-allocation tests pass. No migration or fulfillment-domain rule changes were needed.

**Problem:** Order detail displays only the compatibility shipment, ignoring the backend shipments collection, and has no package section. Package detail shows an unlinked order ID and warehouse text. Shipment detail has an unlinked order number but no package/warehouse context; its control API also omits those links. Package list discards warehouse fields the backend supplies. All details are modal state, with no cross-resource navigation.

**Why it matters for juniors:** A multi-package order looks like a single shipment, and the learner cannot tell which items moved, which warehouse supplied them, or why another shipment remains outstanding.

**Affected:** Orders, Packages, Shipments, warehouse relationships, list/detail consistency.

**Recommendation:** Show all packages and shipments grouped under the order, allocated/remaining quantities, and linked warehouse names/codes. Expose package/warehouse identifiers in shipment control detail and link each related resource. Explain one warehouse per order in this simulator and multiple packages/shipments within that allocation; do not imply cross-warehouse order splitting exists.

**Evidence:** [order rendering](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/OrderDetail.tsx:126), [order API collection](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/control_fulfillment.go:385), [package detail](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/PackageDetail.tsx:3), [shipment detail](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/ShipmentDetail.tsx:4).

### H3 — Filtering, pagination, and response documentation still disagree with implementation

**Status: FIXED and verified on 2026-09-06.** Original problem and source evidence below are retained as audit history.

**Implemented:** Shopee `time_from`/`time_to` are now consistently labeled and described as inclusive `create_time` bounds, explicitly not `update_time` filters. Shared webhook list `page`/`limit` inputs, validation, page metadata, and delivery-contract metadata are represented in the simulator and OpenAPI; shared warehouses are explicitly documented and tested as a separate, complete unpaginated collection. Provider order-detail and shipment-create examples now show the real envelopes, nested collection locations, optional lifecycle fields, and all returned shipment relationship IDs. OpenAPI adds concrete schemas for those payloads. The lifecycle guide now distinguishes the single shipment returned by create from order detail's `shipment_list` and no longer promises a provider `fulfillment` object. Remediation also fixed a latent provider package projection query so newly allocated packages actually appear in `package_list`; `package_number` is the compatibility alias of `package_id`.

**Verified:** All 123 Admin unit/component tests pass; thirteen focused Developer Portal contract tests cover semantic filter wording, shared collection pagination differences, optional request fields, exact nested example keys, and operation-specific OpenAPI responses. Three focused real-API Testcontainers journeys prove creation-time filtering even when `update_time` is newer, shared webhook first/second pages and invalid-page rejection, complete unpaginated warehouse reads, and both providers' complete shipment-create and item/package/shipment detail collections. All backend tests, Admin lint/typecheck/build, OpenAPI generation, and generated bindings pass. No browser E2E was needed for this contract/documentation remediation.

**Problem:** Shopee time_from/time_to are labeled “Updated” and described as updated-at filters, while SQL filters created_at. Shared webhook lists are described as complete/unpaginated, but the handler applies page/limit with a default of 20; neither the simulator nor public OpenAPI operation advertises those query inputs. Provider detail examples omit the meaningful line/package/shipment structures. The repository lifecycle guide claims shipment responses expose full collections, whereas create returns one shipment and detail exposes shipment_list. It also promises warehouse allocation information more broadly than the provider detail projections return.

**Why it matters for juniors:** Incremental synchronization can miss changed orders, pagination silently omits registrations, and learners cannot write correct response parsing from examples.

**Affected:** Orders/Webhooks reference, simulator queries, repository integration guide, OpenAPI and parity tests.

**Recommendation:** Resolve each contract explicitly: created-time labeling versus implementing update-time filtering; document/support actual shared webhook pagination; publish realistic nested examples with exact field names and collection locations. Shared warehouse lists should be assessed independently rather than assuming all shared lists behave alike. Test semantic filters, additional optional fields, and real response shapes.

**Evidence:** [Shopee filtering](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/provider_fulfillment.go:41), [shared webhook pagination](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/provider_webhooks.go:159), [endpoint examples](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/data/endpoints.ts:148), [shipment create response](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/provider_fulfillment.go:275), [current parity checks](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/data/endpoints.contract.test.ts:142).

### H4 — The setup runbook obscures shop management and the consequences of seed reset

**Status: FIXED (2026-09-08).** Manage shops is reachable beside Current shop. Creating a shop selects the returned shop, including one outside the selector's first page, and opens its Dashboard. Four configuration steps now reflect actual selected-shop state. Signed-request and receiver-processing checks are explicitly separate, untracked learner verification; an active or seeded credential is not presented as proof of saved secrets. Global metrics and selected-shop configuration have distinct scope labels. Catalog management preserves data; optional sample reset is separately labeled and confirms the shop name/ID, permanent deletion consequences, fixture creation, retained warehouses/scenarios, and required credential/receiver setup afterward. The integration guide matches this behavior.

**Verification:** Component journeys cover new-shop selection/navigation, state-derived checks, unverified-integration wording, reset consequences and cancellation, and maintenance uncertainty/retry. Frontend typecheck, lint, build and full test suite passed. No public API/domain change or release E2E was needed.

**Original audit evidence follows:**

**Problem:** Shops has a route but no primary navigation entry; with an existing selection, “Create or choose” only leads through Dashboard → Open shops. Creating another shop does not select it because refresh preserves the previous ID. Steps 2–5 never become complete, while the separate readiness panel may say ready. “Seed data” performs a destructive reset, but confirmation only says “Reset this shop to its seed data?” and does not name deleted credentials, registrations/history, or orders. Dashboard counts are across accessible shops while readiness is selected-shop scoped, without labels explaining the difference.

**Why it matters for juniors:** They can configure the previous shop, repeatedly reset completed setup, or assume all metrics describe the selected marketplace.

**Affected:** Dashboard, Shops discovery/creation, seed controls, setup readiness.

**Recommendation:** Make shop management directly reachable beside the selector; select or offer to open the newly created shop. Derive runbook progress from actual state and include “test first signed request.” Separate sample-data setup from destructive reset language, list consequences and shop name before reset, and label global versus selected-shop metrics. Readiness should distinguish an existing credential from one the learner actually saved/tested.

**Evidence:** [navigation](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/app/navigation.ts:60), [runbook](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/DashboardPages.tsx:38), [reset confirmation](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/hooks/useSeedShop.ts:26), [dashboard scopes](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/control_shops.go:22), [reset effects](/Users/enrico/Documents/engineering-challenge/docs/marketplace/operations-guide.md:33).

### H5 — Provider/shop/credential context is lost at the portal boundary

**Status: FIXED (2026-09-09).** The provider badge is visible throughout the console, and the portal displays the current shop/name/ID. The initial simulator and quick-start requests follow the shop provider. Shared resources explicitly use that shop’s credential with shared signing. The authenticated, shop-scoped portal remains mounted across console visits, preserving its current request and in-memory credential. Credential creation names the shop/profile and offers Use in simulator; Credentials also has a return action. Known provider mismatches block sends, manually pasted ownership is labeled unverified, and lost/seeded-secret recovery is explained. Secret values never enter URL/local/session storage; clearing, shop changes, reset, sign-out and reload erase them. Broader per-operation draft history remains H13.

**Verification:** Component journeys exercise Tokopedia provider defaults, edited request → Credentials → one-time handoff → same edited request, matching identity/access token, cross-provider blocking, shared requests, persistence across console visits, explicit clear, and clearing on shop switch. Full frontend checks passed.

**Original audit evidence follows:**

**Problem:** Only Orders displays a provider badge. The portal receives API base URL and navigation callbacks, but no selected shop/provider. Quick-start actions always open Shopee; the direct simulator starts at shared warehouses. Credential inputs use one unassociated set of values across contracts. “Open Credentials” leaves/unmounts the portal, losing pasted values and request state; credential creation has no return-to-request handoff.

**Why it matters for juniors:** A Tokopedia learner is directed to Shopee calls and must infer whether an auth failure comes from the wrong shop, provider, key, or signature. Repeated copy/paste is especially difficult with one-time values.

**Affected:** Header, Credentials, Developer Portal quick start and simulator.

**Recommendation:** Carry visible shop name/profile and non-secret credential identity into the portal; choose the matching initial endpoint and label shared resources as usable with that shop's credential. Provide an explicit in-memory “Use in simulator” handoff and return destination. Warn about known mismatches without persisting secrets to local storage or URLs. Explain recovery when one-time values were lost.

**Evidence:** [portal route props](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/ControlPlaneRoutes.tsx:91), [portal state/defaults](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/DeveloperPortal.tsx:30), [credential panel](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/components/CredentialPanel.tsx:14), [credential dialog](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/CredentialCreatedDialog.tsx:68).

### H6 — Lifecycle controls teach trial-and-error and mix distinct actors/statuses

**Status: FIXED (2026-09-09).** Order detail consumes available_actions and cancellation_options derived from the canonical domain policy, displays authoritative operations.payment_status once, and labels canonical versus provider API status. Console controls separate payment/customer simulation from merchant API work and carrier simulation. Only eligible order actions are offered; missing eligibility fails closed with refresh guidance. Merchant API paths, Pack/Process and Handover/Ready mappings and state prerequisites are explained. Cancellation shows and submits the selected CUSTOMER/SELLER actor and valid reason; legacy empty control requests retain their previous seller default. SYSTEM cancellation stays in payment/deadline simulation. The portal lifecycle guide and repository documentation include many-to-one IN_TRANSIT/CANCEL mappings and canonical webhook vocabulary.

**Verification:** Domain table tests cover both providers and all lifecycle states, actor/reason policy and expired payment. API integration verifies illegal cancellation rejection, explicit actor audit, terminal actions and provider mappings. UI tests cover legal merchant controls, explicit cancellation fields and FAILED/EXPIRED payment without misleading compatibility labels. Existing lifecycle/deadline/fulfillment regressions pass.

**Original audit evidence follows:**

**Problem:** Order detail always offers Pay, Fail payment, Process, Ready to ship, Complete, and Cancel regardless of state. Cancel silently selects seller/OUT_OF_STOCK in the backend. Merchant API actions and simulator actions have no clear separation. The order uses canonical statuses while Tokopedia API reads use mapped states and webhook data retains canonical payload values. Payment is displayed twice: the compatibility payment.status derives UNPAID/PAID from paid_at, while operations.payment_status can be FAILED or EXPIRED.

**Why it matters for juniors:** Invalid actions look equally appropriate, “Pack” appears unrelated to “Process,” and failed/expired payment can also be labeled UNPAID without explaining the different meanings.

**Affected:** Order detail, provider lifecycle reference, webhook consumers.

**Recommendation:** Show a lifecycle with legal next actions and prerequisites; distinguish customer/payment/carrier simulation from merchant API work. Explain cancellation actor/reason before submission. Use authoritative payment status, separate it from order status, and show canonical/provider mappings including IN_TRANSIT and CANCEL many-to-one mappings. Make webhook payload vocabulary explicit.

**Evidence:** [order controls and payment display](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/OrderDetail.tsx:5), [cancel policy/defaults](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/lifecycle_handlers.go:87), [compatibility payment projection](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/lifecycle_handlers.go:470), [Tokopedia mappings](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/tokopedia/contract.go:55).

### H7 — Loading, empty, asynchronous, and failed-action states are not reliable enough

**Status: FIXED (2026-09-08).** Resource pages distinguish no selected shop from resource-specific empty states and offer setup/next actions. Archive, revoke, retry, order and event actions expose pending/error feedback. Initial list/detail failures can be retried; background refresh preserves last successful data with an error and timestamp. Lists and details expose Refresh. Delivery lists and order/delivery details use at most twelve sequential five-second checks while pending or awaiting delivery creation, stop on terminal state/error/navigation, and can be restarted manually. Empty delivery text explains asynchronous creation without inventing a missing registration. Dashboard reports only its actual control-API read; maintenance settings explicitly do not claim API health. Single-order simulation opens the returned order and its delivery summary links to attempts.

**Verification:** Regression coverage includes no-shop actions, all three formerly unhandled mutations (pending, failure and retry), created-order navigation, initial/detail/list refresh recovery, polling bounds/manual restart, slow requests, terminal states and scope/unmount cleanup. Frontend typecheck, lint, production build and full tests passed. No Docker Compose/browser E2E was run for this remediation.

**Original audit evidence follows:**

**Problem:** Resource lists have no explicit loading state and reuse “Choose a shop or create a record,” including Shipments and Deliveries where that instruction is not actionable. Creation buttons remain active without a shop. Archive, revoke, retry, webhook toggle, and webhook delete await calls without catches or pending guards. Lists and order deliveries do not poll or expose a Refresh action, so worker changes require navigation/reload. An empty order-delivery list asserts no registration existed even when fan-out may simply be pending. “Simulator online” is unconditional. Creating an order discards its returned ID when the form closes, with no direct way to open the created record.

**Why it matters for juniors:** A normal delay resembles failed setup; a rejected archive or webhook toggle can look inert. Learners cannot distinguish waiting, missing prerequisites, and failure.

**Affected:** Dashboard status, all resource lists, row actions, order delivery timeline.

**Recommendation:** Use distinct loading/no-shop/empty/error states with contextual next actions and retry. Catch action failures and show pending state. Provide refresh and bounded polling for pending deliveries with last-updated time. Use neutral “No deliveries yet” until a verified reason is available, derive health claims from real checks, and offer “Open created order” after simulation. Reuse the existing seed/scenario error patterns.

**Evidence:** [resource actions and empty state](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/ResourcePage.tsx:66), [webhook action handlers](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/WebhookSettings.tsx:20), [order delivery explanation](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/OrderDetail.tsx:189), [resource refresh triggers](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/hooks/useControlPlaneResources.ts:66).

### H8 — Delivery diagnostics omit the evidence needed to debug signatures and failures

**Status: FIXED (2026-09-09).** Migration 015 adds append-only per-attempt body/destination/provider/signing-identity/start-time/HTTP-attempted/failure-code/failure-reason/truncation snapshots. The worker stores the exact provider-transformed signed string and application headers; response bodies are capped at 4096 bytes with explicit truncation. Signing and forced failures are recorded distinctly without claiming HTTP was sent, and signing failures follow the same bounded attempt/retry policy. Delivery API/UI expose source event, current registration context, historical attempt evidence, related resource links and actionable failure recovery. Order events display canonical payloads separately. The local historical HMAC exercise uses the snapshot key identity/raw bytes without transmitting or persisting the supplied secret. Old attempts explicitly lack snapshots; current settings are never used to invent old evidence. A successful retry clears the list’s failure diagnosis while retaining prior attempts.

**Verification:** Race-enabled Testcontainers checks compare the stored bodies with actual receiver bytes and verify both providers’ signatures, preserve old destinations after changes/retries, record network/forced/missing-key failures, mark response truncation, retain legacy null fields, enforce shop permissions, and verify retry recovery. UI tests verify local signatures/mismatches, key clearing, resource navigation and legacy evidence gaps. OpenAPI and sqlc bindings regenerated; full frontend/backend checks passed.

**Original audit evidence follows:**

**Problem:** Delivery detail displays response status/body and duration but not outbound headers/body, event payload, endpoint context, or correlation links. The worker stores request and response headers, but the detail API omits them. It does not persist the provider-transformed request body; network/forced failure text is logged but not saved in attempt response_body, so the list's derived failure_reason can be blank. Order event payloads are returned by the API but not rendered, and order delivery rows cannot open attempts directly.

**Why it matters for juniors:** They cannot compare what was actually sent with their receiver, verify the signature, or distinguish a forced failure from a refused connection without backend logs.

**Affected:** Order events, Webhook Deliveries list/detail, worker attempt records.

**Recommendation:** Expose an immutable attempt snapshot with actual outbound payload, headers, timestamp, response, duration, structured failure reason, and stable event/delivery IDs. Link event → registration → delivery → attempt. Offer a safe signature-verification exercise using the appropriate key; do not reconstruct an old signed body with a new timestamp and label it exact.

**Evidence:** [worker attempt persistence](/Users/enrico/Documents/engineering-challenge/apps/marketplace/cmd/worker/main.go:307), [delivery detail API](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/control_webhooks.go:165), [delivery view](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/DeliveryDetail.tsx:3), [event payload API](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/lifecycle_handlers.go:477).

### H9 — Events is a navigation alias, and newer domain events are hidden

**Status: FIXED — 2026-09-09.** Original audit statements below are retained for traceability.

**Implemented:** Event Logs has its own active `/events` route and shop-scoped feed with server-side resource type, exact resource ID, and event type filters applied before pagination. It exposes payloads, related resources, matching deliveries, and replay/duplicate/delay controls with refresh, loading, empty, and error feedback. Product and shipment details have event trails; order events and delivery links include related shipment aggregates. Archived product history remains in the feed. All 18 accepted canonical events are selectable in Admin and documented in both shared OpenAPI subscription enums. A shared UI catalog teaches triggers and Shopee/Tokopedia category mappings in the form, portal, and webhook simulator. Shopee logistics subscriptions now include shipment failure/return events; Tokopedia order subscriptions include payment failure/expiry and seller deadline expiry. Existing saved selections are preserved; reconfigure provider topics or edit Admin subscriptions to include these additions.

**Verified:** Frontend regressions cover catalog/backend/OpenAPI parity, event filters and paging, delayed previous-shop responses, replay and resource/delivery navigation, and failure/return selections. Isolated race-enabled integration checks cover filters before pagination, archived product history, related shipment events/deliveries, authorization, and every provider category’s saved canonical subscriptions. Worker regression suite passes. See the implementation report for full verification results and the transient Docker startup failure/retry. No Compose or browser E2E was run.

**Product & DX surfaces:** Backend queries/provider adapters, OpenAPI/generated bindings, Admin, portal, simulator guidance, repository examples/guides, and tests updated. Canonical domain events and signing formulas are unchanged. Normal shipment milestones remain order events; the shipment detail explicitly links to that combined trail. Scenario configuration alone does not create a domain event.

**Problem:** “Event Logs” links to Orders, with the explanation only in a title tooltip and no active state. Product events have no equivalent UI trail. The order event query selects the order aggregate only, excluding shipment-aggregate failure/return events. Admin webhook checkboxes omit order.payment_failed, order.payment_expired, order.sla_expired, and shipment.delivery_failed/returning/returned even though the backend accepts them. OpenAPI's shared subscription enum also omits the shipment events.

**Why it matters for juniors:** Scenarios and RTS behavior appear to emit nothing, and they cannot discover or select important integration failures through the product.

**Affected:** Navigation, Events, product/shipment detail, webhook event selector, OpenAPI.

**Recommendation:** Provide a real shop event view or clearly named, direct event destinations with resource filters. Include related shipment events on orders and expose product trails. Align accepted event catalogs across backend, OpenAPI, portal, and form options, with canonical-to-provider category mapping and trigger guidance.

**Evidence:** [Event Logs alias](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/app/navigation.ts:89), [form event list](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/ControlForm.tsx:17), [supported backend events](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/webhooks/events.go:4), [aggregate-only event query](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/lifecycle_handlers.go:477), [OpenAPI enum](/Users/enrico/Documents/engineering-challenge/apps/marketplace/openapi/openapi.yaml:327).

### H10 — Inventory exists, but its location and allocation rules are hard to learn

**Status: FIXED — 2026-09-09.** Original audit statements below are retained for traceability.

**Implemented:** Navigation names **Warehouses & Inventory**, and Products offers a direct inventory-management action. Fixed product columns keep status and available stock visible. Product detail shows on-hand/reserved/available quantities, warehouse status and priority, including inactive and unassigned warehouses, with links to each inventory editor. Product edit explains where stock moved; warehouse/order forms explain highest-priority allocation and the single-warehouse requirement. The inventory editor states that on-hand replaces the physical count and cannot fall below reserved stock. Portal and warehouse simulator guidance include reserve/release/ship effects, tie-breaking, a worked multi-line allocation example, and the distinction between aggregate stock and eligible warehouse stock.

**Verified:** Frontend tests check fixed stock/status columns and navigation from the product ledger to its warehouse editor. Isolated integration tests verify ledger projections before and after reservation/shipment, empty inactive warehouses, and shop authorization. Public warehouse response examples were checked against existing fields; public APIs remain read-only. Typecheck, lint, production build, and the UI mechanical detector pass. No Compose or browser E2E was run.

**Product & DX surfaces:** Admin, additive product detail backend/OpenAPI projection, portal, simulator guidance, integration guide/examples, and tests updated together. Domain allocation and reservation semantics remain unchanged; the guide explains that return-to-sender completion does not automatically restock physical inventory.

**Problem:** There is no Inventory navigation cue; existing stock adjustment is under Warehouses → View inventory. Product detail shows only “Stock,” with no warehouse breakdown or link; Edit product offers no explanation of where stock editing moved. The generic product table takes seven scalar fields; with current Go map JSON ordering, stock/status fall beyond those fields. Warehouse forms do not explain that larger priority wins or that one active warehouse must satisfy all order lines. Aggregate stock alone can therefore appear sufficient while order allocation fails.

**Why it matters for juniors:** They may treat stock as a single editable product number and not understand reservations, physical stock, or why an order is rejected.

**Affected:** Products list/detail/edit, Warehouses list/detail, order creation, concepts documentation.

**Recommendation:** Label the inventory entry point explicitly, show available stock/status in product lists, and link product inventory to warehouses. Explain available = on hand − reserved, reserve/release/ship effects, highest-priority selection, and the single-warehouse constraint with a worked example. Clarify that entering on-hand replaces the physical count, rather than adding a delta.

**Evidence:** [column truncation](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/ResourcePage.tsx:229), [product detail](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/ProductDetail.tsx:3), [warehouse inventory editor](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/details/WarehouseDetail.tsx:104), [allocation implementation](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/inventory/reservation.go:60).

### H11 — The portal stops short of teaching a complete external application workflow

**Status: IMPLEMENTED — 2026-09-09.** Dedicated provider-specific durable consumer lessons and downloadable SQLite-backed receiver/worker now cover acceptance, persistence, pagination, stable mutation keys and recovery. See the [runnable lesson](../../apps/marketplace/admin/examples/durable-consumer-README.md). See the [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--h11h14-h16-h17-2026-09-09). The original problem below is retained as audit history.

**Pre-fix reassessment (historical):** A runnable raw-body receiver, lifecycle guide, inventory worked example and delivery diagnostics now exist. The remaining gap is the complete provider-specific fresh-order → durable inbox → state retrieval/persistence/reconciliation exercise. The original statement below that there is no runnable receiver is obsolete; use [the current H11 finding](/Users/enrico/Documents/engineering-challenge/specs/general/UI-AUDIT-2026-09-09.md#h11--the-learning-journey-still-ends-before-durable-external-application-processing).

**Problem:** Quick start compresses fulfillment into “process/pack … package or shipment,” while the portal Concepts section contains only request signing. Richer lifecycle, warehouse, retry, and ordering material exists in repository guides but is not linked or rendered in the portal. There is no runnable receiver example or complete “what my application does next” exercise. Seeded historical orders are COMPLETED, so they are unsuitable for the advertised seller actions without creating a fresh order.

**Why it matters for juniors:** Reference coverage does not tell them how to construct an OMS flow, keep local state correct, or recover after duplicates, out-of-order notifications, timeouts, expiry, and partial fulfillment.

**Affected:** Start here, Concepts, Webhooks, Errors & limits, repository examples.

**Recommendation:** Publish two provider-specific guided journeys using a fresh UNPAID order. Teach setup → verification → GET/search → merchant transitions → package/shipment → signed receiver → delivery diagnosis. Show durable deduplication, persistence before acknowledgement, retrieving current order state, mapping external IDs, idempotent mutation retry, and next-page loops. Link directly to relevant console/simulator steps. Explain container-to-host callback addressing and how to run a local receiver. Preserve the distinction between simulation controls and what the external app should call.

**Evidence:** [portal sections](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/DeveloperPortal.tsx:49), [quick start](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/sections/Guides.tsx:9), [existing repository guidance](/Users/enrico/Documents/engineering-challenge/docs/marketplace/integration-guide.md:139), [seed semantics](/Users/enrico/Documents/engineering-challenge/docs/marketplace/operations-guide.md:23).

### H12 — The request shown and generated code are not the exact request sent

**Status: IMPLEMENTED — 2026-09-09.** Prepared request inputs now drive edited Node export and outgoing request evidence. Credential secrets use environment placeholders/redaction; response replay/retry/quota headers, HTTP/API errors and raw body evidence are visible. See the [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--h11h14-h16-h17-2026-09-09). The original problem below is retained as audit history.

**Problem:** The URL preview excludes dynamically added Tokopedia signing query parameters and no full outgoing header snapshot is shown. The “Run this exact request” Node example uses endpoint defaults, ignores edited path/body/query values, and does not add endpoint query defaults at all. Response inspection whitelists quota headers, hiding X-Request-ID, Retry-After, and Idempotent-Replayed even though they matter for diagnosis. HTTP failures render as a generic completed response without tailored recovery guidance.

**Why it matters for juniors:** A request that worked in the simulator cannot be faithfully copied into their application, and the learner cannot see why a replay or retry behaves differently.

**Affected:** Request Simulator preview, Node code examples, response output.

**Recommendation:** Generate a prepared-request snapshot from the same edited state used for sending, including method, final URL, actual header names, and body. Export a reproducible script using environment-variable placeholders for secrets. Display relevant response headers and distinguish HTTP/API errors from transport failures with links to recovery guidance. Retain the exact signing-input view with appropriate handling of its embedded Tokopedia secret.

**Evidence:** [request preparation/output](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/components/RequestSimulator.tsx:95), [header whitelist](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/components/RequestSimulator.tsx:24), [default-only code generation](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/lib/nodeExample.ts:5), [exact-request claim](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/components/CodeExamples.tsx:12).

### H13 — Simulator inputs and defaults do not support a dependable first request or retry exercise

**Status: IMPLEMENTED — 2026-09-09.** Useful unfiltered defaults, receiver callback addresses, in-memory operation drafts, original-request retries/new operations, timeout/cancel/reset isolation, credential guards and provider result/page handoffs are implemented. See the [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--h11h14-h16-h17-2026-09-09). The original problem below is retained as audit history.

**Problem:** Body field requirements are available only in Reference, while Try uses a raw JSON textarea and syntax-only validation. Tokopedia order search defaults to ON_HOLD, which excludes both freshly simulated UNPAID orders and COMPLETED seed orders; product search defaults to “mug,” with no guarantee of a matching generated product. Callback examples use example.com destinations rather than a working learner receiver. Endpoint switching remounts the simulator and drops IDs, edits, response, and idempotency keys. Reset generates a new key, yet there is no separate new-operation action. Timeout scenarios have no client timeout/cancel control or elapsed time.

**Why it matters for juniors:** Empty results look like broken seeding; valid JSON still fails schema/domain checks; returning to an operation can accidentally become a new mutation rather than a retry.

**Affected:** Operation picker, request inputs, defaults, idempotency and timeout exercises.

**Recommendation:** Show required/optional field help inline and enum/range constraints while retaining raw JSON. Start searches without restrictive filters or offer explicit fixture presets. Mark callback URLs as replacements and link receiver setup. Preserve per-operation drafts and retry keys in memory; separate “Retry same operation” from “Start new operation.” Add elapsed time, cancellation, and configurable client timeout with explanation that cancellation does not prove a mutation was undone.

**Evidence:** [input rendering/reset](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/components/RequestSimulator.tsx:61), [defaults](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/data/endpoints.ts:227), [keyed simulator](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/DeveloperPortal.tsx:27), [completed seed orders](/Users/enrico/Documents/engineering-challenge/docs/marketplace/operations-guide.md:23).

### H14 — Pagination makes existing shops, webhooks, and picker choices disappear

**Status: IMPLEMENTED — 2026-09-09.** Shop/picker collections exhaust pagination, choices are filterable, selected shop/provider survive navigation/reload, Webhooks has true totals and paging, and the product query cap is removed. Local tests pass; the approved SQLc regeneration succeeded and produced identical bindings. The earlier approval block is resolved. See the [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--h11h14-h16-h17-2026-09-09). The original problem below is retained as audit history.

**Problem:** The global shop picker fetches only the default first 20 shops. Choosing a later shop through the paged Shops screen does not add it to the picker's options/provider metadata. Webhooks uses the same paginated backend list but has no pagination UI and is absent from pageable pages, so registrations after the first 20 are inaccessible there. Product and warehouse form pickers fetch only the first 100 rows without a continuation/search control.

**Why it matters for juniors:** Existing resources appear missing or unselected, especially in shared classrooms and after repeated exercises. This also prevents reliable management of old callbacks.

**Affected:** Global shop selector, Webhooks, custom/mass orders, warehouse inventory and product-creation pickers.

**Recommendation:** Use paged/searchable selectors, load selected records independently, and expose webhook pagination. Respect pagination metadata everywhere a collection feeds UI. Verify 21 shops, 21 webhooks, and 101 picker records; do not solve this only by increasing a hardcoded limit.

**Evidence:** [shop fetch](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/hooks/useControlPlaneResources.ts:39), [webhook list UI](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/WebhookSettings.tsx:20), [backend pagination defaults](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/provider_webhooks.go:185), [form picker limits](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/ControlForm.tsx:149).

### H15 — Custom dialogs do not provide a complete keyboard interaction model

**Status: FIXED and verified on 2026-09-06.** The original problem and recommendation below are retained as audit history.

**Implemented:** Added a shared portaled dialog primitive used by create/edit forms, resource details, and the one-time credential reveal. It supplies dialog naming and modal semantics, initial heading focus, forward and reverse Tab containment, topmost-dialog Escape handling, background inertness, and focus restoration. Explicit opener references preserve the return target across the create-form → credential-dialog handoff, while resource refreshes keep the initiating control mounted. Removed acknowledgement-button autofocus and added contextual accessible names to repeated product and warehouse selectors and removal actions. Detail drill-down moves focus to each newly opened resource heading.

**Verified:** Focused regressions cover initial focus, both Tab wrap directions, document-level Escape handling, inert-state restoration, chained-dialog return focus, form/detail dismissal, credential copy state, and detail drill-down focus. The complete frontend suite passes (120 tests), together with TypeScript and lint. The rebuilt Compose Admin UI passed the Chromium integration journey for keyboard-only form dismissal, credential creation and copying, Escape dismissal, background inertness, and return focus to **New credential**. Manual testing with a production screen reader remains outstanding.

**Problem:** Forms use a styled backdrop/form without dialog semantics; detail and credential panels have dialog roles but no implemented focus trap, Escape handling, or focus restoration. The credential dialog autofocuses its final acknowledgement button. Styling a div as a modal does not make the background inert or manage focus. Some dynamic product/warehouse selectors also lack explicit accessible names.

**Why it matters for juniors:** Keyboard and assistive-technology users can lose their place or move into background controls while configuring credentials or fulfillment. This is an interaction issue, not a visual-style preference.

**Affected:** Create/edit forms, resource details, one-time credential dialog.

**Recommendation:** Use a shared accessible dialog primitive with initial focus, contained Tab order, Escape policy, background inertness, and return focus. Give dynamic selectors contextual labels. Verify keyboard-only creation, one-time-value copying, dismissal, and return to the initiating action. Actual screen-reader/browser behavior remains to be checked during remediation.

**Evidence:** [form markup](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/ControlForm.tsx:352), [detail modal](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/DetailPanel.tsx:49), [credential modal](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/CredentialCreatedDialog.tsx:84).

### H16 — Generated Shopee webhook secrets lack a dependable handoff

**Status: IMPLEMENTED — 2026-09-09.** Generated Shopee webhook secrets now use a copy/acknowledgement dialog with protected dismissal, shop/endpoint context and provider-correct receiver/replacement guidance. Tokopedia keeps app-credential verification. See the [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--h11h14-h16-h17-2026-09-09). The original problem below is retained as audit history.

**Original finding — recorded 2026-09-09 (before remediation).** The generated verification secret appears only in a dismissible workspace notification. Unlike API credentials, it has no dedicated copy/acknowledgement flow and can be lost when navigating to receiver setup. Juniors must then replace the secret and update the receiver. Add a provider-aware one-time-value handoff with copy and recovery guidance; do not use the registration secret for Tokopedia verification. See [full evidence and recommendation](/Users/enrico/Documents/engineering-challenge/specs/general/UI-AUDIT-2026-09-09.md#h16--a-generated-shopee-webhook-secret-is-easy-to-lose-during-receiver-setup).

### H17 — Refreshed warehouse data can retain a stale saved input

**Status: IMPLEMENTED — 2026-09-09.** Saved drafts are cleared, clean inputs follow refresh, unsaved stock conflicts are explicit and require review, and pending Save/Add actions prevent duplicate submissions. See the [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--h11h14-h16-h17-2026-09-09). The original problem below is retained as audit history.

**Original finding — recorded 2026-09-09 (before remediation).** Saving inventory retains the submitted count as a draft; later refresh can show a newer on-hand table value while the input still uses the old saved value. A second Save can reintroduce shipped units. Clear acknowledged drafts, distinguish unsaved edits/conflicts, and guard pending row saves. This is a source-supported risk, not a newly reproduced concurrency test. See [full evidence and recommendation](/Users/enrico/Documents/engineering-challenge/specs/general/UI-AUDIT-2026-09-09.md#h17--the-inventory-editor-can-preserve-a-stale-saved-count-after-refresh).

## Nice to Have

### N1 — Lists prioritize transport fields over scanning and comparison

**Problem:** Generic scalar-key selection controls column order; long raw timestamps/IDs and snake_case labels are displayed without task-specific formatting. “N records” counts the current page. Package item_count counts distinct order lines, not total units. Warehouse list hides the address despite the operations guide claiming it lists dispatch addresses.

**Why it matters for juniors:** It takes more effort to identify the intended record and compare counts or deadlines; “items” can mean lines or units.

**Affected:** Resource tables, package counts, warehouse summaries, date/price displays.

**Recommendation:** Define explicit stable columns, show named identifiers with copy controls, label “lines” versus “units,” show page range/total, and format dates with a clear timezone plus exact-value access. Show dispatch city/address completeness and explicit currency/unit guidance. Stock/status visibility is a higher-priority part of H10.

**Evidence:** [column rendering](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/ResourcePage.tsx:105), [package count SQL](/Users/enrico/Documents/engineering-challenge/apps/marketplace/internal/server/control_fulfillment.go:73).

### N2 — Scenario configuration lacks reusable learning exercises

**Problem:** Scenario help is Indonesian while surrounding labels/docs are English; percentages are free numeric inputs with no client maximum of 100. There are no named presets, “clear all” control, or visible summary of active faults beside simulator requests.

**Why it matters for juniors:** Learners must translate both language and configuration into an expected result, then remember to undo every fault individually. The language issue matters when the learner cannot read Indonesian; no single language preference is presumed.

**Affected:** Scenarios and Request Simulator context.

**Recommendation:** Use a consistent chosen locale, clear valid ranges, and optional presets such as “observe duplicate delivery” with expected evidence and an explicit reset. Show active faults for the selected shop to explain deliberately failing requests.

**Evidence:** [scenario fields/help](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/components/Scenario.tsx:51).

### N3 — Documentation sections and details are not durable learning destinations

**Problem:** Portal sections and selected endpoints live in component state at /docs. Browser refresh/back or sharing a reference anchor cannot reliably restore the same section/request; details also have no resource URLs. “Integration Guide” and “API Documentation” are the same /docs navigation target.

**Why it matters for juniors:** They cannot bookmark a lesson, share the exact failing operation with a mentor, or return naturally after inspecting another screen.

**Affected:** Portal navigation, reference anchors, order/package/shipment details, sidebar guide alias.

**Recommendation:** Give sections/endpoints and resource details stable routes or URL state containing only non-secret identifiers. Make guide/reference links lead to distinct intended destinations, and preserve normal Back behavior.

**Evidence:** [navigation aliases](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/app/navigation.ts:98), [portal component state](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/DeveloperPortal.tsx:30), [detail state](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/control-plane/ControlPlaneApp.tsx:25).

### N4 — Account/admin leftovers distract from integration authentication

**Problem:** Request signing embeds another live Operator-registration simulator even though the user must already sign in to reach the portal. It is explicitly labeled correctly, but has low relevance to the main integration workflow. The Users route remains implemented and the operations guide directs admins to it, yet primary navigation never exposes it.

**Why it matters for juniors:** Account creation competes with public credential signing, while authorized mentors/admins cannot discover documented user management.

**Affected:** Request signing, Users route, primary navigation, operations guide.

**Recommendation:** Move the registration exercise to a clearly optional Control Plane account reference; retain it only if it serves a learning objective. Expose Users to Admins or correct the claimed UI access path. Do not remove a supported backend feature solely because its current entry point is missing.

**Evidence:** [account simulator in signing](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/features/developer-portal/sections/Guides.tsx:13), [Users route without nav item](/Users/enrico/Documents/engineering-challenge/apps/marketplace/admin/src/app/navigation.ts:1), [admin guidance](/Users/enrico/Documents/engineering-challenge/docs/marketplace/operations-guide.md:25).

## Ten-step junior developer walkthrough

This records the discoverable path and the source-supported stumbling points. It does not claim the actions were executed against a running system.

| Step | Current path and useful affordance | Confusion or failure point | Findings |
| --- | --- | --- | --- |
| 1. Enter simulator | Sign in or Create account; registration explains Operator role and has progress/errors. | No pre-login portal entry; signing documentation later spends space on creating another account. H7 replaces “online” with the actual control-API read result and separates maintenance configuration from health. | H7, N4 |
| 2. Select/create shop | Dashboard step 1, shop selector, or Shops via runbook. Profiles available at creation. | H4 adds Manage shops, selects new shops and itemizes reset losses. H5 adds provider context across console/portal. Broader selector pagination remains H14. | C3, H4, H5, H14 |
| 3. Find credentials | API Credentials entry and one-time copy dialog. | H4/H5 now distinguish configuration from verification, name shop/provider, preserve the current request across credential visits, offer an in-memory handoff and explain lost/seeded-key recovery. | H4, H5 |
| 4. Understand authentication | Portal Request signing and per-operation header tables. | H5 selects the matching provider and blocks known provider mismatches. Learner must understand client ID = partner ID/app key, dashboard bearer versus public credential, and callback versus app secret. | C2, H5, H11 |
| 5. Test GET orders | Shopee: GET /api/shopee/v1/orders. Tokopedia: POST /api/tokopedia/v202309/orders/search; there is no generic GET orders. | Shopee identifier guidance/list-to-detail and creation-time filter semantics are fixed under C1/H3. Tokopedia default ON_HOLD excludes fresh UNPAID and seeded COMPLETED orders. Request cannot be exported exactly as edited. | C1, H3, H12, H13 |
| 6. Open order and understand fulfillment | Orders → Event trail opens full order detail, including origin and primary shipment. | H1/H2 expose package/shipment/warehouse relationships and explicit package requests; H6 explains actors, legal next actions and canonical/provider/payment vocabularies. H10 adds linked warehouse ledgers and worked allocation guidance. | H1, H2, H6, H10 |
| 7. Configure webhook | Webhooks explains destination/filter versus trigger; public provider registration also exists. | Receiver verification/setup is now reachable (C2 fixed); H9 completes event selections, provider category mappings and trigger guidance; one-time webhook secret shown in a notice instead of the API credential dialog pattern; Tokopedia verification uses an app credential. Hidden older registrations have no pagination. | C2, H8, H9, H11, H14 |
| 8. Trigger marketplace event | Simulate order; Verify payment and other detail actions; Scenarios; Replay/Duplicate/Delay on order events. | H7 opens the created order immediately. H6 now shows only policy-eligible order actions and explicit actor/reason choices. H9 adds the shop event feed and product/shipment trails with matching delivery links; fault exercises remain separate from requests. | H6, H7, H9, H11, N2 |
| 9. Inspect delivery | Order delivery summary; Webhook Deliveries → Attempts; manual Retry. | H7 adds summary→attempt links, manual/bounded refresh and neutral empty text. H8 adds immutable attempt snapshots, failure causes and a local historical signature check. Deletion now preserves evidence and cancels pending deliveries (C4 fixed). | C4, H7, H8 |
| 10. Decide external application's next action | Scattered reference summaries and repository guides describe retries and idempotency. | C2/H3 add verification → durable acceptance guidance, a local receiver, correct pagination vocabulary, and exact fulfillment response locations. H6 explains canonical webhook versus provider API statuses. A complete persisted end-to-end exercise remains absent. No guided page loop, split-package completion, or recovery proof. | C2, H1, H3, H6, H11–H13 |

## Documentation and implementation parity inventory

| Area | Present and useful | Missing, unreachable, or inconsistent | Priority |
| --- | --- | --- | --- |
| Getting started | Dashboard runbook; portal quick start; repository setup guide. | Provider-aware fresh-order exercise, sample-versus-live order explanation, receiver startup, stateful console↔portal handoffs. | H4, H5, H11 |
| Authentication | Correct provider signing implementations and header tables; minimal Shopee Go/Node clients. | H5 completes credential/provider association and handoff. Exact edited-request export remains H12. Provider receiver verifier and Tokopedia key selection are fixed under C2. | H5, H12 |
| Orders | All public order routes represented. | Shopee ID guidance, creation-time filters, and full detail examples are fixed (C1/H3); H6 completes legal next steps/actors, payment authority and provider mappings. | H3, H6 |
| Warehouses/inventory | Repository allocation guide; signed shared reads; functional Admin inventory editor. | H2/H3 add linked fulfillment context and accurately scope provider warehouse projections. H10 completes the in-portal worked stock example and linked per-product warehouse ledger. | H2, H3, H10, H11 |
| Packages/shipments | Explicit package API and optional shipment package_id exist; order detail returns collections. | H1–H3 completed: package_id modes, IDs/remaining quantities, linked collections, singular-versus-list guidance, exact response shapes, and complete provider package projection. | H1–H3 |
| Webhooks | Provider verification formulas in repository webhook guide; durable retries in worker. | C2 completes the reachable guide, provider selection/envelopes, local receiver and key rotation guidance. H8 completes attempt diagnosis and historical verification; H9 completes the catalog, provider category coverage, trigger guidance and resource trails. | H8, H9, H11 |
| Pagination | H3 aligns Shopee page_no/page_size, shared webhook page/limit, the unpaginated warehouse list, and Tokopedia opaque page_token across runtime, simulator, guide, and OpenAPI. | Working next-page exercises and larger-result usability remain open. | H13, H14 |
| Errors/recovery | Operation-specific example envelopes; error/limit overview; repository idempotency guidance. | In-simulator header diagnostics, schema validation, no-shop/fault/timeout explanations, workflow recovery after expiry and partial shipment. | H6–H8, H11–H13 |

**Missing API Simulator capabilities are primarily field/workflow/debugging coverage, not absent endpoint buttons:** package_id, shared webhook pagination inputs, nested field guidance, response-to-next-request handoff, faithful request export, full relevant response headers, persistent in-memory operation drafts/retry keys, timeout/cancel controls, provider-aware fixture defaults, and receiver verification support. Request signing itself already works for all three contracts.

## Terminology that needs an explicit mapping

| Current terms | Ambiguity | Recommended usage |
| --- | --- | --- |
| Order ID / order_id / order_sn / order_number | Fixed under C1: the API identifier and display number are now distinguished. | Show API identifier separately from human order number; use order_id in current provider paths. |
| Event trail / order details / Event Logs | General order detail is hidden behind a logging label; Logs is only an alias. | “View order” with an Events section; make a logs entry lead to logs. |
| Deliveries / Webhook Deliveries / Shipments | Page title “Deliveries” can mean parcel arrival. | “Webhook deliveries” throughout; shipment delivery stays within fulfillment. |
| Stock / sellable stock / on hand / reserved / available | Product aggregate and physical counts are easily conflated. | “Available stock” for the product aggregate; physical/reserved/available per warehouse. |
| item_count / quantity | Package list count is distinct lines, not units. | “Order lines” and “Total units” separately. |
| PAID / ON_HOLD; PROCESSING / AWAITING_SHIPMENT; READY_TO_SHIP / AWAITING_COLLECTION | Admin and provider API status vocabularies differ. | Canonical plus provider mapping at decision points; document canonical webhook payload status separately. |
| Client ID / partner ID / app key; client secret / webhook secret | Alias and ownership rules are not visible at credential use. | Contract-specific labels with the canonical credential field in help; show actual webhook signing key source. |
| Shared / Generic | Shared registration/auth route is mistaken for Generic delivery behavior. | Explain shared resources separately from the shop-selected outbound provider contract. |
| Shopee / Shopee-like; Tokopedia-like / Tokopedia & Shop / Tokopedia & TikTok Shop | User labels vary between surfaces. | One consistent display name per simulator profile, with enum shown as technical metadata where useful. |
| Seed data / Reset to seed | Routine setup and destructive replacement look interchangeable. | “Load sample data” only if additive; “Reset shop and replace data” for current destructive behavior. |

## Backend functionality that the UI underexposes

| Implemented capability | Current discovery gap | Finding |
| --- | --- | --- |
| Multiple shipments and package-specific shipment creation | Resolved: all packages/shipments and origin links are visible; explicit and automatic shipment modes are available. | H1, H2 fixed |
| Warehouse allocation and reservations | Resolved by H10: warehouse ledger links, visible available stock/status, allocation and replacement-count guidance. | H10 |
| Stored event payloads and attempt headers | H8 now exposes canonical event and immutable transformed body/headers together, with explicit legacy gaps. | H8 |
| Payment expiry, seller SLA, payment failure, shipment RTS events | Resolved by H9: complete selectors/provider categories and combined order/shipment trail. | H6, H9 |
| Replay, duplicate, delay | H9 exposes actions on shop/product/shipment trails. The complete consumer exercise remains H11. | H9, H11 |
| Paginated shops/webhooks/picker resources | Consumers ignore continuation metadata. | H14 |
| Admin user management | Route exists but no role-based navigation entry. | N4 |

## Dead, duplicated, or obsolete UI/documentation after domain changes

- **Resolved under C2:** the corrected Webhooks learning component is now mounted by DeveloperPortal; a navigation regression proves reachability.
- **Partially resolved compatibility UI:** H2 replaces the primary singleton shipment presentation with all packages/shipments. H6 uses authoritative payment status in the UI; the compatibility API field remains documented for older clients.
- **Old hand-maintained event list — resolved by H9:** Admin, portal and simulator share the full catalog with backend/OpenAPI parity tests. Provider subscription expansion includes failure, expiry and return events.
- **Duplicated navigation destinations:** H9 replaces Event Logs→Orders with a real event feed. Integration Guide→Documentation remains N3.
- **Account simulator inside public request signing:** optional educational content interrupts the core auth task; move rather than automatically delete it (N4).
- **Static “exact request” snippets and narrow parity tests:** C1/H3 add identifier semantics, semantic pagination/filter checks, exact nested examples, and a list-to-detail contract exercise. Edited-request export remains open (H12).
- **Historical report claims need scope qualifiers:** the implementation report's “85/85 complete” and “no remaining gaps” concern earlier delivery scopes, not this audit's Product & DX acceptance. Its limitation saying partial shipments are out of scope conflicts with current partial allocation/multiple-shipment behavior; preserve the historical record but clarify present support boundaries. No runtime fix is claimed by this audit.

## Original prioritized implementation plan (historical)

The [current remaining plan](../../IMPLEMENTATION_REPORT.md#remaining-implementation-plan) covers N1–N4; the SQLc validation follow-up is complete. C5 is excluded, and H11–H14/H16/H17 are implemented. The sequencing below is historical.

C1–C4, H1–H10, and H15 are implemented and verified. At that historical checkpoint, H11–H14 and N1–N4 were proposed. H11–H14 are now implemented; N1–N4 remain open. Fix the central journey before undertaking broad visual redesign.

| Sequence | Scope and dependencies | Completion evidence required |
| --- | --- | --- |
| 1 — Correct dangerous or blocking claims | C1–C4 and H3 completed: order identifiers/list-to-detail handoff, webhook signing/identity, shop-safe loading/actions, deletion retention, and correct filter semantics. | A documented Shopee list ID opens detail; both provider receivers verify actual worker payloads; delayed shop responses cannot enable wrong-context writes; deletion behavior matches explicit retention/loss messaging; time filters match SQL behavior. |
| 2 — Make setup and first requests dependable | H4/H7 completed: direct shop management, new-shop selection, truthful configuration/reset descriptions, recoverable states and bounded delivery refresh. H5 provider/credential handoff completed. Remaining H14: paged selectors/webhooks. | Fresh Operator and existing multi-shop user can configure the intended shop; 21st shop/webhook is reachable; first GET/search returns expected fixtures; rejected actions show actionable errors. |
| 3 — Make fulfillment inspectable and teachable | H1–H2 completed: package_id, line IDs/remaining quantities, multiple shipments and origin links. H6 status/actor guidance completed. H10 inventory discovery, warehouse ledger links and allocation teaching completed. | Exercise an order split into two packages; create shipments for each; inspect the correct warehouse and quantities; explain aggregate state and inventory changes; reject invalid actions with prerequisites visible. |
| 4 — Complete the callback/debugging loop | H8 completes payload/header snapshots, failure reasons, linked events/deliveries/attempts and historical signature checks. H9 event catalog and trails completed. Remaining H11: a complete consumer exercise. | For both profiles, learner observes success, duplicate, failed attempt/retry, delayed/out-of-order delivery, and RTS event; identifies the stable key and explains the external application's durable next action without source access. |
| 5 — Finish simulator fidelity and documentation parity | H3 completed semantic filter/pagination checks and complete nested examples. Remaining H12/H13: edited-request export, diagnostic headers, per-operation drafts, explicit new-operation/retry and timeout controls. | Exported request matches edited request; paginated results can be exhausted; explicit-package shipment works from portal alone; same-key replay, conflict, retry-after, and timeout outcomes are visible and explained. |
| 6 — Apply interaction/accessibility fixes and focused polish | H15 completed: shared modal semantics, focus containment/restoration, Escape handling, background inertness, and contextual selector names. Remaining N1–N4: stable columns, terminology, scenario exercises, durable links, optional account/admin navigation cleanup. | H15 browser keyboard journey completed. Remaining: consistent named relationships, dates/counts; deep link restores intended non-secret context; scenario reset restores the happy path. |

Use focused component and backend contract tests during remediation. Extend coverage to semantic examples, optional request fields, route reachability, delayed fetches, and failure states rather than adding more presence-only assertions. Run final Docker Compose/browser E2E only when explicitly requested or needed to inspect/validate the changed UI; it was not required or run for this audit. Close each finding only after its relevant Domain → Backend → OpenAPI → Portal → Simulator → Examples → Admin → Tests surfaces agree and the implementation report records actual verification.
