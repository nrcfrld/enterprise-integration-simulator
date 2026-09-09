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

  it("identifies the current Tokopedia signing credential and unused registration secret", () => {
    render(<WebhookSettings {...props} shop={{ id: "shop_1", name: "Tokopedia", status: "ACTIVE", provider_profile: "TOKOPEDIA_LIKE" }} data={{ ...props.data, delivery_contract: { provider_profile: "TOKOPEDIA_LIKE", signing_client_id: "client_oldest" } }} />);
    screen.getByText("Tokopedia-like verification guide").click();
    expect(screen.getByText("client_oldest")).toBeVisible();
    expect(screen.getByText(/optional registration secret.*unused/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Shopee-like deliveries" })).not.toBeInTheDocument();
  });

  it("uses the delivery contract while the selected shop is still loading", async () => {
    const user = userEvent.setup();
    render(<WebhookSettings {...props} data={{ ...props.data, delivery_contract: { provider_profile: "TOKOPEDIA_LIKE", signing_client_id: "client_oldest" } }} />);

    await user.click(screen.getByText("Tokopedia-like verification guide"));
    expect(screen.getByRole("heading", { name: "Tokopedia-like deliveries" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Shopee-like deliveries" })).not.toBeInTheDocument();
  });

  it("does not flash both provider guides before the provider is known", () => {
    render(<WebhookSettings {...props} />);

    expect(screen.queryByLabelText("Webhook verification contract")).not.toBeInTheDocument();
  });

  it("shows failed deletions without announcing success", async () => {
    requestMock.mockRejectedValueOnce(new Error("Could not delete webhook"));
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<WebhookSettings {...props} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete webhook");
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(props.onNotice).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("opens register and edit forms", async () => {
    const user = userEvent.setup();
    render(<WebhookSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "Register endpoint" }));
    expect(props.onForm).toHaveBeenCalledWith({ kind: "webhook" });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(props.onForm).toHaveBeenCalledWith({ kind: "webhook", initial: hook });
  });

  it("explains the required shop and empty registration states", () => {
    const { rerender } = render(<WebhookSettings {...props} shopID="" />);
    expect(screen.getByText(/Choose a shop first/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Register webhook/ })).not.toBeInTheDocument();

    rerender(<WebhookSettings {...props} data={{ data: [] }} />);
    expect(screen.getByText(/No endpoint yet/)).toBeVisible();
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
