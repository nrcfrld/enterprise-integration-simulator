import type { PortalEndpoint, ProviderContract } from "../types";

export const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const orderID = { name: "id", label: "Order ID", help: "Copy order_id from the provider order list/search response. Every order {id} path uses order_id.", type: "string", required: true };
const shopeeOrderID = { ...orderID, help: "Copy order_id from response.order_list into this path. order_sn is the display order number and cannot be used as {id}." };
const productID = { name: "id", label: "Product ID", help: "List or search provider products first, then copy its product id here.", type: "string", required: true };
const webhookID = { name: "id", label: "Webhook ID", help: "Copy an id from List shared webhooks.", type: "string", required: true };
const warehouseID = { name: "id", label: "Warehouse ID", help: "Copy an id from List fulfillment warehouses.", type: "string", required: true };
const pageNo = [
  { name: "page_no", label: "Page number", help: "Starts at 1; increment it for the next page.", initial: "1", type: "integer" },
  { name: "page_size", label: "Page size", help: "Records per page (1–100).", initial: "20", type: "integer" },
];

const shipmentBodyFields = [
  { name: "package_id", type: "string", required: false, description: "Existing package ID from allocation or order detail package_list[].package_id. Omit to create a new package for remaining unallocated quantities; omission fails when all items are allocated.", example: "pkg_example_01" },
  { name: "shipping_provider", type: "string", required: true, description: "Carrier code used to create tracking for the package.", example: "provider_express" },
  { name: "pickup_type", type: "string", required: true, description: "Fulfilment handoff mode. This simulator accepts PICKUP exactly.", example: "PICKUP" },
];

const cancellationBodyFields = (name: "cancel_reason" | "reason") => [
  { name, type: "string", required: true, description: "Customer cancellation reason. Accepted values: CHANGE_OF_MIND, DUPLICATE_ORDER, or ADDRESS_ISSUE.", example: "CHANGE_OF_MIND" },
];

const callbackBodyFields = (provider: "shared" | "shopee" | "tokopedia") => [
  { name: provider === "shared" ? "url" : "callback_url", type: "URI string", required: true, description: "Public HTTP(S) destination that receives signed deliveries.", example: `https://example.com/hooks/${provider === "shared" ? "marketplace" : provider}` },
  { name: provider === "shared" ? "subscribed_events" : "event_types", type: "string[]", required: true, description: "Provider event names to subscribe to. Use the exact, case-sensitive values shown in the example.", example: provider === "shared" ? "[\"order.created\"]" : provider === "shopee" ? "[\"order_status_update\"]" : "[\"ORDER_STATUS_CHANGE\"]" },
  { name: "secret", type: "string", required: false, description: "Shopee delivery verification secret; unused for Tokopedia, which signs with its oldest ACTIVE app credential. If omitted, a secret is generated and returned once.", example: "whsec_your_secret" },
];

type ErrorKind = "authentication" | "not-found" | "validation" | "transition";

const errors: Record<ProviderContract, Record<ErrorKind, string>> = {
  shared: {
    authentication: '{\n  "error": { "code": "INVALID_SIGNATURE", "message": "signature did not match" }\n}',
    "not-found": '{\n  "error": { "code": "NOT_FOUND", "message": "resource not found" }\n}',
    validation: '{\n  "error": { "code": "INVALID_REQUEST", "message": "url and subscribed_events are required" }\n}',
    transition: '{\n  "error": { "code": "INVALID_TRANSITION", "message": "the resource cannot make this transition" }\n}',
  },
  shopee: {
    authentication: '{\n  "error": "error_auth",\n  "message": "signature did not match",\n  "request_id": "req_…"\n}',
    "not-found": '{\n  "error": "error_not_found",\n  "message": "resource not found",\n  "request_id": "req_…"\n}',
    validation: '{\n  "error": "error_param",\n  "message": "callback_url and event_types are required",\n  "request_id": "req_…"\n}',
    transition: '{\n  "error": "error_invalid_state",\n  "message": "the order cannot make this transition",\n  "request_id": "req_…"\n}',
  },
  tokopedia: {
    authentication: '{\n  "code": 36000001,\n  "message": "invalid app credential",\n  "request_id": "req_…",\n  "data": {}\n}',
    "not-found": '{\n  "code": 400,\n  "message": "resource not found",\n  "request_id": "req_…",\n  "data": {}\n}',
    validation: '{\n  "code": 400,\n  "message": "callback_url and event_types are required",\n  "request_id": "req_…",\n  "data": {}\n}',
    transition: '{\n  "code": 36000003,\n  "message": "the order cannot make this transition",\n  "request_id": "req_…",\n  "data": {}\n}',
  },
};

