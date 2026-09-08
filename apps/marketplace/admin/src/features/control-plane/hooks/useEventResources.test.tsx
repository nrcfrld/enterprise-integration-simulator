// @vitest-environment jsdom
import "@/test/setup";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { useControlPlaneResources } from "./useControlPlaneResources";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));

it("requests filtered event pages and discards late results from the previous shop", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  request.mockImplementation((path: string) => {
    if (path === "/control/v1/shops") return Promise.resolve({ data: [{ id: "shop_a", name: "A" }, { id: "shop_b", name: "B" }] });
    if (path.includes("shop_a/events") && path.includes("resource_type")) return new Promise(resolve => { resolveOld = resolve; });
    return Promise.resolve({ data: [{ id: path.includes("shop_b") ? "event_b" : "event_a" }] });
  });
  const { result } = renderHook(() => {
    const resources = useControlPlaneResources("Events", "token");
    const [, setParams] = useSearchParams();
    return { ...resources, setParams };
  }, { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> });
  await waitFor(() => expect(result.current.data?.data?.[0].id).toBe("event_a"));
  act(() => result.current.setParams({ resource_type: "shipment", aggregate_id: "shipment_a", event_type: "shipment.returned" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/control/v1/shops/shop_a/events?page=1&limit=20&resource_type=shipment&aggregate_id=shipment_a&event_type=shipment.returned", "token"));
  expect(result.current.data).toBeNull();
  act(() => result.current.setShopID("shop_b"));
  await waitFor(() => expect(result.current.data?.data?.[0].id).toBe("event_b"));
  await act(async () => resolveOld({ data: [{ id: "old_shop_event" }] }));
  expect(result.current.data?.data?.[0].id).toBe("event_b");
  act(() => result.current.setListPage(2));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/control/v1/shops/shop_b/events?page=2&limit=20&resource_type=shipment&aggregate_id=shipment_a&event_type=shipment.returned", "token"));
});
