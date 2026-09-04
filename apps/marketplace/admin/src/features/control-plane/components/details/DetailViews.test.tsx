// @vitest-environment jsdom

import "@/test/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryDetail } from "./DeliveryDetail";
import { OrderDetail } from "./OrderDetail";
import { PackageDetail } from "./PackageDetail";
import { ProductDetail } from "./ProductDetail";
import { ShipmentDetail } from "./ShipmentDetail";
import { WarehouseDetail } from "./WarehouseDetail";
import type { DetailContentProps, DetailData } from "./types";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

const callbacks = {
  onReload: vi.fn().mockResolvedValue(undefined),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onNotice: vi.fn(),
  onError: vi.fn(),
};

function detailProps(data: DetailData): DetailContentProps {
  return { data, token: "session-token", ...callbacks };
}

describe("resource-specific detail views", () => {
  beforeEach(() => {
    requestMock.mockReset().mockResolvedValue({});
    callbacks.onReload.mockReset().mockResolvedValue(undefined);
    callbacks.onRefresh.mockReset().mockResolvedValue(undefined);
    callbacks.onNotice.mockReset();
    callbacks.onError.mockReset();
    vi.restoreAllMocks();
  });

  it("renders product, package, and delivery records", () => {
    const { rerender } = render(
      <ProductDetail data={{ name: "Travel Bag", sku: "SKU-1", status: "ACTIVE", stock: 7, category: "Bags", description: "Cabin bag", price: 125000 }} />,
    );
    expect(screen.getByText("Travel Bag")).toBeVisible();
    expect(screen.getByText("Cabin bag")).toBeVisible();

    rerender(
      <PackageDetail data={{ status: "CREATED", order_id: "order_1", created_at: "today", items: [{ id: "item_1", sku: "SKU-1", product_name: "Travel Bag", quantity: 2 }], warehouse: { warehouse_name: "Main", warehouse_code: "WH-1" } }} />,
    );
    expect(screen.getByText("Travel Bag").closest("p")).toHaveTextContent("SKU-1 · 2");
    expect(screen.getByText("Main")).toBeVisible();

    rerender(
      <DeliveryDetail data={{ status: "FAILURE", attempt_count: 1, attempts: [{ id: "attempt_1", attempt: 1, status: "FAILURE", duration_ms: 25, response_body: "unavailable" }] }} />,
    );
    expect(screen.getByText("Attempt 1: FAILURE")).toBeVisible();
    expect(screen.getByText("unavailable")).toBeVisible();
  });

  it("runs order and event actions and reports validation errors", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const user = userEvent.setup();
    render(
      <OrderDetail
        {...detailProps({
          id: "order_1",
          status: "PAID",
          payment: { status: "PAID", reference: "PAY-1" },
          operations: { provider_profile: "SHOPEE_LIKE", payment_status: "PAID" },
          customer_data: { name: "Budi", phone: "0800" },
          shipping_address: { address_line: "Jl. Mawar", city: "Bandung", postal_code: "40111" },
          items: [{ id: "item_1", sku: "SKU-1", product_name: "Bag", quantity: 1, price: 100 }],
          fulfillment: { warehouse_name: "Main", warehouse_code: "WH-1", warehouse_id: "warehouse_1" },
          events: [{ id: "event_1", event_type: "order.paid", occurred_at: "today" }],
          deliveries: [{ id: "delivery_1", status: "SUCCESS", attempt_count: 1, event_id: "event_1" }],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Process" }));
    await user.click(screen.getByRole("button", { name: "Replay" }));
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    prompt.mockReturnValueOnce("0");
    await user.click(screen.getByRole("button", { name: "Delay" }));
    expect(callbacks.onError).toHaveBeenCalledWith("Delay must be a whole number of at least one second.");

    prompt.mockReturnValueOnce("15");
    await user.click(screen.getByRole("button", { name: "Delay" }));
    await waitFor(() => expect(callbacks.onRefresh).toHaveBeenCalledTimes(4));
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/events/event_1/delay",
      "session-token",
      { method: "POST", body: JSON.stringify({ delay_seconds: 15 }) },
    );
    expect(callbacks.onNotice).toHaveBeenLastCalledWith("Event delivery delayed by 15s");
  });

  it("runs shipment transitions, requires a failure reason, and renders final state", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const user = userEvent.setup();
    const { rerender } = render(
      <ShipmentDetail {...detailProps({ id: "shipment_1", status: "IN_DELIVERY", tracking_number: "TRACK-1", order_number: "ORDER-1" })} />,
    );

    prompt.mockReturnValueOnce(" ");
    await user.click(screen.getByRole("button", { name: "Report delivery failure" }));
    expect(callbacks.onError).toHaveBeenCalledWith("A delivery failure reason is required.");

    prompt.mockReturnValueOnce("Address closed");
    await user.click(screen.getByRole("button", { name: "Report delivery failure" }));
    await waitFor(() => expect(callbacks.onNotice).toHaveBeenCalledWith("Shipment delivery_failed complete"));
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shipments/shipment_1/actions/delivery_failed",
      "session-token",
      { method: "POST", body: JSON.stringify({ reason: "Address closed" }) },
    );

    rerender(<ShipmentDetail {...detailProps({ id: "shipment_1", status: "DELIVERED" })} />);
    expect(screen.getByText("This shipment has reached its final delivery state.")).toBeVisible();
  });

  it("loads catalogue products and updates existing and new warehouse inventory", async () => {
    requestMock.mockResolvedValueOnce({ data: [{ id: "product_2", sku: "SKU-2", name: "Bottle", stock: 0 }] });
    const user = userEvent.setup();
    render(
      <WarehouseDetail
        {...detailProps({
          id: "warehouse_1",
          shop_id: "shop_1",
          name: "Main warehouse",
          code: "WH-1",
          status: "ACTIVE",
          priority: 1,
          address: { address_line: "Jl. Gudang", city: "Jakarta" },
          inventory: [{ product_id: "product_1", sku: "SKU-1", product_name: "Bag", on_hand_quantity: 7, reserved_quantity: 2, available_quantity: 5 }],
        })}
      />,
    );

    const existingQuantity = await screen.findByLabelText("On hand quantity for Bag");
    fireEvent.change(existingQuantity, { target: { value: "8" } });
    fireEvent.submit(existingQuantity.closest("form")!);
    await waitFor(() => expect(callbacks.onNotice).toHaveBeenCalledWith("Warehouse inventory updated"));

    await user.selectOptions(screen.getByLabelText("Add a product to this warehouse"), "product_2");
    await user.clear(screen.getByLabelText("New inventory on-hand quantity"));
    await user.type(screen.getByLabelText("New inventory on-hand quantity"), "3");
    await user.click(screen.getByRole("button", { name: "Add inventory" }));
    await waitFor(() => expect(callbacks.onRefresh).toHaveBeenCalledTimes(2));
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/warehouses/warehouse_1/inventory/product_2",
      "session-token",
      { method: "PUT", body: JSON.stringify({ on_hand_quantity: 3 }) },
    );
  });
});
