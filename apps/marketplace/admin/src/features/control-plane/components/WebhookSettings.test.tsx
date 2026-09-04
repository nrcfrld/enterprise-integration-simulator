// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookSettings } from "./WebhookSettings";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

const hook = {
  id: "webhook_1",
  url: "https://receiver.example/webhooks",
  subscribed_events: ["order.created", "product.updated"],
  enabled: false,
};

const props = {
  data: { data: [hook] },
  shopID: "shop_1",
  token: "session-token",
  onForm: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onNotice: vi.fn(),
};

describe("WebhookSettings critical actions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    props.onForm.mockClear();
    props.onRefresh.mockClear();
    props.onNotice.mockClear();
  });

  it("opens register and edit forms", async () => {
    const user = userEvent.setup();
    render(<WebhookSettings {...props} />);

    await user.click(screen.getByRole("button", { name: /Register webhook/ }));
    expect(props.onForm).toHaveBeenCalledWith({ kind: "webhook" });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(props.onForm).toHaveBeenCalledWith({ kind: "webhook", initial: hook });
  });

  it("enables a disabled webhook and preserves its subscription", async () => {
    requestMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<WebhookSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shops/shop_1/webhooks/webhook_1",
      "session-token",
      {
        method: "PATCH",
        body: JSON.stringify({
          url: hook.url,
          subscribed_events: hook.subscribed_events,
          enabled: true,
        }),
      },
    );
    expect(props.onNotice).toHaveBeenCalledWith("Webhook enabled");
  });

  it("deletes a confirmed webhook registration", async () => {
    requestMock.mockResolvedValue({});
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<WebhookSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shops/shop_1/webhooks/webhook_1",
      "session-token",
      { method: "DELETE" },
    );
    expect(props.onNotice).toHaveBeenCalledWith(
      "Webhook registration deleted",
    );
    confirmMock.mockRestore();
  });
});
