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
    expect(screen.getByRole("button", { name: "Seed data →" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Configure →" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "View orders and events →" })).toBeDisabled();

    await user.click(createShop);
    expect(props.onForm).toHaveBeenCalledWith({ kind: "shop" });
  });

  it("locks the catalog action while seed data is being prepared", () => {
    render(<Dashboard {...props} shopID="shop_1" isSeeding />);

    expect(screen.getByRole("button", { name: "Seeding… →" })).toBeDisabled();
  });

  it("loads and toggles the admin-only maintenance switch", async () => {
    requestMock
      .mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce({ enabled: true });
    const user = userEvent.setup();
    render(<Dashboard {...props} role="ADMIN" />);

    const toggle = screen.getByRole("checkbox");
    expect(toggle).toBeDisabled();
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(requestMock).toHaveBeenLastCalledWith(
      "/control/v1/maintenance",
      "session-token",
      { method: "PUT", body: JSON.stringify({ enabled: true }) },
    );
  });

  it("shows a maintenance loading error without leaving the switch blocked", async () => {
    requestMock.mockRejectedValue(new Error("Maintenance status unavailable"));
    render(<Dashboard {...props} role="ADMIN" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Maintenance status unavailable",
    );
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });
});
