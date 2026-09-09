# Marketplace Simulator — post-remediation Product & DX re-audit

Date: 2026-09-09. Source baseline: **0ad5e3b**. Audience: entry-level and junior integration developers. Evaluated against [CONTEXT.md](../../CONTEXT.md).

## Remediation status — 2026-09-10

**N1–N3 and H18–H20 are implemented and verified.** N4 remains open; N5–N7 remain proposed. C5 stays excluded (5173 retained). See [implementation evidence](../../IMPLEMENTATION_REPORT.md#implemented--n1n3-h18h20-2026-09-10).

- N2: active-fault/maintenance context, unknown-state recovery, named exercise drafts, probability validation and Clear shop faults.
- H20: the Admin inventory editor sends a checked row version; stale saves return 409 and retain the draft. Legacy control API callers that omit the optional version remain unconditional, explicitly documented.
- H19: contextual revocation preview, current/next Tokopedia signer, last-key warning, recovery checklist and matching simulator credential invalidation.
- N3/N1: non-secret lesson/operation/shop/filter/page/detail URLs, history and exact shortcuts, explicit columns, View order, line/unit counts, ID copy and UTC dates.
- H18: shop-scoped full-collection text/status search for orders, products, shipments and deliveries, before pagination/totals.

The recommendation, problem statements, walkthrough and plan below preserve the original pre-implementation audit. They are historical evidence, not claims that implemented features remain missing. This implementation did not run Compose/browser E2E.

## Recommendation

Prioritize reliable learning and diagnosis: make active faults visible and reversible, make lessons/resources linkable, add useful resource search, and explain credential changes before they disrupt requests or webhook verification. Add server-side stock conflict detection. Then build guided exercises on the existing durable consumer.

**No new Critical finding established.** Five High Priority improvements are open: existing N2/N3 are promoted, and H18–H20 are new. Five Nice-to-Have items are open: existing N1/N4 and proposed N5–N7. C1–C4 and H1–H17 retain their implemented status; this review does not reopen their original scope. C5 remains excluded: retain frontend origin **5173**.

## Method, evidence and limits

Source-based cognitive walkthrough of Admin navigation, lists/details, scenario controls, credentials, warehouse editing, Developer Portal, request preparation, consumer examples, control/provider handlers and associated tests. No services or external accounts were changed. No Docker Compose or browser E2E was run. Actual layout, contrast, keyboard execution, latency and learner completion rates were not measured; they are not used as evidence of defects.

Focused verification: **36 frontend tests passed across seven files**: 30 portal navigation/endpoint contract/prepared request/reliability tests, plus six warehouse/scenario tests. Durable consumer: **10 tests passed**, including restart/deduplication, provider pagination, persisted mutation keys and commit-before-acknowledgement. Existing tests support retained behavior; they do not prove the proposed fixes or a live end-to-end journey.

## Preserve the improvements already delivered

- The operation areas have explicit navigation, including Warehouses & Inventory and Event Logs.
- Shop changes isolate stale responses and drafts; shop selection survives reload through a stored non-secret ID.
- Credentials and generated Shopee webhook secrets have one-time handoffs. Delivery signing is provider-specific and explained.
- Order detail connects packages, shipments and warehouse inventory. The explicit-package simulator workflow exists.
- Provider operations have metadata, examples and simulator entries. Edited request exports, response evidence, drafts, stable retries and returned-ID/pagination handoffs exist.
- Event catalog, retained webhook history, attempt diagnostics and bounded refresh exist.
- The durable SQLite consumer teaches acceptance separately from processing, reconciliation and retry identity. H11 is no longer a missing lesson.

## Critical

None newly established within this review. This is a bounded assessment, not a claim that the product has no possible critical defects.

## High Priority

### N2 — Fault exercises need visible state and a return-to-normal action

**Status: OPEN; promoted from Nice to Have.** The simulator can intentionally break every public request, so recovery is central to the learning journey.

**Problem:** Scenarios offers raw settings without named exercises or a clear-all-faults action. Request Simulator receives no scenario/maintenance state. Sample reset explicitly preserves scenarios. Help mixes Indonesian and English; probability inputs lack an upper bound while the backend rejects values above 100 with a generic error.

**Why it matters:** A learner returning to a shop can mistake forced 429/500/timeouts for incorrect authentication or a broken application. Restoring sample data does not restore normal behavior.

**Affected:** Scenarios, Request Simulator context, dashboard/reset guidance, Errors & limits.

**Improvement:** Show an active-fault summary beside requests, with loading/unknown state rather than assuming faults are off. Add “Clear shop faults,” separate from data reset. Add named presets for duplicate delivery, timeout and rate limiting with expected observations and recovery steps. Validate 0–100 with field-specific messages; use a consistent language. Show global maintenance separately with role-appropriate recovery guidance.

**Evidence:** [Scenario controls](../../apps/marketplace/admin/src/features/control-plane/components/Scenario.tsx), [request props and errors](../../apps/marketplace/admin/src/features/developer-portal/components/RequestSimulator.tsx), [reset and maintenance](../../apps/marketplace/admin/src/features/control-plane/components/DashboardPages.tsx), [backend ranges](../../apps/marketplace/internal/scenarios/config.go).

### N3 — Lessons, selected operations and record details cannot be shared reliably

**Status: OPEN; promoted from Nice to Have.** Mentor-assisted learning depends on returning to the same context.

**Problem:** Portal section/operation and resource detail are component state. Both “API Documentation” and “Integration Guide” navigate to `/docs`; the preserved portal may show its previous section. Buttons promising “Open API Simulator” also only navigate to `/docs`. Shop persistence uses sessionStorage rather than the shared destination. Event filters use URLs, but shop/page/detail context does not.

**Why it matters:** A bookmarked exercise opens somewhere else; a mentor's link can use the recipient's previously selected shop. Browser Back cannot retrace lesson/detail navigation reliably.

**Affected:** Dashboard shortcuts, sidebar, portal navigation, resource details, event links.

**Improvement:** Route non-secret shop, section, endpoint, filters, page and selected resource explicitly. Validate resource ownership on resolution; show a clear missing/inaccessible destination state. Give guide/reference/simulator shortcuts distinct destinations. Preserve current in-memory credentials without putting them in URLs. Add `aria-current` or appropriate selected-state semantics.

**Evidence:** [navigation aliases](../../apps/marketplace/admin/src/app/navigation.ts), [portal state](../../apps/marketplace/admin/src/features/developer-portal/DeveloperPortal.tsx), [detail state and shortcut routing](../../apps/marketplace/admin/src/features/control-plane/ControlPlaneApp.tsx), [shop/page persistence](../../apps/marketplace/admin/src/features/control-plane/hooks/useControlPlaneResources.ts).

### H18 — Resource lists lack the lookup tools needed for debugging

**Status: OPEN; new.**

**Problem:** Orders, Products, Packages, Shipments and Deliveries have pagination but no list search/status filters. A developer holding an order ID, SKU, tracking number or failed-delivery status must scan pages. Event Logs has useful filters, but they do not replace resource lookup. The Orders provider switch selects among shops; “All providers” does not aggregate their orders.

**Why it matters:** Even the standard 50-order/100-product fixture makes locating a record unnecessarily manual. An integration error usually supplies an ID, not a page number.

**Affected:** Resource lists, fulfillment troubleshooting, delivery failure triage.

**Improvement:** Start with exact ID/order-number lookup and status filters for Orders; event/registration/status filters for Deliveries; SKU/name and tracking search next. Query the full server collection and return filtered totals. Label the provider control as filtering shop choices or explain its scope. Preserve Event Logs filters and related-resource links.

**Evidence:** [list toolbar and columns](../../apps/marketplace/admin/src/features/control-plane/components/ResourcePage.tsx), [page-only queries](../../apps/marketplace/admin/src/features/control-plane/hooks/useControlPlaneResources.ts), [order/fulfillment handlers](../../apps/marketplace/internal/server/control_fulfillment.go), [delivery list](../../apps/marketplace/internal/server/control_webhooks.go).

### H19 — Credential revocation hides its provider-specific consequences

**Status: OPEN; new.** This concerns the action itself, not the already-correct webhook verification guide.

**Problem:** Credentials → Revoke immediately sends the request. The row does not identify whether it is Tokopedia's current webhook signing credential, the next selected key, or the last active credential. The worker chooses the oldest ACTIVE credential for each delivery attempt; revoking it changes the signing key or leaves none.

**Why it matters:** Cleaning up a credential can unexpectedly break both an external client's API calls and receiver verification. The necessary explanation is on another screen.

**Affected:** Credentials actions, Tokopedia webhook rotation, receiver recovery.

**Improvement:** Show a contextual revocation preview with shop/Client ID, API impact, current/next webhook signer and receiver update steps. Identify the last-active-key case. Offer a create-replacement → save values → update client/receiver → verify → revoke checklist, accurately explaining when Tokopedia switches keys. Clear stale simulator credential metadata after revocation; do not expose stored secrets.

**Evidence:** [immediate Revoke action](../../apps/marketplace/admin/src/features/control-plane/components/ResourcePage.tsx), [revocation endpoint](../../apps/marketplace/internal/server/control_fulfillment.go), [delivery-time credential selection](../../apps/marketplace/cmd/worker/main.go), [signing metadata](../../apps/marketplace/internal/server/provider_webhooks.go).

### H20 — Stock replacement still needs server-side conflict protection

**Status: OPEN; new extension beyond H17.** H17 correctly fixed stale saved drafts and conflicts visible after refresh.

**Problem:** The editor compares its draft with the most recently loaded count, then sends only `on_hand_quantity`. The backend locks the current row and replaces the count, without checking the version/count the editor observed. Example: load 10, enter 15 to add 5, an external shipment consumes 2 before Save; the request still sets 15 instead of prompting review of the current 8.

**Why it matters:** A junior can follow the documented “add 5” example and overwrite intervening stock consumption. A row lock serializes writes but does not detect stale user intent.

**Affected:** Warehouse inventory adjustment, concurrent shipment/stock exercises.

**Improvement:** Include an expected version or last-seen count/version in replacements, compare atomically and return an actionable 409 with current values. Preserve the unsaved intended count for review. Teach replacement versus delta adjustment; a separate atomic delta action can follow if needed. Do not imply a UI refresh alone eliminates the race.

**Evidence:** [client baseline and PUT body](../../apps/marketplace/admin/src/features/control-plane/components/details/WarehouseDetail.tsx), [locked unconditional replacement](../../apps/marketplace/internal/server/control_inventory.go), [shipment stock deduction](../../apps/marketplace/internal/inventory/reservation.go).

## Nice to Have

### N1 — Make record identity and terminology explicit

**Status: OPEN; retained. Problem:** Orders/Credentials/Users use scalar-key column fallback; Orders opens full detail under “Event trail”; package `item_count` counts distinct lines, not units; dates are raw. Warehouse address exists in detail/API but is omitted from its list despite the operations-guide claim.

**Why it matters:** Learners must infer units, identify records through long raw values, or open extra screens. **Affected:** resource tables and operations guide. **Improvement:** Explicit columns, “View order,” “Lines”/“Units,” named copy-ID controls, readable dates with timezone/exact values, and corrected address guidance. Standardize Shopee-like/Tokopedia-like labels and explain TikTok naming once.

**Evidence:** [columns/actions](../../apps/marketplace/admin/src/features/control-plane/components/ResourcePage.tsx), [line-count query](../../apps/marketplace/internal/server/control_fulfillment.go), [provider labels](../../apps/marketplace/admin/src/features/control-plane/components/ControlPlaneChrome.tsx), [operations guide](../../docs/marketplace/operations-guide.md).

### N4 — Separate account administration from integration signing

**Status: OPEN; retained. Problem:** Request signing embeds a live account-registration exercise, although the learner is already signed in. `/users` exists but primary navigation omits it while the operations guide tells Admins to open Users.

**Why it matters:** An unrelated account exercise competes with API credentials; mentors cannot discover documented administration. **Affected:** signing guide, sidebar, Users. **Improvement:** Move account APIs to an optional Control Plane reference and expose Users only for authorized Admins. Keep the existing distinction between console tokens and integration credentials.

**Evidence:** [registration exercise](../../apps/marketplace/admin/src/features/developer-portal/sections/Guides.tsx), [navigation](../../apps/marketplace/admin/src/app/navigation.ts), [operations guide](../../docs/marketplace/operations-guide.md).

### N5 — Add observable progress to the existing learning exercises

**Status: PROPOSED FEATURE; not a missing H11 implementation. Problem:** The dashboard explicitly does not track verification; the consumer lesson requires manually inspecting CLI/SQLite evidence.

**Why it matters:** Learners cannot easily tell which part of a multi-step exercise they have demonstrated. **Affected:** runbook, durable consumer exercise. **Improvement:** Add an optional per-shop exercise checklist with exact prerequisites and expected evidence. Distinguish observed signed-request success, delivered webhook, and learner-supplied consumer-processing proof. Offer small fresh-order fixtures without deleting existing setup. Never infer application success from HTTP 204 alone.

**Evidence:** [untracked verification](../../apps/marketplace/admin/src/features/control-plane/components/DashboardPages.tsx), [current complete lesson](../../apps/marketplace/admin/src/features/developer-portal/components/ConsumerExercise.tsx).

### N6 — Add a redacted diagnostic bundle for mentor support

**Status: PROPOSED FEATURE. Problem:** Last-request evidence and delivery attempts are inspectable, but there is no joined, exportable record of a failing exercise; simulator results are local to the mounted request component.

**Why it matters:** Asking for help requires manually collecting provider context, request, response, event and attempt evidence. **Affected:** Request Simulator, delivery detail. **Improvement:** Offer an explicit export preview combining selected evidence, timestamps and related IDs. Redact credentials, signatures/tokens and sensitive body fields by default. A bounded in-memory request history can accompany it; do not persist secrets or claim linkage where correlation is unknown.

**Evidence:** [request state/evidence](../../apps/marketplace/admin/src/features/developer-portal/components/RequestSimulator.tsx), [attempt evidence](../../apps/marketplace/admin/src/features/control-plane/components/details/DeliveryDetail.tsx).

### N7 — Keep complete selection without eagerly loading every record

**Status: PROPOSED SCALABILITY IMPROVEMENT; no measured latency defect. Problem:** Global shop and form collections exhaust pages sequentially, then filter locally. Several control lists load all matching records before slicing a page.

**Why it matters:** Larger workshop datasets can require many requests before choices appear. **Affected:** shop/product/warehouse pickers and control lists. **Improvement:** Introduce server-side paged search with selected-record hydration and explicit loading/retry states. Preserve H14's completeness guarantees. Measure query count and first usable result before assigning a performance target.

**Evidence:** [collection traversal](../../apps/marketplace/admin/src/shared/api/controlPlaneCollection.ts), [shop hydration](../../apps/marketplace/admin/src/features/control-plane/hooks/useControlPlaneResources.ts), [list handlers](../../apps/marketplace/internal/server/control_inventory.go).

## Current ten-step learning journey

This is a source walkthrough, not a live exercise.

| Step | Current capability | Remaining improvement |
| --- | --- | --- |
| Enter | Login/register and dashboard runbook | Keep supported 5173; C5 excluded. Track learning evidence optionally (N5). |
| Choose shop | Create/select, provider context, complete choices | Shareable shop destination (N3); later optimize search (N7). |
| Obtain credentials | One-time copy and simulator handoff | Show revocation/rotation consequences (H19). |
| Understand authentication | Separate provider signing/token contracts | Move account registration out of core signing (N4). |
| Test orders | Shopee GET, Tokopedia POST search; signing/export/pagination | Direct simulator links (N3), active faults (N2). |
| Inspect fulfillment | Order → packages → shipments → warehouse | Lookup/filter and clear labels (H18/N1); atomic stock conflicts (H20). |
| Register callback | Provider guidance and protected secret handoff | Contextual credential rotation (H19). |
| Trigger event | Simulate order/pay, provider actions, replay/duplicate/delay | Named fault presets and restore-normal behavior (N2). |
| Inspect delivery | Recorded attempts, errors and verification | Failure filtering (H18), export support evidence (N6). |
| Process externally | Durable consumer and reconciliation lesson | Optional progress/proof and smaller learning fixtures (N5). |

## Documentation, simulator and domain-change inventory

**Documentation gaps:** fault exercises/cleanup, revocation checklist at the action, explicit provider-filter scope, line-versus-unit labels and warehouse-list guidance. Existing durable consumer, provider authentication, pagination and fulfillment lessons are present. H20 needs new conflict semantics documented when implemented, not ahead of backend support.

**Simulator additions:** live fault/maintenance context and exact operation destinations first; optional diagnostic export/history later. No missing public operation was established by the current contract checks. Do not invent a generic GET orders or standalone shipment endpoint merely to mirror the canonical domain.

**Underexposed behavior:** Admin Users; current/next Tokopedia signer during revocation; existing IDs/statuses usable for resource filters; global maintenance while diagnosing a public request; inventory `updated_at` currently unused as a write precondition.

**Duplicate/obsolete presentation:** two docs navigation aliases; “Event trail” for full order detail; scalar-derived columns; account creation inside signing. The old event-route alias, incomplete package input, lost webhook history and missing durable consumer are fixed history, not current missing features. Canonical and provider statuses are intentionally different and should remain explicitly labeled.

**Feature scope:** An OMS/ERP outbound-intent exercise would extend N5 naturally after current workflows are easier to operate. Full refunds, disputes, a payment-provider simulator or SAP integration are separate product increments, not defects inferred from the current Marketplace scope. Prioritize transferable integration lessons before adding more platforms.

## Prioritized implementation plan

All rows below are **proposed, not implemented**. Use small component/contract checks; reserve full Compose/browser E2E for release-level validation or a change that needs runtime inspection.

| Order | Increment | Acceptance evidence | Relative effort |
| --- | --- | --- | --- |
| 1 | N2: visible faults, clear faults, ranges/language; then presets | Forced fault shown in Try; clear restores defaults without deleting records; unknown status not shown as healthy; another shop remains unaffected. | Medium |
| 2 | H20: conditional stock replacement | Two readers at version A; a shipment changes stock; stale Save returns 409 and preserves stock/draft. Fresh reviewed replacement succeeds. | Medium |
| 3 | H19: contextual revocation | Preview current/next signer and last-key impact for Tokopedia; Shopee does not receive incorrect callback-key advice; revoked simulator credential is marked stale. | Small–medium |
| 4 | N3 + N1: exact destinations and record clarity | Copy/open lesson or detail in a new session with authorized shop context; Back works; no secrets in URL; wrong-shop IDs fail clearly; lines/units and order action are explicit. | Medium |
| 5 | H18: lookup and filters | Find an older/later-page record by ID; filtered totals/paging agree; no-match state has clear recovery; access remains shop-scoped. | Medium |
| 6 | N4: account/navigation cleanup | Admin can reach Users, Operator cannot gain access; core signing contains only integration setup. | Small |
| 7 | N5: guided exercises | Fresh-order, duplicate/restart and timeout lessons each have observable evidence and cleanup; transport and application success remain distinct. | Medium |
| 8 | N6, then N7 if measured scale warrants it | Export preserves useful evidence while masking secrets; paged search retains selected items and improves measured first-result/query cost. | Medium |

**Product & DX Review:** Domain, backend, OpenAPI-facing contracts, Admin, Portal, Simulator, examples and tests were assessed together. This task changes audit/report documentation only. Any implementation must update the affected contracts, guides, examples and tests together under CONTEXT.md; no product finding is marked fixed by this re-audit.
