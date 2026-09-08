import { describe, expect, it } from "vitest";
import openapi from "../../../../../openapi/openapi.yaml?raw";
import { ENDPOINTS, MUTATION_METHODS } from "./endpoints";

const HTTP_METHOD = /^(get|post|put|patch|delete)$/;

function publicOperations(document: string) {
  const operations = new Map<string, string>();
  let path: string | null = null;
  let operationKey: string | null = null;

  for (const line of document.split("\n")) {
    if (/^[^\s]/.test(line) && line !== "paths:") {
      path = null;
      operationKey = null;
    }
    const pathMatch = line.match(/^ {2}(\/[^:]+):\s*$/);
    if (pathMatch) {
      path = /^\/api\/(?:v1|shopee\/v1|tokopedia\/v202309)(?:\/|$)/.test(pathMatch[1])
        ? pathMatch[1]
        : null;
      operationKey = null;
      continue;
    }

    const methodMatch = line.match(/^ {4}([a-z]+):\s*$/);
    if (path && methodMatch && HTTP_METHOD.test(methodMatch[1])) {
      operationKey = `${methodMatch[1].toUpperCase()} ${path}`;
      operations.set(operationKey, `${line}\n`);
      continue;
    }

    if (operationKey) {
      operations.set(operationKey, `${operations.get(operationKey)}${line}\n`);
    }
  }

  return operations;
}

