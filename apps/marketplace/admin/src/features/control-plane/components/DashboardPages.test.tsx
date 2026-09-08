// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./DashboardPages";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

const props = {
  data: null,
  shopID: "",
  token: "session-token",
  role: "OPERATOR" as const,
  onNavigate: vi.fn(),
  onForm: vi.fn(),
  onSeed: vi.fn().mockResolvedValue(undefined),
  isSeeding: false,
};

describe("Dashboard setup and maintenance states", () => {
  beforeEach(() => {
    requestMock.mockReset();
    props.onNavigate.mockReset();
    props.onForm.mockReset();
    props.onSeed.mockReset().mockResolvedValue(undefined);
  });

  it("only allows shop creation before a shop is selected", async () => {
    const user = userEvent.setup();
    render(<Dashboard {...props} />);

    const createShop = screen.getByRole("button", { name: "Create shop →" });
    expect(createShop).toBeEnabled();
    expect(screen.getByRole("button", { name: "Manage products →" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Configure →" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "View orders and events →" })).toBeDisabled();

    await user.click(createShop);
    expect(props.onForm).toHaveBeenCalledWith({ kind: "shop" });
  });

  it("locks the catalog action while seed data is being prepared", () => {
    render(<Dashboard {...props} shopID="shop_1" isSeeding />);

    expect(screen.getByRole("button", { name: "Resetting…" })).toBeDisabled();
  });

  it("loads and toggles the admin-only maintenance switch", async () => {
    requestMock
      .mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce({ enabled: true });
    const user = userEvent.setup();
    render(<Dashboard {...props} role="ADMIN" />);

    const toggle = screen.getByRole("checkbox", { name: "Enable maintenance mode" });
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Checking current status…")).toBeVisible();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.getByText("Maintenance disabled")).toBeVisible();
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByText("Public API paused")).toBeVisible();
    expect(screen.getByText("All public endpoints return HTTP 503")).toBeVisible();
    expect(toggle).toHaveAccessibleName("Disable maintenance mode");
    expect(requestMock).toHaveBeenLastCalledWith(
      "/control/v1/maintenance",
      "session-token",
      { method: "PUT", body: JSON.stringify({ enabled: true }) },
    );
  });

  it("shows an unknown maintenance state and allows a read retry", async () => {
    requestMock.mockRejectedValue(new Error("Maintenance status unavailable"));
    render(<Dashboard {...props} role="ADMIN" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Maintenance status unavailable",
    );
    expect(screen.getByRole("checkbox", { name: "Enable maintenance mode" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry maintenance status" })).toBeEnabled();
  });
});

it("marks actual configuration without claiming secret possession or successful integration", async () => {
  const { container } = render(<Dashboard {...props} shopID="shop_1" data={{ shops: 2, orders: 50, setup: { ready: true, seeded: false, products: 1, credential_active: true, webhook_configured: true, webhook_enabled: true } }} />);
  expect(container.querySelectorAll("ol > li.complete")).toHaveLength(4);
  expect(screen.getByText("All accessible shops")).toBeVisible();
  expect(screen.getByText("Selected shop configuration")).toBeVisible();
  expect(screen.getByText(/Configuration is present/)).toHaveTextContent("still need verification");
  expect(screen.getByText(/These checks are not tracked/)).toBeVisible();
  expect(screen.queryByText("Simulator online")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Test in API Simulator" }));
  expect(props.onNavigate).toHaveBeenCalledWith("Documentation");
});
