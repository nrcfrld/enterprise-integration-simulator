// @vitest-environment jsdom
import "@/test/setup";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { useControlPlaneResources } from "./hooks/useControlPlaneResources";
import { ControlForm } from "./components/ControlForm";
import { WebhookSettings } from "./components/WebhookSettings";
import type { ReactNode } from "react";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
beforeEach(() => request.mockReset());

it("selects the 21st existing shop with provider intact and restores it on reload", async () => {
  const first = Array.from({ length: 20 }, (_, index) => ({ id: `shop_${index + 1}`, name: `Shop ${index + 1}`, provider_profile: "SHOPEE_LIKE" }));
  const last = { id: "shop_21", name: "Tokopedia 21", provider_profile: "TOKOPEDIA_LIKE" };
  request.mockImplementation((path: string) => {
    if (path === "/control/v1/shops") return Promise.resolve({ data: first, pagination: { page: 1, limit: 20, total_pages: 2 } });
    if (path === "/control/v1/shops?page=2&limit=20") return Promise.resolve({ data: [last], pagination: { page: 2, limit: 20, total_pages: 2 } });
    return Promise.resolve({ data: [] });
  });
  const hook = renderHook(() => useControlPlaneResources("Products", "token"), { wrapper });
  await waitFor(() => expect(hook.result.current.shops).toHaveLength(21));
  act(() => hook.result.current.setShopID("shop_21"));
  expect(hook.result.current.selectedShop?.provider_profile).toBe("TOKOPEDIA_LIKE");
  await waitFor(() => expect(request).toHaveBeenCalledWith("/control/v1/shops/shop_21/products?page=1&limit=20", "token"));
  hook.unmount();
  const restored = renderHook(() => useControlPlaneResources("Documentation", "token"), { wrapper });
  await waitFor(() => expect(restored.result.current.selectedShop?.id).toBe("shop_21"));
  expect(restored.result.current.selectedShop?.provider_profile).toBe("TOKOPEDIA_LIKE");
});

it("offers the 101st warehouse when creating a product", async () => {
  request.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, index) => ({ id: `wh_${index + 1}`, name: `Warehouse ${index + 1}`, code: `WH-${index + 1}` })), pagination: { page: 1, limit: 100, total_pages: 2 } })
    .mockResolvedValueOnce({ data: [{ id: "wh_101", name: "Far warehouse", code: "WH-101" }], pagination: { page: 2, limit: 100, total_pages: 2 } });
  render(<ControlForm kind="product" shopID="shop_1" token="token" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(await screen.findByRole("option", { name: /Far warehouse/ })).toHaveValue("wh_101");
});

it("offers the 101st product when simulating a custom order", async () => {
  request.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, index) => ({ id: `prd_${index + 1}`, name: `Product ${index + 1}`, sku: `SKU-${index + 1}`, stock: 5 })), pagination: { page: 1, limit: 100, total_pages: 2 } })
    .mockResolvedValueOnce({ data: [{ id: "prd_101", name: "Last mug", sku: "MUG-101", stock: 5 }], pagination: { page: 2, limit: 100, total_pages: 2 } });
  render(<ControlForm kind="order" shopID="shop_1" token="token" onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Custom/i }));
  expect(await screen.findByRole("option", { name: /Last mug/ })).toHaveValue("prd_101");
});

it("paginates webhooks with true totals and edits the later-page registration", () => {
  const onPageChange = vi.fn(), onForm = vi.fn();
  const hook = { id: "wh_21", url: "http://receiver/21", enabled: true, subscribed_events: ["order.paid"] };
  const props = { shopID: "shop_1", token: "token", onForm, onNotice: vi.fn(), onRefresh: vi.fn(), onPageChange };
  const { rerender } = render(<WebhookSettings {...props} listPage={1} data={{ data: [], pagination: { page: 1, limit: 20, total: 21, total_pages: 2 } }} />);
  expect(screen.getByText("21 registered")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(onPageChange).toHaveBeenCalledWith(2);
  rerender(<WebhookSettings {...props} listPage={2} data={{ data: [hook], pagination: { page: 2, limit: 20, total: 21, total_pages: 2 } }} />);
  expect(screen.getByText("1 of 1 endpoints on this page enabled")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(onForm).toHaveBeenCalledWith({ kind: "webhook", initial: hook });
});
