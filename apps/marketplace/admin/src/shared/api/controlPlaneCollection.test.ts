import { describe, expect, it, vi } from "vitest";
import { controlPlaneCollection } from "./controlPlaneCollection";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./controlPlaneClient", () => ({ controlPlaneRequest: request }));
describe("complete control collections", () => {
  it.each(["shops", "products", "warehouses"])("continues beyond the first %s page", async resource => {
    request.mockReset().mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => ({ id: `${resource}_${i + 1}` })), pagination: { page: 1, limit: 100, total_pages: 2 } })
      .mockResolvedValueOnce({ data: [{ id: `${resource}_101` }], pagination: { page: 2, limit: 100, total_pages: 2 } });
    const rows = await controlPlaneCollection<{ id: string }>(`/control/v1/${resource}?limit=100`, "token");
    expect(rows).toHaveLength(101);
    expect(rows.at(-1)?.id).toBe(`${resource}_101`);
    expect(request).toHaveBeenLastCalledWith(`/control/v1/${resource}?limit=100&page=2`, "token");
  });
  it("does not silently present partial choices if a later page fails", async () => {
    request.mockReset().mockResolvedValueOnce({ data: [{ id: "first" }], pagination: { page: 1, limit: 20, total_pages: 2 } }).mockRejectedValueOnce(new Error("second page unavailable"));
    await expect(controlPlaneCollection("/shops", "token")).rejects.toThrow("second page unavailable");
  });
});
