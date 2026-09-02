import { describe, expect, it } from "vitest";
import { ENDPOINTS, MUTATION_METHODS } from "./endpoints";

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
    }
  });
});
