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

function mockControlPlaneRequests() {
  requestMock.mockImplementation((path: string) => {
    if (path === "/control/v1/shops") return Promise.resolve({ data: [shop] });
    if (path.endsWith("/reset")) {
      return Promise.resolve({ products_seeded: 12, orders_seeded: 4 });
    }
    if (path.includes("/products")) return Promise.resolve({ data: [] });
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
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
});
