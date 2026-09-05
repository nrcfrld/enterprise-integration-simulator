// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlPlaneSession } from "@/shared/types/controlPlane";
import { ControlPlaneApp } from "./ControlPlaneApp";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  API_BASE_URL: "http://localhost:18080",
  controlPlaneRequest: requestMock,
}));

const session: ControlPlaneSession = {
  token: "session-token",
  user: { id: "user_1", email: "admin@example.test", role: "ADMIN" },
};

const shop = {
  id: "shop_1",
  name: "Test shop",
  status: "ACTIVE",
  provider_profile: "SHOPEE_LIKE",
};

const tokopediaShop = {
  id: "shop_2",
  name: "Tokopedia shop",
  status: "ACTIVE",
  provider_profile: "TOKOPEDIA_LIKE",
};

function mockControlPlaneRequests() {
  requestMock.mockImplementation((path: string) => {
    if (path === "/control/v1/shops") return Promise.resolve({ data: [shop] });
    if (path.endsWith("/reset")) {
      return Promise.resolve({ products_seeded: 12, orders_seeded: 4 });
    }
    if (path.includes("/products")) return Promise.resolve({ data: [] });
    if (path.includes("/orders")) return Promise.resolve({ data: [] });
    if (path.startsWith("/control/v1/dashboard")) {
      return Promise.resolve({ shops: 1, orders: 0, failed_deliveries: 0 });
    }
    return Promise.resolve({ data: [] });
  });
}

describe("ControlPlaneApp critical session and seed flows", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("marketplace-session", JSON.stringify(session));
    requestMock.mockReset();
    mockControlPlaneRequests();
  });

  it("resets the selected shop and reports the seeded records", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/products"]}>
        <ControlPlaneApp />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Reset to seed" }),
    );

    expect(confirmMock).toHaveBeenCalledWith("Reset this shop to its seed data?");
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/control/v1/shops/shop_1/reset",
        "session-token",
        { method: "POST" },
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Seed complete: 12 products and 4 orders.",
    );
    expect(screen.getByRole("button", { name: "Reset to seed" })).toBeEnabled();
    confirmMock.mockRestore();
  });

  it("clears an invalid session and returns to the sign-in screen", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ControlPlaneApp />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeVisible();

    window.dispatchEvent(new Event("marketplace:session-invalid"));

    expect(
      await screen.findByRole("heading", { name: "Enter the simulator" }),
    ).toBeVisible();
    expect(localStorage.getItem("marketplace-session")).toBeNull();
  });

  it("keeps route navigation and active menu state synchronized", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/products"]}>
        <ControlPlaneApp />
      </MemoryRouter>,
    );

    const productsLink = screen.getByRole("link", { name: "Products" });
    expect(productsLink).toHaveClass("menu-active");
    await user.click(screen.getByRole("link", { name: "Orders" }));

    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Orders" })).toHaveClass("menu-active");
    expect(productsLink).not.toHaveClass("menu-active");
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/control/v1/shops/shop_1/orders?page=1&limit=20",
        "session-token",
      ),
    );
  });

  it("signs in, persists the session, and signs out", async () => {
    localStorage.clear();
    requestMock.mockImplementation((path: string) => {
      if (path === "/control/v1/auth/login") return Promise.resolve(session);
      if (path === "/control/v1/shops") return Promise.resolve({ data: [shop] });
      if (path.startsWith("/control/v1/dashboard")) return Promise.resolve({ shops: 1 });
      if (path === "/control/v1/maintenance") return Promise.resolve({ enabled: false });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ControlPlaneApp />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Sign in →" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeVisible();
    expect(JSON.parse(localStorage.getItem("marketplace-session") || "{}")).toEqual(session);

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Enter the simulator" })).toBeVisible();
    expect(localStorage.getItem("marketplace-session")).toBeNull();
  });

  it("switches order provider scope to the first matching shop", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/control/v1/shops") return Promise.resolve({ data: [shop, tokopediaShop] });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/orders"]}>
        <ControlPlaneApp />
      </MemoryRouter>,
    );

    const selector = await screen.findByLabelText("Current shop");
    await user.click(screen.getByRole("button", { name: "Tokopedia & TikTok Shop" }));
    expect(selector).toHaveValue("shop_2");
    expect(screen.getByText("Tokopedia & TikTok Shop", { selector: "span.provider-badge" })).toBeVisible();
  });

  it("opens and closes product detail and create form", async () => {
    const product = { id: "product_1", sku: "SKU-1", name: "Travel Bag", status: "ACTIVE", stock: 4 };
    requestMock.mockImplementation((path: string) => {
      if (path === "/control/v1/shops") return Promise.resolve({ data: [shop] });
      if (path === "/control/v1/shops/shop_1/products/product_1") return Promise.resolve(product);
      if (path.includes("/products")) return Promise.resolve({ data: [product] });
      if (path.includes("/warehouses")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/products"]}>
        <ControlPlaneApp />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "View product" }));
    expect(await screen.findByRole("dialog", { name: "product details" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Travel Bag" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("dialog", { name: "product details" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ New product" }));
    expect(screen.getByRole("heading", { name: "Create product" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Create product" })).not.toBeInTheDocument();
  });

  it("refreshes shops and resources after a form saves", async () => {
    requestMock.mockImplementation((path: string, _token?: string, options?: RequestInit) => {
      if (path === "/control/v1/shops") return Promise.resolve({ data: [shop] });
      if (path.includes("/credentials") && options?.method === "POST") {
        return Promise.resolve({
          id: "credential_1",
          client_id: "client_once",
          client_secret: "sec_once",
          access_token: "acc_once",
        });
      }
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/credentials"]}>
        <ControlPlaneApp />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "+ New credential" }));
    await user.click(screen.getByRole("button", { name: /^Create/ }));
    const dialog = await screen.findByRole("dialog", { name: "Credential created" });
    expect(dialog).toHaveTextContent("client_once");
    expect(dialog).toHaveTextContent("sec_once");
    expect(dialog).toHaveTextContent("acc_once");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(requestMock.mock.calls.filter(([path]) => path === "/control/v1/shops").length).toBeGreaterThan(1);

    await user.click(screen.getByRole("button", { name: "I saved these credentials" }));
    expect(screen.queryByRole("dialog", { name: "Credential created" })).not.toBeInTheDocument();
  });
});
