// @vitest-environment jsdom

import "@/test/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailPanel } from "./DetailPanel";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

const baseProps = {
  token: "session-token",
  onClose: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onNotice: vi.fn(),
};

const orderDetail = {
  id: "order_1",
  order_number: "ORD-001",
  status: "CREATED",
  payment: { status: "PENDING" },
  customer_data: { name: "Budi", phone: "08123456789" },
  shipping_address: {
    address_line: "Jl. Mawar 10",
    city: "Bandung",
    postal_code: "40111",
  },
  items: [{ id: "item_1", sku: "SKU-001", product_name: "Travel Bag", quantity: 1, price: 125000 }],
  events: [{ id: "event_1", event_type: "order.created", occurred_at: "2026-09-04T10:00:00Z" }],
  deliveries: [],
};

describe("DetailPanel component states and actions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    baseProps.onClose.mockReset();
    baseProps.onRefresh.mockReset().mockResolvedValue(undefined);
    baseProps.onNotice.mockReset();
  });

  it("renders loading state and exposes an accessible close action", async () => {
    let resolveRequest: ((value: object) => void) | undefined;
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <DetailPanel {...baseProps} detail={{ type: "order", id: "order_1" }} />,
    );

    expect(screen.getByRole("dialog", { name: "order details" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Loading…" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);

    resolveRequest?.(orderDetail);
    expect(await screen.findByRole("heading", { name: "ORD-001" })).toBeVisible();
  });

  it("shows a detail loading failure as an alert", async () => {
    requestMock.mockRejectedValue(new Error("Order detail unavailable"));
    render(
      <DetailPanel {...baseProps} detail={{ type: "order", id: "order_1" }} />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Order detail unavailable",
    );
  });

  it("replays an order event and refreshes its detail", async () => {
    requestMock
      .mockResolvedValueOnce(orderDetail)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(orderDetail);
    const user = userEvent.setup();
    render(
      <DetailPanel {...baseProps} detail={{ type: "order", id: "order_1" }} />,
    );
    await screen.findByText("order.created");

    await user.click(screen.getByRole("button", { name: "Replay" }));

    await waitFor(() => expect(baseProps.onRefresh).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      "/control/v1/events/event_1/replay",
      "session-token",
      { method: "POST" },
    );
    expect(baseProps.onNotice).toHaveBeenCalledWith("Event replay queued");
  });

  it("validates warehouse inventory before sending an update", async () => {
    const warehouseDetail = {
      id: "warehouse_1",
      shop_id: "shop_1",
      name: "Main warehouse",
      code: "WH-DEFAULT",
      status: "ACTIVE",
      priority: 1,
      inventory: [
        {
          product_id: "product_1",
          sku: "SKU-001",
          product_name: "Travel Bag",
          on_hand_quantity: 7,
          reserved_quantity: 2,
          available_quantity: 5,
        },
      ],
    };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/products") ? { data: [] } : warehouseDetail),
    );
    render(
      <DetailPanel
        {...baseProps}
        detail={{ type: "warehouse", id: "warehouse_1" }}
      />,
    );
    const quantity = await screen.findByLabelText("On hand quantity for Travel Bag");
    fireEvent.change(quantity, { target: { value: "-1" } });
    const form = quantity.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "On-hand quantity must be a whole number of zero or more.",
    );
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
