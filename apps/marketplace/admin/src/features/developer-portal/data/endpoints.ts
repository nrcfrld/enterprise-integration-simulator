import type { PortalEndpoint, ProviderContract } from "../types";

export const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const orderID = { name: "id", label: "Order ID", help: "List provider orders first, then copy its order_id here." };
const productID = { name: "id", label: "Product ID", help: "List or search provider products first, then copy its product id here." };
const webhookID = { name: "id", label: "Webhook ID", help: "Copy an id from List shared webhooks." };
const warehouseID = { name: "id", label: "Warehouse ID", help: "Copy an id from List fulfillment warehouses." };
const pageNo = [
  { name: "page_no", label: "Page number", help: "Starts at 1; increment it for the next page.", initial: "1" },
  { name: "page_size", label: "Page size", help: "Records per page (1–100).", initial: "20" },
];

const errors: Record<ProviderContract, string> = {
  shared: '{\n  "error": { "code": "INVALID_SIGNATURE", "message": "signature did not match" }\n}',
  shopee: '{\n  "error": "error_invalid_state",\n  "message": "the order cannot make this transition",\n  "request_id": "req_…"\n}',
  tokopedia: '{\n  "code": 36000003,\n  "message": "the order cannot make this transition",\n  "request_id": "req_…",\n  "data": {}\n}',
};

