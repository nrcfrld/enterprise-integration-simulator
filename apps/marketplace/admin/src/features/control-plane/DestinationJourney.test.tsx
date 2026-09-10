// @vitest-environment jsdom
import "@/test/setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneApp } from "./ControlPlaneApp";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ API_BASE_URL: "http://localhost:18080", controlPlaneRequest: request }));
const shops = [
  { id: "shop_a", name: "A", provider_profile: "SHOPEE_LIKE", status: "ACTIVE" },
  { id: "shop_b", name: "B", provider_profile: "SHOPEE_LIKE", status: "ACTIVE" },
];
function Position() { const location = useLocation(), navigate = useNavigate(); return <><output data-testid="position">{location.pathname + location.search}</output><button onClick={() => navigate(-1)}>Browser Back</button></>; }
function open(path: string) { return render(<MemoryRouter initialEntries={[path]}><ControlPlaneApp /><Position /></MemoryRouter>); }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("marketplace-session", JSON.stringify({ token: "token", user: { id: "user", email: "user@test", role: "OPERATOR" } }));
  sessionStorage.setItem("marketplace:selected-shop", "shop_a");
  request.mockReset().mockImplementation((path: string) => {
    if (path === "/control/v1/shops") return Promise.resolve({ data: shops });
    if (path === "/control/v1/orders/ord_b") return Promise.resolve({ id: "ord_b", shop_id: "shop_b", order_number: "SIM-B", status: "UNPAID", fulfillment: { warehouse_id: "wh_b", warehouse_name: "B warehouse" }, items: [], packages: [], shipments: [] });
    if (path === "/control/v1/warehouses/wh_b") return Promise.resolve({ id: "wh_b", shop_id: "shop_b", name: "B warehouse", inventory: [] });
    if (path === "/control/v1/maintenance") return Promise.resolve({ enabled: false });
    if (path.endsWith("/scenario")) return Promise.resolve({});
    return Promise.resolve({ data: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 1 } });
  });
});
it("restores the bookmarked shop, endpoint and ID; guide links and Back select exact lessons", async () => {
  open("/docs/simulator?shop=shop_b&endpoint=shopee-get-order&resource_id=ord_b");
  await waitFor(() => expect(screen.getByLabelText("Selected shop context")).toHaveTextContent("shop_b"));
  expect(screen.getByDisplayValue("ord_b")).toBeVisible();
  fireEvent.click(screen.getByRole("link", { name: "Errors & limits" }));
  expect(screen.getByTestId("position")).toHaveTextContent("/docs/errors");
  fireEvent.click(screen.getByRole("button", { name: "Browser Back" }));
  expect(screen.getByDisplayValue("ord_b")).toBeVisible();
  fireEvent.click(screen.getByRole("link", { name: "Back to console" }));
  fireEvent.click(screen.getByRole("link", { name: "Integration Guide" }));
  expect(screen.getByTestId("position")).toHaveTextContent("/docs/start");
  expect(screen.getByRole("link", { name: "Start here" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("position")).not.toHaveTextContent("secret");
});
it("restores a detail, follows its warehouse, and returns through browser history", async () => {
  open("/orders?shop=shop_b&detail=order&resource=ord_b");
  const dialog = await screen.findByRole("dialog", { name: "order details" });
  await within(dialog).findByRole("heading", { name: "SIM-B" });
  fireEvent.click(within(dialog).getByRole("button", { name: /B warehouse/ }));
  await screen.findByRole("dialog", { name: "warehouse details" });
  expect(screen.getByTestId("position")).toHaveTextContent("resource=wh_b");
  fireEvent.click(screen.getByRole("button", { name: "Back to previous resource" }));
  await screen.findByRole("dialog", { name: "order details" });
  expect(screen.getByTestId("position")).toHaveTextContent("resource=ord_b");
});
it("does not expose actions for a detail from a different selected shop", async () => {
  open("/orders?shop=shop_a&detail=order&resource=ord_b");
  expect(await screen.findByRole("alert")).toHaveTextContent("different shop");
  expect(screen.queryByRole("button", { name: "Pay" })).not.toBeInTheDocument();
});
it("searches all records in the URL-selected shop and retains filters in its URL", async () => {
  open("/orders?shop=shop_b");
  const input = await screen.findByLabelText("Order ID or number");
  fireEvent.change(input, { target: { value: "SIM-B" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(request).toHaveBeenCalledWith("/control/v1/shops/shop_b/orders?page=1&limit=20&q=SIM-B", "token"));
  expect(screen.getByTestId("position")).toHaveTextContent("shop=shop_b&q=SIM-B");
});
it("dashboard and empty shipment shortcuts open the promised provider operation", async () => {
  open("/dashboard?shop=shop_b");
  fireEvent.click(await screen.findByRole("button", { name: "Open API Simulator" }));
  expect(screen.getByTestId("position")).toHaveTextContent("endpoint=shopee-list-orders");
  fireEvent.click(screen.getByRole("link", { name: "Back to console" }));
  fireEvent.click(screen.getByRole("link", { name: "Shipments" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open API Simulator" }));
  expect(screen.getByTestId("position")).toHaveTextContent("endpoint=shopee-create-shipment");
});
