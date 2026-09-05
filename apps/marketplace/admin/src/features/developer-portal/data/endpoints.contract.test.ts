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

    expect(responseFor("shopee-list-products")).toContain('"has_next_page"');
    expect(responseFor("shopee-list-orders")).toContain('"more"');
    expect(responseFor("shopee-list-orders")).not.toContain('"has_next_page"');
    expect(responseFor("tokopedia-search-products")).toContain('"next_page_token"');
    expect(responseFor("tokopedia-search-orders")).toContain('"has_more"');
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