function endpoint(endpoint: Omit<PortalEndpoint, "errorResponse">): PortalEndpoint {
  return { ...endpoint, errorResponse: errors[endpoint.contract] };
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
    summary: "Read generic webhook registrations without revealing their verification secrets.", outcome: "200 OK with webhook registrations.",
    response: '{\n  "data": [{ "id": "wh_…", "url": "https://example.com/hooks/marketplace", "enabled": true, "subscribed_events": ["order.created"] }]\n}',
  }),
  endpoint({
    id: "register-webhook", group: "Webhooks", contract: "shared", method: "POST", path: "/api/v1/webhooks", title: "Register a shared webhook",
    summary: "Subscribe an HTTP(S) destination to durable canonical product and order events.",
    body: '{\n  "url": "https://example.com/hooks/marketplace",\n  "subscribed_events": ["order.created", "order.paid", "order.ready_to_ship", "order.shipped"]\n}',
    outcome: "201 Created. An omitted secret is generated and returned once only.",
    response: '{\n  "id": "wh_…",\n  "url": "https://example.com/hooks/marketplace",\n  "enabled": true,\n  "secret": "whsec_…"\n}',
  }),
  endpoint({
    id: "delete-webhook", group: "Webhooks", contract: "shared", method: "DELETE", path: "/api/v1/webhooks/{id}", title: "Delete a shared webhook", pathParams: [webhookID],
    summary: "Stop future deliveries. Reuse the idempotency key only when retrying this deletion.", outcome: "204 No Content.", response: "(empty response body)",
  }),

  endpoint({
    id: "shopee-list-products", group: "Products", contract: "shopee", method: "GET", path: "/api/shopee/v1/products", title: "List Shopee-like items",
    query: [...pageNo, { name: "item_status", label: "Item status", help: "Optional: ACTIVE or INACTIVE.", initial: "ACTIVE" }, { name: "item_name", label: "Item name", help: "Optional partial item-name search." }],
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
    query: [...pageNo, { name: "order_status", label: "Order status", help: "Optional provider status, such as READY_TO_SHIP." }],
    summary: "Start here before an order action: copy an order_sn returned for this shop.", outcome: "200 OK with Shopee-like orders.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_list": [{ "order_sn": "ord_…", "order_status": "PAID", "total_amount": 125000 }], "has_next_page": false }\n}',
  }),
  endpoint({
    id: "shopee-get-order", group: "Orders", contract: "shopee", method: "GET", path: "/api/shopee/v1/orders/{id}", title: "Get a Shopee-like order", pathParams: [orderID],
    summary: "Inspect status, line items, package, and shipment before moving the order.", outcome: "200 OK with order detail.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_sn": "ord_…", "order_status": "PAID", "item_list": [] }\n}',
  }),
  endpoint({
    id: "shopee-cancel-order", group: "Orders", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/cancel", title: "Customer-cancel a Shopee-like order", pathParams: [orderID],
    summary: "Cancel an eligible, unshipped order. This provider accepts customer cancellation reasons.", body: '{\n  "cancel_reason": "CHANGE_OF_MIND"\n}', outcome: "200 OK with CANCELLED status.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_sn": "ord_…", "order_status": "CANCELLED" }\n}',
  }),
  endpoint({
    id: "shopee-process-order", group: "Orders", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/ship-order", title: "Start seller processing", pathParams: [orderID],
    summary: "Move a paid order into seller processing; payment verification is a control-plane action.", outcome: "200 OK with PROCESSING status.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_sn": "ord_…", "order_status": "PROCESSING" }\n}',
  }),
  endpoint({
    id: "shopee-ready-to-ship", group: "Orders", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/ready-to-ship", title: "Mark order ready to ship", pathParams: [orderID],
    summary: "Move a seller-processed order to READY_TO_SHIP before package allocation or shipment creation.", outcome: "200 OK with READY_TO_SHIP status.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "order_sn": "ord_…", "order_status": "READY_TO_SHIP" }\n}',
  }),
  endpoint({
    id: "shopee-create-package", group: "Fulfillment", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/packages", title: "Allocate a Shopee-like package", pathParams: [orderID],
    summary: "A package is the portion of an order allocated for fulfillment. Use an order_item_id from order detail and a remaining quantity.",
    body: '{\n  "items": [{ "order_item_id": "replace-with-order-item-id", "quantity": 1 }]\n}', outcome: "200 OK with the package allocation.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "package": { "id": "pkg_…", "order_id": "ord_…", "status": "READY_TO_SHIP" } }\n}',
  }),
  endpoint({
    id: "shopee-create-shipment", group: "Fulfillment", contract: "shopee", method: "POST", path: "/api/shopee/v1/orders/{id}/shipments", title: "Create a Shopee-like shipment", pathParams: [orderID],
    summary: "A shipment adds tracking and pickup details to a READY_TO_SHIP order or allocated package.",
    body: '{\n  "shipping_provider": "provider_express",\n  "pickup_type": "PICKUP"\n}', outcome: "200 OK with a CREATED shipment and tracking number.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "shipment": { "id": "shp_…", "tracking_number": "GX…", "status": "CREATED" } }\n}',
  }),
  endpoint({
    id: "shopee-list-webhooks", group: "Webhooks", contract: "shopee", method: "GET", path: "/api/shopee/v1/webhooks", title: "List Shopee-like callbacks",
    summary: "Read callbacks using Shopee-like event category names.", outcome: "200 OK with webhook_list.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "webhook_list": [{ "webhook_id": "wh_…", "event_types": ["order_status_update"] }] }\n}',
  }),
  endpoint({
    id: "shopee-create-webhook", group: "Webhooks", contract: "shopee", method: "POST", path: "/api/shopee/v1/webhooks", title: "Register a Shopee-like callback",
    summary: "Subscribe to provider categories; the simulator maps them to durable domain events.",
    body: '{\n  "callback_url": "https://example.com/hooks/shopee",\n  "event_types": ["order_status_update", "logistics_status_update"]\n}', outcome: "200 OK. An omitted secret is returned once.",
    response: '{\n  "error": "",\n  "message": "success",\n  "response": { "webhook_id": "wh_…", "event_types": ["order_status_update"], "secret": "whsec_…" }\n}',
  }),

  endpoint({
    id: "tokopedia-search-products", group: "Products", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/products/search", title: "Search Tokopedia-like products",
    summary: "Search provider products with opaque page tokens; send a returned token unchanged for the next page.", body: '{\n  "page_size": 20,\n  "keyword": "mug"\n}', outcome: "200 OK in a Partner Center-style envelope.",
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
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "orders": [{ "order_id": "ord_…", "order_status": "ON_HOLD", "payment_status": "PAID" }], "next_page_token": "", "has_more": false }\n}',
  }),
  endpoint({
    id: "tokopedia-get-order", group: "Orders", contract: "tokopedia", method: "GET", path: "/api/tokopedia/v202309/orders/{id}", title: "Get a Tokopedia-like order", pathParams: [orderID],
    summary: "Inspect lifecycle status, payment, line items, and package before changing the order.", outcome: "200 OK with order detail.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "order_id": "ord_…", "order_status": "ON_HOLD", "line_items": [] }\n}',
  }),
  endpoint({
    id: "tokopedia-pack-order", group: "Orders", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/pack", title: "Pack a Tokopedia-like order", pathParams: [orderID],
    summary: "Move a paid ON_HOLD order into AWAITING_SHIPMENT. Payment is verified in the control plane.", outcome: "200 OK with AWAITING_SHIPMENT status.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "order_id": "ord_…", "order_status": "AWAITING_SHIPMENT" }\n}',
  }),
  endpoint({
    id: "tokopedia-handover-order", group: "Orders", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/handover", title: "Hand over a packed order", pathParams: [orderID],
    summary: "Move AWAITING_SHIPMENT to AWAITING_COLLECTION before shipment creation.", outcome: "200 OK with AWAITING_COLLECTION status.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "order_id": "ord_…", "order_status": "AWAITING_COLLECTION" }\n}',
  }),
  endpoint({
    id: "tokopedia-cancel-order", group: "Orders", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/cancel", title: "Cancel a Tokopedia-like order", pathParams: [orderID],
    summary: "Cancel an eligible, unshipped order with a supported customer reason.", body: '{\n  "reason": "CHANGE_OF_MIND"\n}', outcome: "200 OK with CANCEL status.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "order_id": "ord_…", "order_status": "CANCEL" }\n}',
  }),
  endpoint({
    id: "tokopedia-create-shipment", group: "Fulfillment", contract: "tokopedia", method: "POST", path: "/api/tokopedia/v202309/orders/{id}/shipments", title: "Create a Tokopedia-like shipment", pathParams: [orderID],
    summary: "Add tracking and pickup details after the provider order is AWAITING_COLLECTION.", body: '{\n  "shipping_provider": "provider_express",\n  "pickup_type": "PICKUP"\n}', outcome: "200 OK with a CREATED shipment.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "shipment": { "id": "shp_…", "tracking_number": "GX…", "status": "CREATED" } }\n}',
  }),
  endpoint({
    id: "tokopedia-configure-webhook", group: "Webhooks", contract: "tokopedia", method: "PUT", path: "/api/tokopedia/v202309/webhooks", title: "Configure a Tokopedia-like callback",
    summary: "Configure provider notification categories. Deliveries carry a numeric type and Authorization HMAC.",
    body: '{\n  "callback_url": "https://example.com/hooks/tokopedia",\n  "event_types": ["ORDER_STATUS_CHANGE", "PACKAGE_UPDATE"]\n}', outcome: "200 OK. The generated secret is shown once.",
    response: '{\n  "code": 0,\n  "message": "success",\n  "data": { "webhook_id": "wh_…", "event_types": ["ORDER_STATUS_CHANGE"], "secret": "whsec_…" }\n}',
  }),
];

export const ENDPOINT_BY_ID = Object.fromEntries(
  ENDPOINTS.map((value) => [value.id, value]),
) as Record<string, PortalEndpoint>;
