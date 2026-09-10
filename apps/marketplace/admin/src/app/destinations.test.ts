import { describe, expect, it } from "vitest";
import { controlDestination, readPortalDestination } from "./destinations";

describe("developer portal destinations", () => {
  it("uses canonical route segments for documentation pages", () => {
    expect(controlDestination("Documentation", "shop_1", { section: "products" })).toBe("/docs/products?shop=shop_1");
    expect(controlDestination("Documentation", "shop_1", { section: "try", endpoint: "shopee-list-orders" })).toBe("/docs/simulator?shop=shop_1&endpoint=shopee-list-orders");
    expect(controlDestination("Documentation")).toBe("/docs/start");
  });

  it("reads canonical paths and keeps legacy section bookmarks compatible", () => {
    expect(readPortalDestination("/docs/orders", new URLSearchParams("shop=shop_1"))).toEqual({ section: "orders", endpoint: undefined, resourceID: undefined, packageID: undefined });
    expect(readPortalDestination("/docs", new URLSearchParams("section=webhooks"))?.section).toBe("webhooks");
    expect(readPortalDestination("/docs/not-a-page", new URLSearchParams())).toBeUndefined();
  });
});