function componentSchema(document: string, name: string) {
  const lines = document.split("\n");
  const start = lines.findIndex((line) => line === `    ${name}:`);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^ {4}[A-Za-z][A-Za-z0-9]*:\s*$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

function operationSchema(document: string, operation: string) {
  const references = [...operation.matchAll(/#\/components\/schemas\/([A-Za-z0-9]+)/g)]
    .map((match) => componentSchema(document, match[1]));
  return [operation, ...references].join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("developer portal endpoint contract metadata", () => {
  it("documents all optional and required ShipmentInput properties for both providers", () => {
    const schema = componentSchema(openapi, "ShipmentInput");
    const fields = [...schema.matchAll(/^ {8}([a-z_]+):/gm)].map(match => match[1]).sort();
    for (const provider of ["shopee", "tokopedia"]) {
      const endpoint = ENDPOINTS.find(endpoint => endpoint.id === `${provider}-create-shipment`)!;
      expect(endpoint.bodyFields!.map(field => field.name).sort()).toEqual(fields);
      expect(endpoint.bodyFields!.find(field => field.name === "package_id")?.required).toBe(false);
      expect(JSON.parse(endpoint.body!)).toHaveProperty("package_id");
    }
  });

  it("gives every operation a unique id, an absolute API path, and junior-friendly guidance", () => {
    expect(new Set(ENDPOINTS.map((endpoint) => endpoint.id))).toHaveLength(ENDPOINTS.length);
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.path).toMatch(/^\/api\//);
      expect(endpoint.title).not.toHaveLength(0);
      expect(endpoint.summary).not.toHaveLength(0);
      expect(endpoint.outcome).not.toHaveLength(0);
      expect(endpoint.response).not.toHaveLength(0);
      expect(endpoint.errorResponse).not.toHaveLength(0);
    }
  });

  it("documents a request body for every public mutation that needs one", () => {
    const bodylessMutations = new Set([
      "delete-webhook",
      "shopee-process-order",
      "shopee-ready-to-ship",
      "tokopedia-pack-order",
      "tokopedia-handover-order",
    ]);

    for (const endpoint of ENDPOINTS.filter((value) => MUTATION_METHODS.has(value.method))) {
      if (bodylessMutations.has(endpoint.id)) {
        expect(endpoint.body).toBeUndefined();
        continue;
      }
      expect(endpoint.body).toBeTruthy();
      expect(endpoint.bodyFields, endpoint.id).not.toHaveLength(0);
    }
  });

  it("provides field-level metadata for every documented request payload", () => {
    for (const endpoint of ENDPOINTS.filter((value) => value.body !== undefined)) {
      expect(endpoint.bodyFields, endpoint.id).not.toHaveLength(0);
      for (const field of endpoint.bodyFields ?? []) {
        expect(field.name).not.toHaveLength(0);
        expect(field.type).not.toHaveLength(0);
        expect(field.description).not.toHaveLength(0);
      }
    }
  });

  it("marks every state-changing provider operation as idempotent", () => {
    const readOnlyPosts = new Set([
      "tokopedia-search-products",
      "tokopedia-search-orders",
    ]);
    for (const endpoint of ENDPOINTS.filter((value) =>
      MUTATION_METHODS.has(value.method) && !readOnlyPosts.has(value.id),
    )) {
      expect(endpoint.idempotent, endpoint.id).toBe(true);
    }
    for (const endpoint of ENDPOINTS.filter((value) => readOnlyPosts.has(value.id))) {
      expect(endpoint.idempotent, endpoint.id).not.toBe(true);
    }
  });

  it("shows errors that match each endpoint instead of one generic provider error", () => {
    for (const endpoint of ENDPOINTS) {
      if (endpoint.id === "delete-webhook" || endpoint.id.startsWith("get-") || endpoint.id.includes("-get-")) {
        expect(endpoint.errorResponse.toLowerCase(), endpoint.id).toContain("not found");
      } else if (endpoint.group === "Webhooks" && endpoint.idempotent) {
        expect(endpoint.errorResponse, endpoint.id).toContain("event");
      } else if (endpoint.idempotent) {
        expect(endpoint.errorResponse.toLowerCase(), endpoint.id).toContain("transition");
      } else {
        expect(endpoint.errorResponse.toLowerCase(), endpoint.id).toMatch(/signature|credential/);
      }
    }
  });

  it("documents each provider's actual pagination vocabulary", () => {
    const responseFor = (id: string) => ENDPOINTS.find((endpoint) => endpoint.id === id)?.response ?? "";

    expect(responseFor("list-webhooks")).toContain('"pagination"');
    expect(responseFor("list-webhooks")).toContain('"has_next"');
    expect(responseFor("list-warehouses")).not.toContain('"pagination"');
    expect(responseFor("shopee-list-products")).toContain('"has_next_page"');
    expect(responseFor("shopee-list-orders")).toContain('"more"');
    expect(responseFor("shopee-list-orders")).not.toContain('"has_next_page"');
    expect(responseFor("tokopedia-search-products")).toContain('"next_page_token"');
    expect(responseFor("tokopedia-search-orders")).toContain('"has_more"');
  });

  it("documents shared webhook pagination independently from the unpaginated warehouse list", () => {
    const webhook = ENDPOINTS.find((endpoint) => endpoint.id === "list-webhooks")!;
    const warehouse = ENDPOINTS.find((endpoint) => endpoint.id === "list-warehouses")!;
    expect(webhook.query?.map((parameter) => parameter.name)).toEqual(["page", "limit"]);
    expect(warehouse.query).toBeUndefined();

    const operations = publicOperations(openapi);
    expect(operations.get("GET /api/v1/webhooks")).toMatch(/\bname:\s*page\b/);
    expect(operations.get("GET /api/v1/webhooks")).toMatch(/\bname:\s*limit\b/);
    expect(operations.get("GET /api/v1/warehouses")).not.toMatch(/\bname:\s*(?:page|limit)\b/);
    expect(componentSchema(openapi, "WebhookList")).toContain("pagination:");
    expect(componentSchema(openapi, "WarehouseList")).toContain("intentionally unpaginated");
  });

  it("labels Shopee time filters as inclusive creation-time bounds", () => {
    const endpoint = ENDPOINTS.find((entry) => entry.id === "shopee-list-orders")!;
    for (const name of ["time_from", "time_to"]) {
      const parameter = endpoint.query?.find((entry) => entry.name === name);
      expect(parameter?.label).toMatch(/^Created/);
      expect(parameter?.help).toContain("created");
      expect(parameter?.help).toContain("inclusive");
      expect(parameter?.help).toContain("does not filter update_time");
    }
    const operation = publicOperations(openapi).get("GET /api/shopee/v1/orders") ?? "";
    expect(operation).toContain("filter create_time, not update_time");
    expect(operation).toMatch(/time_from.*Inclusive lower bound for order create_time/);
    expect(operation).toMatch(/time_to.*Inclusive upper bound for order create_time/);
  });

  it("publishes real nested order-detail and shipment-create response shapes", () => {
    const expectedLine = ["allocated_quantity", "id", "price", "product_id", "product_name", "quantity", "remaining_quantity", "sku", "subtotal"];
    const expectedPackage = ["create_time", "package_id", "package_number", "package_status", "update_time"];
    const expectedDetailShipment = ["created_at", "delivered_at", "delivery_failure_reason", "failed_at", "id", "order_id", "package_id", "pickup_type", "returned_at", "returning_at", "shipped_at", "shipping_provider", "status", "tracking_number"];
    const expectedCreatedShipment = ["id", "order_id", "package_id", "pickup_type", "shipping_provider", "status", "tracking_number", "warehouse_id"];

    const shopee = JSON.parse(ENDPOINTS.find((entry) => entry.id === "shopee-get-order")!.response).response;
    const tokopedia = JSON.parse(ENDPOINTS.find((entry) => entry.id === "tokopedia-get-order")!.response).data;
    expect(Object.keys(shopee.item_list[0]).sort()).toEqual(expectedLine);
    expect(Object.keys(tokopedia.line_items[0]).sort()).toEqual(expectedLine);
    expect(Object.keys(shopee.package_list[0]).sort()).toEqual(expectedPackage);
    expect(Object.keys(tokopedia.package_list[0]).sort()).toEqual(expectedPackage);
    expect(Object.keys(shopee.shipment_list[0]).sort()).toEqual(expectedDetailShipment);
    expect(Object.keys(tokopedia.shipment_list[0]).sort()).toEqual(expectedDetailShipment);

    const shopeeCreated = JSON.parse(ENDPOINTS.find((entry) => entry.id === "shopee-create-shipment")!.response).response.shipment;
    const tokopediaCreated = JSON.parse(ENDPOINTS.find((entry) => entry.id === "tokopedia-create-shipment")!.response).data.shipment;
    expect(Object.keys(shopeeCreated).sort()).toEqual(expectedCreatedShipment);
    expect(Object.keys(tokopediaCreated).sort()).toEqual(expectedCreatedShipment);
    expect(componentSchema(openapi, "CreatedShipment")).toContain("warehouse_id:");
    expect(publicOperations(openapi).get("GET /api/shopee/v1/orders/{id}")).toContain("ShopeeOrderDetailResponse");
    expect(publicOperations(openapi).get("GET /api/tokopedia/v202309/orders/{id}")).toContain("TokopediaOrderDetailResponse");
    expect(publicOperations(openapi).get("POST /api/shopee/v1/orders/{id}/shipments")).toContain("ShopeeShipmentCreatedResponse");
    expect(publicOperations(openapi).get("POST /api/tokopedia/v202309/orders/{id}/shipments")).toContain("TokopediaShipmentCreatedResponse");
  });

  it("matches every public OpenAPI method and path exactly", () => {
    const documented = [...publicOperations(openapi).keys()].sort();
    const portal = ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort();

    expect(portal).toEqual(documented);
  });

  it("distinguishes Shopee API order IDs from display numbers throughout the workflow", () => {
    const shopee = ENDPOINTS.filter((entry) => entry.contract === "shopee");
    const list = JSON.parse(shopee.find((entry) => entry.id === "shopee-list-orders")!.response).response.order_list[0];
    const detail = JSON.parse(shopee.find((entry) => entry.id === "shopee-get-order")!.response).response;
    expect(list.order_id).toMatch(/^ord_/);
    expect(list.order_sn).toMatch(/^SIM-/);
    expect(list.order_id).not.toBe(list.order_sn);
    expect(detail.order_id).toBe(list.order_id);
    expect(detail.order_sn).toBe(list.order_sn);

    for (const entry of shopee.filter((value) => value.path.includes("/orders/{id}"))) {
      expect(entry.pathParams?.[0].help, entry.id).toContain("Copy order_id");
      expect(entry.pathParams?.[0].help, entry.id).toContain("order_sn is the display order number and cannot be used as {id}");
    }
    for (const id of ["shopee-cancel-order", "shopee-process-order", "shopee-ready-to-ship"]) {
      const result = JSON.parse(shopee.find((entry) => entry.id === id)!.response).response;
      expect(result.order_id, id).toBe(list.order_id);
      expect(result, id).not.toHaveProperty("order_sn");
    }
  });

  it("keeps request parameters, payload shape, and idempotency metadata aligned with OpenAPI", () => {
    const operations = publicOperations(openapi);

    for (const endpoint of ENDPOINTS) {
      const key = `${endpoint.method} ${endpoint.path}`;
      const operation = operations.get(key);
      expect(operation, key).toBeDefined();
      expect(operation, `${key} operationId`).toMatch(/\boperationId:/);
      expect(operation?.includes("#/components/parameters/IdempotencyKey"), `${key} idempotency`).toBe(Boolean(endpoint.idempotent));
      expect(operation?.includes("requestBody:"), `${key} request body`).toBe(endpoint.body !== undefined);

      const placeholders = [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
      expect(endpoint.pathParams?.map((parameter) => parameter.name).sort() ?? [], `${key} path parameters`).toEqual(placeholders);

      for (const parameter of endpoint.query ?? []) {
        expect(operation, `${key} query parameter ${parameter.name}`).toMatch(
          new RegExp(`\\bname:\\s*${escapeRegExp(parameter.name)}(?:[,}\\s])`),
        );
      }

      if (endpoint.body) {
        const schema = operationSchema(openapi, operation ?? "");
        const body = JSON.parse(endpoint.body) as Record<string, unknown>;
        for (const field of Object.keys(body)) {
          expect(schema, `${key} body field ${field}`).toMatch(
            new RegExp(`\\b${escapeRegExp(field)}:`),
          );
        }
      }
    }
  });
});
