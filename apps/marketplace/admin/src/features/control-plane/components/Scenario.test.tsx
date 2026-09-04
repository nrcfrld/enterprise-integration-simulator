// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Scenario } from "./Scenario";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

describe("Scenario critical save flow", () => {
  beforeEach(() => requestMock.mockReset());

  it("saves numeric failures and webhook flags for the selected shop", async () => {
    requestMock.mockResolvedValue({});
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <Scenario
        token="session-token"
        shopID="shop_1"
        data={{ api_slow_ms: 100, webhook_duplicate: false }}
        onSaved={onSaved}
      />,
    );

    await user.clear(screen.getByLabelText("API slow response (ms)"));
    await user.type(screen.getByLabelText("API slow response (ms)"), "750");
    await user.click(screen.getByLabelText("Duplicate webhook"));
    await user.click(screen.getByRole("button", { name: "Apply scenario →" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shops/shop_1/scenario",
      "session-token",
      {
        method: "PUT",
        body: JSON.stringify({
          api_slow_ms: 750,
          webhook_duplicate: true,
        }),
      },
    );
  });

  it("disables save while applying a scenario", async () => {
    let resolveRequest: ((value: object) => void) | undefined;
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <Scenario
        token="session-token"
        shopID="shop_1"
        data={{}}
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Apply scenario →" }));
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
    resolveRequest?.({});
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("renders an empty state until a shop is selected", () => {
    render(<Scenario token="session-token" shopID="" data={null} onSaved={vi.fn()} />);

    expect(screen.getByText(/Choose a shop before configuring fault injection/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Apply scenario/ })).not.toBeInTheDocument();
  });
});
