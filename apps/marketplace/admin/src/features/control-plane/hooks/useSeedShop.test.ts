// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSeedShop } from "./useSeedShop";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));
afterEach(() => vi.restoreAllMocks());

it("names the affected shop and losses before reset, and sends no request on cancellation", async () => {
  request.mockClear();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { result } = renderHook(() => useSeedShop({ shopID: "shop_2", shopName: "Training shop", token: "token", onRefresh: vi.fn(), onNotice: vi.fn(), onError: vi.fn() }));
  await act(async () => { await result.current.resetShop(); });
  const warning = confirm.mock.calls[0][0];
  expect(warning).toContain("Training shop (shop_2)");
  expect(warning).toContain("credentials, webhook registrations and delivery history, orders, packages, shipments, events, products and inventory");
  expect(warning).toContain("Existing API credentials stop working");
  expect(warning).toContain("Warehouse definitions and scenario settings remain");
  expect(warning).toContain("This cannot be undone");
  expect(request).not.toHaveBeenCalled();
  expect(result.current.isSeeding).toBe(false);
});