function errorKind(endpoint: Omit<PortalEndpoint, "errorResponse">): ErrorKind {
  if (endpoint.id === "delete-webhook" || endpoint.id.startsWith("get-") || endpoint.id.includes("-get-")) {
    return "not-found";
  }
  if (endpoint.group === "Webhooks" && endpoint.idempotent) {
    return "validation";
  }
  if (endpoint.idempotent) {
    return "transition";
  }
  return "authentication";
}

function endpoint(value: Omit<PortalEndpoint, "errorResponse">): PortalEndpoint {
  return { ...value, errorResponse: errors[value.contract][errorKind(value)] };
}

export const ENDPOINTS: PortalEndpoint[] = [
  endpoint({
    id: "list-warehouses", group: "Warehouses", contract: "shared", method: "GET", path: "/api/v1/warehouses", title: "List fulfillment warehouses",
    summary: "Read fulfillment origins for the credential’s shop, including the stored dispatch address. Setup and stock adjustment stay in the control plane.", outcome: "200 OK with active and inactive warehouse records.",
    response: '{\n  "data": [{ "id": "wh_…", "code": "WH-JKT", "name": "Jakarta Fulfillment", "status": "ACTIVE", "address": { "address_line": "Jl. Raya Bekasi 10", "city": "Jakarta", "postal_code": "13910" }, "priority": 100 }]\n}',
  }),
  endpoint({
    id: "get-warehouse", group: "Warehouses", contract: "shared", method: "GET", path: "/api/v1/warehouses/{id}", title: "Get warehouse inventory", pathParams: [warehouseID],
    summary: "Read on-hand, reserved, and available quantity at one fulfillment origin.", outcome: "200 OK with inventory rows.",
    response: '{\n  "id": "wh_…",\n  "inventory": [{ "sku": "MUG-001", "on_hand_quantity": 24, "reserved_quantity": 2, "available_quantity": 22 }]\n}',
  }),
  endpoint({
    id: "list-webhooks", group: "Webhooks", contract: "shared", method: "GET", path: "/api/v1/webhooks", title: "List shared webhooks",
    summary: "Read shop webhook registrations without revealing their stored secrets. Delivery format follows the shop provider, including registrations made here.", outcome: "200 OK with webhook registrations.",
    response: '{\n  "data": [{ "id": "wh_…", "url": "https://example.com/hooks/marketplace", "enabled": true, "subscribed_events": ["order.created"] }]\n}',
  }),
  endpoint({
    id: "register-webhook", group: "Webhooks", contract: "shared", method: "POST", path: "/api/v1/webhooks", title: "Register a shared webhook", idempotent: true,
    summary: "Subscribe an HTTP(S) destination to durable canonical product and order events.",
    body: '{\n  "url": "https://example.com/hooks/marketplace",\n  "subscribed_events": ["order.created", "order.paid", "order.ready_to_ship", "order.shipped"]\n}',
    bodyFields: callbackBodyFields("shared"),
    outcome: "201 Created. An omitted secret is generated and returned once only.",
    response: '{\n  "id": "wh_…",\n  "url": "https://example.com/hooks/marketplace",\n  "enabled": true,\n  "secret": "whsec_…"\n}',
  }),
  endpoint({
    id: "delete-webhook", group: "Webhooks", contract: "shared", method: "DELETE", path: "/api/v1/webhooks/{id}", title: "Delete a shared webhook", pathParams: [webhookID], idempotent: true,
    summary: "Stop future deliveries while retaining history. Pending deliveries are cancelled; an in-flight attempt may finish. Deleted registrations cannot be retried. Reuse the idempotency key only when retrying this deletion.", outcome: "204 No Content.", response: "(empty response body)",
  }),

  endpoint({
    id: "shopee-list-products", group: "Products", contract: "shopee", method: "GET", path: "/api/shopee/v1/products", title: "List Shopee-like items",
    query: [...pageNo, { name: "item_status", label: "Item status", help: "Filter ACTIVE or INACTIVE catalogue items.", initial: "ACTIVE", type: "string", values: ["ACTIVE", "INACTIVE"] }, { name: "item_name", label: "Item name", help: "Case-insensitive partial item-name search.", type: "string" }],
    summary: "Use Shopee-like item terminology and page-number pagination for this shop’s catalogue.", outcome: "200 OK in a Shopee-like envelope.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "item": [{ "item_id": "prd_…", "item_sku": "MUG-001", "item_name": "Ceramic Mug" }], "has_next_page": false }\n}',
  }),
  endpoint({
    id: "shopee-get-product", group: "Products", contract: "shopee", method: "GET", path: "/api/shopee/v1/products/{id}", title: "Get a Shopee-like item", pathParams: [productID],
    summary: "Fetch one catalogue item using its item_id.", outcome: "200 OK in a Shopee-like envelope.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "item_id": "prd_…", "item_sku": "MUG-001", "item_name": "Ceramic Mug", "stock": 24 }\n}',
  }),
  endpoint({
    id: "shopee-list-orders", group: "Orders", contract: "shopee", method: "GET", path: "/api/shopee/v1/orders", title: "List Shopee-like orders",
    query: [...pageNo, { name: "order_status", label: "Order status", help: "Filter by one Shopee-like order status, such as READY_TO_SHIP.", type: "string" }, { name: "time_from", label: "Updated from", help: "Include orders updated at or after this Unix timestamp.", type: "integer<int64>" }, { name: "time_to", label: "Updated to", help: "Include orders updated at or before this Unix timestamp.", type: "integer<int64>" }],
    summary: "Start here before an order detail or action request. Copy order_id from response.order_list into {id}; order_sn is the display order number.", outcome: "200 OK with Shopee-like orders.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_list": [{ "order_id": "ord_example_01", "order_sn": "SIM-EXAMPLE-01", "order_status": "PAID", "total_amount": 125000 }], "page_no": 1, "page_size": 20, "total_count": 1, "more": false }\n}',
  }),
  endpoint({
    id: "shopee-get-order", group: "Orders", contract: "shopee", method: "GET", path: "/api/shopee/v1/orders/{id}", title: "Get a Shopee-like order", pathParams: [shopeeOrderID],
    summary: "Inspect item_list[].id for allocation and package_list[].package_id for shipment creation. Read shipment_list for all shipments.", outcome: "200 OK with order detail.",
    response: "{\n  \"error\": \"\",\n  \"message\": \"success\",\n  \"response\": {\n    \"order_id\": \"ord_example_01\",\n    \"order_sn\": \"SIM-EXAMPLE-01\",\n    \"order_status\": \"READY_TO_SHIP\",\n    \"item_list\": [\n      {\n        \"id\": \"ori_example_01\",\n        \"sku\": \"MUG-001\",\n        \"product_name\": \"Ceramic Mug\",\n        \"quantity\": 2,\n        \"allocated_quantity\": 1,\n        \"remaining_quantity\": 1,\n        \"price\": 125000\n      }\n    ],\n    \"package_list\": [\n      {\n        \"package_id\": \"pkg_example_01\",\n        \"package_number\": \"PKG-EXAMPLE-01\",\n        \"package_status\": \"READY_TO_SHIP\"\n      }\n    ],\n    \"shipment_list\": [\n      {\n        \"id\": \"shp_example_01\",\n        \"package_id\": \"pkg_example_01\",\n        \"order_id\": \"ord_example_01\",\n        \"status\": \"CREATED\",\n        \"tracking_number\": \"GXEXAMPLE01\"\n      }\n    ]\n  }\n}",
  }),
  endpoint({
    id: "shopee-cancel-order", group: "Orders", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/cancel", title: "Customer-cancel a Shopee-like order", pathParams: [shopeeOrderID], idempotent: true,
    summary: "Cancel an eligible, unshipped order. This provider accepts customer cancellation reasons.", body: '{\n  "cancel_reason": "CHANGE_OF_MIND"\n}', outcome: "200 OK with CANCELLED status.",
    bodyFields: cancellationBodyFields("cancel_reason"),
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_id": "ord_example_01", "order_status": "CANCELLED" }\n}',
  }),
  endpoint({
    id: "shopee-process-order", group: "Orders", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/ship-order", title: "Start seller processing", pathParams: [shopeeOrderID], idempotent: true,
    summary: "Move a paid order into seller processing; payment verification is a control-plane action.", outcome: "200 OK with PROCESSING status.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_id": "ord_example_01", "order_status": "PROCESSING" }\n}',
  }),
  endpoint({
    id: "shopee-ready-to-ship", group: "Orders", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/ready-to-ship", title: "Mark order ready to ship", pathParams: [shopeeOrderID], idempotent: true,
    summary: "Move a seller-processed order to READY_TO_SHIP before package allocation or shipment creation.", outcome: "200 OK with READY_TO_SHIP status.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_id": "ord_example_01", "order_status": "READY_TO_SHIP" }\n}',
  }),
  endpoint({
    id: "shopee-create-package", group: "Fulfillment", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/packages", title: "Allocate a Shopee-like package", pathParams: [shopeeOrderID], idempotent: true,
    summary: "A package is the portion of an order allocated for fulfillment. Use an order_item_id from order detail and a remaining quantity.",
    body: '{\n  "items": [{ "order_item_id": "replace-with-order-item-id", "quantity": 1 }]\n}', outcome: "200 OK with the package allocation.",
    bodyFields: [
      { name: "items", type: "object[]", required: true, description: "Non-empty list of order lines to allocate into one package." },
      { name: "items[].order_item_id", type: "string", required: true, description: "Order-line identifier from the order detail response.", example: "ori_…" },
      { name: "items[].quantity", type: "integer", required: true, description: "Positive quantity not already allocated to another package.", example: "1" },
    ],
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "package": { "id": "pkg_…", "order_id": "ord_…", "status": "READY_TO_SHIP" } }\n}',
  }),
  endpoint({
    id: "shopee-create-shipment", group: "Fulfillment", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/shipments", title: "Create a Shopee-like shipment", pathParams: [shopeeOrderID], idempotent: true,
    summary: "A shipment adds tracking and pickup details to a READY_TO_SHIP order or allocated package.",
    body: '{\n  "package_id": "pkg_example_01",\n  "shipping_provider": "provider_express",\n  "pickup_type": "PICKUP"\n}', outcome: "200 OK with a CREATED shipment and tracking number.",
    bodyFields: shipmentBodyFields,
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "shipment": { "id": "shp_…", "tracking_number": "GX…", "status": "CREATED" } }\n}',
  }),
  endpoint({
    id: "shopee-list-webhooks", group: "Webhooks", contract: "shopee", method: "GET", path: "/api/shopee/v1/webhooks", title: "List Shopee-like callbacks",
    summary: "Read callbacks using Shopee-like event category names.", outcome: "200 OK with webhook_list.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "webhook_list": [{ "webhook_id": "wh_…", "event_types": ["order_status_update"] }] }\n}',
  }),
  endpoint({
    id: "shopee-create-webhook", group: "Webhooks", contract: "shopee", method: "POST", path: "/api/shopee/v1/webhooks", title: "Register a Shopee-like callback", idempotent: true,
    summary: "Subscribe to provider categories; the simulator maps them to durable domain events.",
    body: '{\n  "callback_url": "https://example.com/hooks/shopee",\n  "event_types": ["order_status_update", "logistics_status_update"]\n}', outcome: "200 OK. An omitted secret is returned once.",
    bodyFields: callbackBodyFields("shopee"),
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "webhook_id": "wh_…", "event_types": ["order_status_update"], "secret": "whsec_…" }\n}',
  }),

  endpoint({
    id: "tokopedia-search-products", group: "Products", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/products/search", title: "Search Tokopedia-like products",
    summary: "Search provider products with opaque page tokens; send a returned token unchanged for the next page.", body: '{\n  "page_size": 20,\n  "keyword": "mug"\n}', outcome: "200 OK in a Partner Center-style envelope.",
    bodyFields: [
      { name: "page_size", type: "integer", required: false, description: "Number of records to return, from 1 to 100. Defaults to 20.", example: "20" },
      { name: "page_token", type: "string", required: false, description: "Opaque next_page_token from the preceding response; do not modify it." },
      { name: "keyword", type: "string", required: false, description: "Case-insensitive partial product name or SKU search.", example: "mug" },
    ],
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "products": [{ "product_id": "prd_…", "name": "Ceramic Mug" }], "next_page_token": "", "has_more": false }\n}',
  }),
  endpoint({
    id: "tokopedia-get-product", group: "Products", contract: "tokopedia", method: "GET", path: "/api/tokopedia/v202309/products/{id}", title: "Get a Tokopedia-like product", pathParams: [productID],
    summary: "Fetch one provider product using its product_id.", outcome: "200 OK in a Partner Center-style envelope.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "product_id": "prd_…", "sku": "MUG-001", "name": "Ceramic Mug" }\n}',
  }),
  endpoint({
    id: "tokopedia-search-orders", group: "Orders", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/search", title: "Search Tokopedia-like orders",
    summary: "Start a Tokopedia-like lifecycle here. Copy a returned order_id for the next action.", body: '{\n  "page_size": 20,\n  "order_status": "ON_HOLD"\n}', outcome: "200 OK with opaque page-token pagination.",
    bodyFields: [
      { name: "page_size", type: "integer", required: false, description: "Number of records to return, from 1 to 100. Defaults to 20.", example: "20" },
      { name: "page_token", type: "string", required: false, description: "Opaque next_page_token from the preceding response; do not modify it." },
      { name: "order_status", type: "string", required: false, description: "Tokopedia-like status filter: UNPAID, ON_HOLD, AWAITING_SHIPMENT, AWAITING_COLLECTION, IN_TRANSIT, DELIVERED, COMPLETED, or CANCEL.", example: "ON_HOLD" },
    ],
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "orders": [{ "order_id": "ord_…", "order_status": "ON_HOLD", "payment_status": "PAID" }], "next_page_token": "", "has_more": false }\n}',
  }),
  endpoint({
    id: "tokopedia-get-order", group: "Orders", contract: "tokopedia", method: "GET", path: "/api/tokopedia/v202309/orders/{id}", title: "Get a Tokopedia-like order", pathParams: [orderID],
    summary: "Inspect line_items[].id and package_list[].package_id before shipment creation. Read shipment_list for all shipments. Allocate explicit packages through Admin Packages; Tokopedia has no public package-allocation endpoint.", outcome: "200 OK with order detail.",
    response: "{\n  \"code\": 0,\n  \"message\": \"success\",\n  \"data\": {\n    \"order_id\": \"ord_example_01\",\n    \"order_number\": \"SIM-EXAMPLE-01\",\n    \"order_status\": \"AWAITING_COLLECTION\",\n    \"line_items\": [\n      {\n        \"id\": \"ori_example_01\",\n        \"sku\": \"MUG-001\",\n        \"product_name\": \"Ceramic Mug\",\n        \"quantity\": 2,\n        \"allocated_quantity\": 1,\n        \"remaining_quantity\": 1,\n        \"price\": 125000\n      }\n    ],\n    \"package_list\": [\n      {\n        \"package_id\": \"pkg_example_01\",\n        \"package_number\": \"PKG-EXAMPLE-01\",\n        \"package_status\": \"READY_TO_SHIP\"\n      }\n    ],\n    \"shipment_list\": [\n      {\n        \"id\": \"shp_example_01\",\n        \"package_id\": \"pkg_example_01\",\n        \"order_id\": \"ord_example_01\",\n        \"status\": \"CREATED\",\n        \"tracking_number\": \"GXEXAMPLE01\"\n      }\n    ]\n  }\n}",
  }),
  endpoint({
    id: "tokopedia-pack-order", group: "Orders", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/pack", title: "Pack a Tokopedia-like order", pathParams: [orderID], idempotent: true,
    summary: "Move a paid ON_HOLD order into AWAITING_SHIPMENT. Payment is verified in the control plane.", outcome: "200 OK with AWAITING_SHIPMENT status.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "order_id": "ord_…", "order_status": "AWAITING_SHIPMENT" }\n}',
  }),
  endpoint({
    id: "tokopedia-handover-order", group: "Orders", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/handover", title: "Hand over a packed order", pathParams: [orderID], idempotent: true,
    summary: "Move AWAITING_SHIPMENT to AWAITING_COLLECTION before shipment creation.", outcome: "200 OK with AWAITING_COLLECTION status.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "order_id": "ord_…", "order_status": "AWAITING_COLLECTION" }\n}',
  }),
  endpoint({
    id: "tokopedia-cancel-order", group: "Orders", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/cancel", title: "Cancel a Tokopedia-like order", pathParams: [orderID], idempotent: true,
    summary: "Cancel an eligible, unshipped order with a supported customer reason.", body: '{\n  "reason": "CHANGE_OF_MIND"\n}', outcome: "200 OK with CANCEL status.",
    bodyFields: cancellationBodyFields("reason"),
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "order_id": "ord_…", "order_status": "CANCEL" }\n}',
  }),
  endpoint({
    id: "tokopedia-create-shipment", group: "Fulfillment", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/shipments", title: "Create a Tokopedia-like shipment", pathParams: [orderID], idempotent: true,
    summary: "Add tracking and pickup details after the provider order is AWAITING_COLLECTION.", body: '{\n  "package_id": "pkg_example_01",\n  "shipping_provider": "provider_express",\n  "pickup_type": "PICKUP"\n}', outcome: "200 OK with a CREATED shipment.",
    bodyFields: shipmentBodyFields,
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "shipment": { "id": "shp_…", "tracking_number": "GX…", "status": "CREATED" } }\n}',
  }),
  endpoint({
    id: "tokopedia-configure-webhook", group: "Webhooks", contract: "tokopedia", method: "PUT", path: "/api/tokopedia/v202309/webhooks", title: "Configure a Tokopedia-like callback", idempotent: true,
    summary: "Configure provider notification categories. Deliveries carry a numeric type and Authorization HMAC.",
    body: '{\n  "callback_url": "https://example.com/hooks/tokopedia",\n  "event_types": ["ORDER_STATUS_CHANGE", "PACKAGE_UPDATE"]\n}', outcome: "200 OK. Any returned registration secret is unused for verification. Use the oldest ACTIVE app credential’s Client ID and secret for Authorization HMAC.",
    bodyFields: callbackBodyFields("tokopedia"),
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "webhook_id": "wh_…", "event_types": ["ORDER_STATUS_CHANGE"], "secret": "whsec_…" }\n}',
  }),
];

export const ENDPOINT_BY_ID = Object.fromEntries(
  ENDPOINTS.map((value) => [value.id, value]),
) as Record<string, PortalEndpoint>;
