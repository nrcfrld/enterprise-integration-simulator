import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "./endpoints";

describe("developer portal endpoint catalogue", () => {
  it("makes every public provider family discoverable and executable", () => {
    expect(ENDPOINTS.filter((endpoint) => endpoint.contract === "shared")).toHaveLength(5);
    expect(ENDPOINTS.filter((endpoint) => endpoint.contract === "shopee")).toHaveLength(11);
    expect(ENDPOINTS.filter((endpoint) => endpoint.contract === "tokopedia")).toHaveLength(9);
    expect(ENDPOINTS.every((endpoint) => endpoint.response && endpoint.errorResponse)).toBe(true);
    expect(ENDPOINTS.map((endpoint) => endpoint.path)).toContain("/api/shopee/v1/orders/{id}/shipments");
    expect(ENDPOINTS.map((endpoint) => endpoint.path)).toContain("/api/tokopedia/v202309/orders/{id}/shipments");
  });
});
