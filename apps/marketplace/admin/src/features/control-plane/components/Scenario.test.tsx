// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Scenario } from "./Scenario";
import { CLEAR_FAULTS } from "@/shared/scenarios";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

describe("Scenario critical save flow", () => {
  beforeEach(() => requestMock.mockReset());

  it("applies a named exercise then clears all faults without resetting shop data", async () => {
    requestMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<Scenario token="token" shopID="shop_2" data={{}} onSaved={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Learning exercise"), "Rate-limit recovery");
    expect(screen.getByText(/Forced limiting continues until you clear faults/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Apply scenario →" }));
    expect(JSON.parse(requestMock.mock.calls[0][2].body).force_rate_limit).toBe(true);
    await user.click(screen.getByRole("button", { name: "Clear shop faults" }));
    expect(requestMock).toHaveBeenLastCalledWith("/control/v1/shops/shop_2/scenario", "token", { method: "PUT", body: JSON.stringify(CLEAR_FAULTS) });
    expect(requestMock.mock.calls.every(call => call[0].endsWith("/scenario"))).toBe(true);
  });

  it("explains an out-of-range probability without sending it", async () => {
    const user = userEvent.setup();
    render(<Scenario token="token" shopID="shop_2" data={{ api_random_500_probability: 101 }} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Apply scenario →" }));
    expect(screen.getByRole("alert")).toHaveTextContent("from 0 to 100");
    expect(requestMock).not.toHaveBeenCalled();
  });

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
