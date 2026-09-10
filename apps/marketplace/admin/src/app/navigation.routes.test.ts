import { describe, expect, it } from "vitest";
import {
  CONTROL_PAGES,
  CONTROL_PATHS,
  PAGEABLE_CONTROL_PAGES,
  PAGE_BY_PATH,
  controlPageForPath,
} from "./navigation";

describe("control-plane routes", () => {
  it("gives every page exactly one stable, reversible path", () => {
    const paths = CONTROL_PAGES.map((page) => CONTROL_PATHS[page]);

    expect(new Set(paths)).toHaveLength(CONTROL_PAGES.length);
    for (const page of CONTROL_PAGES) {
      expect(PAGE_BY_PATH[CONTROL_PATHS[page]]).toBe(page);
    }
  });

  it("only paginates collection resources", () => {
    expect([...PAGEABLE_CONTROL_PAGES]).toEqual([
      "Webhooks",
      "Shops",
      "Products",
      "Warehouses",
      "Orders",
      "Packages",
      "Shipments",
      "Credentials",
      "Deliveries",
      "Events",
      "Users",
    ]);
    expect(PAGEABLE_CONTROL_PAGES.has("Dashboard")).toBe(false);
    expect(PAGEABLE_CONTROL_PAGES.has("Documentation")).toBe(false);
  });

  it("recognizes every documentation sub-route as the documentation page", () => {
    expect(controlPageForPath("/docs/start")).toBe("Documentation");
    expect(controlPageForPath("/docs/simulator")).toBe("Documentation");
    expect(controlPageForPath("/orders")).toBe("Orders");
  });
});
