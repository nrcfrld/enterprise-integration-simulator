# Project Context — Enterprise Integration Simulator

## What This Project Is

This project is an **Enterprise Integration Simulator** designed to help entry-level and junior developers learn how real-world enterprise system integrations work.

It simulates external platforms such as:

* Shopee
* TikTok Shop / Tokopedia
* future enterprise systems such as SAP, shipping providers, payment providers, and other external services

The simulator is NOT only a backend API.

It is a **developer learning environment** where developers should be able to:

1. understand how an external platform behaves
2. read its API documentation
3. obtain credentials
4. make API requests
5. receive and debug webhooks
6. handle realistic integration problems
7. build external systems such as OMS, ERP integrations, or merchant applications against the simulator

The primary target users are **entry-level and junior developers**, so realistic behavior must be balanced with excellent Developer Experience.

---

## Product Surfaces

Treat these as parts of ONE product:

### 1. Simulation Engine

Implements realistic marketplace behavior:

* Orders
* Products
* Inventory
* Warehouses
* Payments
* Packages
* Shipments
* Webhooks
* Scenarios
* Provider-specific behavior

### 2. Admin / Control Plane

Used to configure and operate the simulated marketplace.

Examples:

* create/manage shops
* manage products
* manage warehouse inventory
* inspect orders
* simulate payment
* progress shipments
* configure scenarios
* inspect webhook deliveries

### 3. Developer Portal

Explains how developers integrate with the simulated provider.

It should teach:

* authentication
* API contracts
* lifecycle
* concepts
* webhooks
* errors
* pagination
* provider differences
* integration workflows

A developer should not need to inspect backend source code to understand the integration.

### 4. API Request Simulator

Interactive environment for trying the public APIs.

Developers should be able to:

* select endpoints
* understand required parameters
* use example values
* inspect generated requests
* send requests
* inspect responses and errors
* learn provider-specific API behavior

---

## Architecture Principle

Internally, use a canonical domain:

`Order → Package → Shipment`

with related domains such as:

`Product → Warehouse Inventory`

Provider-specific behavior belongs at the external contract/policy layer.

Example:

`Canonical Domain → Shopee Adapter → Shopee-like API`

`Canonical Domain → TikTok Adapter → TikTok-like API`

Do NOT duplicate the entire business domain for every marketplace.

At the same time, do NOT expose a generic marketplace to developers merely because the internal domain is generic.

The developer-facing experience should simulate concrete providers.

---

## Provider Realism

The goal is NOT perfect 1:1 replication of proprietary marketplace internals.

The goal is to reproduce realistic integration concepts and meaningful provider differences.

Provider profiles may differ in:

* authentication/signing
* endpoint structure
* request/response schemas
* order statuses
* webhook payloads
* pagination
* error contracts
* fulfillment behavior

Do not add fake complexity solely for realism.

Prefer behavior that teaches transferable enterprise integration skills.

---

## Developer Experience Principle

Every feature must be evaluated from the perspective of a junior developer integrating with the simulator.

Ask:

> "If I knew nothing about this codebase, could I discover, understand, and successfully use this feature through the product?"

If the answer is no, the feature is incomplete.

Public functionality should be:

* discoverable
* documented
* testable
* understandable
* accompanied by realistic examples
* accompanied by actionable errors

---

## Mandatory Feature Completion

Whenever public integration behavior changes, evaluate ALL affected surfaces:

`Domain`
`→ Backend`
`→ OpenAPI`
`→ Developer Portal`
`→ API Request Simulator`
`→ Examples`
`→ Admin/Control Plane`
`→ Tests`

Do not treat documentation or Developer Experience as follow-up work.

If an API exists but developers cannot discover or understand it through the Developer Portal and API Request Simulator, consider the feature incomplete.

---

## Definition of Done

Before marking any feature COMPLETE:

* implementation is complete
* relevant domain rules are enforced
* tests are added/updated
* existing tests remain passing
* OpenAPI matches actual behavior
* Developer Portal is updated
* API Request Simulator supports affected public APIs
* realistic request/response examples exist
* common errors are understandable
* provider-specific behavior is documented
* relevant Admin UI is updated
* integration workflow is documented when necessary
* implementation report/checklist is updated
* an entry-level/junior developer can discover and use the feature without reading backend source code

Final Docker Compose/browser E2E is a release-level validation step and does not need to be run after every feature unless explicitly requested.

Before completing each task, perform a short **Product & DX Review** and state which of the above surfaces were affected and updated.
