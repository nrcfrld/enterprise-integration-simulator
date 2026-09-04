// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlForm } from "./ControlForm";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

const baseProps = {
  shopID: "shop_1",
  token: "session-token",
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

function requestBody(callIndex = requestMock.mock.calls.length - 1) {
  return JSON.parse(requestMock.mock.calls[callIndex][2].body as string) as Record<string, unknown>;
}

describe("ControlForm critical mutations", () => {
  beforeEach(() => {
    requestMock.mockReset();
    baseProps.onClose.mockReset();
    baseProps.onSaved.mockReset();
  });

  it("creates a product with warehouse inventory and derived stock", async () => {
    requestMock
      .mockResolvedValueOnce({
        data: [{ id: "warehouse_1", code: "WH-DEFAULT", name: "Main warehouse" }],
      })
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<ControlForm {...baseProps} kind="product" />);

    const inventory = screen.getByRole("group", {
      name: "Initial inventory by warehouse",
    });
    await within(inventory).findByRole("option", { name: /Main warehouse/ });
    await user.type(screen.getByLabelText("SKU"), "SKU-001");
    await user.type(screen.getByLabelText("Name"), "Travel Bag");
    await user.type(screen.getByLabelText("Category"), "Accessories");
    await user.type(screen.getByLabelText("Price (minor unit)"), "125000");
    await user.clear(screen.getByLabelText("Initial quantity for warehouse 1"));
    await user.type(screen.getByLabelText("Initial quantity for warehouse 1"), "7");
    await user.click(screen.getByRole("button", { name: "Create →" }));

    await waitFor(() => expect(baseProps.onSaved).toHaveBeenCalledWith("product created"));
    expect(requestMock).toHaveBeenLastCalledWith(
      "/control/v1/shops/shop_1/products",
      "session-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestBody()).toMatchObject({
      sku: "SKU-001",
      name: "Travel Bag",
      category: "Accessories",
      price: 125000,
      stock: 7,
      warehouse_inventory: [
        { warehouse_id: "warehouse_1", on_hand_quantity: 7 },
      ],
    });
  });

  it("updates a product without sending immutable inventory fields", async () => {
    requestMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ControlForm
        {...baseProps}
        kind="product"
        initial={{
          id: "product_1",
          sku: "SKU-OLD",
          name: "Old name",
          category: "Old category",
          description: "Old description",
          price: 9000,
          status: "ACTIVE",
        }}
      />,
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Updated name");
    await user.click(screen.getByRole("button", { name: "Save product →" }));

    await waitFor(() => expect(baseProps.onSaved).toHaveBeenCalledWith("Product updated"));
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shops/shop_1/products/product_1",
      "session-token",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(requestBody()).toEqual({
      name: "Updated name",
      category: "Old category",
      description: "Old description",
      price: 9000,
      status: "ACTIVE",
    });
  });

  it.each([
    ["create", undefined, "POST", "/control/v1/shops/shop_1/warehouses"],
    [
      "edit",
      {
        id: "warehouse_1",
        code: "WH-JKT",
        name: "Jakarta",
        status: "ACTIVE",
        priority: 1,
        address: {
          address_line: "Jl. Merdeka 1",
          city: "Jakarta",
          postal_code: "10110",
        },
      },
      "PATCH",
      "/control/v1/warehouses/warehouse_1",
    ],
  ])("can %s a warehouse", async (_, initial, method, path) => {
    requestMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<ControlForm {...baseProps} kind="warehouse" initial={initial} />);

    if (!initial) {
      await user.type(screen.getByLabelText("Warehouse code"), "WH-JKT");
      await user.type(screen.getByLabelText("Warehouse name"), "Jakarta");
      await user.type(screen.getByLabelText("Address line"), "Jl. Merdeka 1");
      await user.clear(screen.getByLabelText("City"));
      await user.type(screen.getByLabelText("City"), "Jakarta");
      await user.type(screen.getByLabelText("Postal code"), "10110");
      await user.type(screen.getByLabelText("Allocation priority"), "1");
    }
    await user.click(
      screen.getByRole("button", {
        name: initial ? "Save warehouse →" : "Create →",
      }),
    );

    await waitFor(() => expect(baseProps.onSaved).toHaveBeenCalled());
    expect(requestMock).toHaveBeenCalledWith(
      path,
      "session-token",
      expect.objectContaining({ method }),
    );
    expect(requestBody()).toMatchObject({
      code: "WH-JKT",
      name: "Jakarta",
      priority: 1,
      address: {
        address_line: "Jl. Merdeka 1",
        city: "Jakarta",
        postal_code: "10110",
      },
    });
  });

  it("submits a custom order with product, customer, and shipping data", async () => {
    requestMock
      .mockResolvedValueOnce({
        data: [{ id: "product_1", name: "Travel Bag", sku: "SKU-001", stock: 7 }],
      })
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<ControlForm {...baseProps} kind="order" />);

    await user.click(screen.getByRole("button", { name: "Custom order" }));
    const option = await screen.findByRole("option", { name: /Travel Bag/ });
    await user.selectOptions(screen.getByRole("combobox"), option);
    await user.type(screen.getByLabelText("Customer name"), "Budi Santoso");
    await user.type(screen.getByLabelText("Customer phone"), "08123456789");
    await user.type(screen.getByLabelText("Address line"), "Jl. Mawar 10");
    await user.clear(screen.getByLabelText("City"));
    await user.type(screen.getByLabelText("City"), "Bandung");
    await user.type(screen.getByLabelText("Postal code"), "40111");
    await user.click(screen.getByRole("button", { name: "Create →" }));

    await waitFor(() => expect(baseProps.onSaved).toHaveBeenCalledWith("order created"));
    expect(requestMock).toHaveBeenLastCalledWith(
      "/control/v1/shops/shop_1/orders",
      "session-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestBody()).toEqual({
      items: [{ product_id: "product_1", quantity: 1 }],
      customer: { name: "Budi Santoso", phone: "08123456789" },
      shipping_address: {
        address_line: "Jl. Mawar 10",
        city: "Bandung",
        postal_code: "40111",
      },
    });
  });

  it("registers a webhook with the selected subscriptions", async () => {
    requestMock.mockResolvedValue({ secret: "generated-secret" });
    const user = userEvent.setup();
    render(<ControlForm {...baseProps} kind="webhook" />);

    await user.type(
      screen.getByLabelText("Endpoint URL"),
      "https://receiver.example/webhooks",
    );
    await user.type(screen.getByLabelText("Replace secret (optional)"), "secret-123");
    await user.click(screen.getByLabelText("product.updated"));
    await user.click(screen.getByRole("button", { name: "Create →" }));

    await waitFor(() =>
      expect(baseProps.onSaved).toHaveBeenCalledWith(
        "Created. Save this secret now: generated-secret",
      ),
    );
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shops/shop_1/webhooks",
      "session-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestBody()).toMatchObject({
      url: "https://receiver.example/webhooks",
      secret: "secret-123",
      enabled: true,
    });
    expect(requestBody().subscribed_events).toContain("product.updated");
  });

  it("updates a webhook and can disable delivery", async () => {
    requestMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ControlForm
        {...baseProps}
        kind="webhook"
        initial={{
          id: "webhook_1",
          url: "https://receiver.example/webhooks",
          secret: "",
          enabled: true,
          subscribed_events: ["order.created"],
        }}
      />,
    );

    await user.click(screen.getByLabelText("Deliver events to this endpoint"));
    await user.click(screen.getByRole("button", { name: "Save settings →" }));

    await waitFor(() =>
      expect(baseProps.onSaved).toHaveBeenCalledWith(
        "Webhook registration updated",
      ),
    );
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shops/shop_1/webhooks/webhook_1",
      "session-token",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(requestBody()).toMatchObject({ enabled: false, secret: "" });
  });

  it("keeps the form open and displays an API failure", async () => {
    requestMock.mockImplementation(() => {
      throw new Error("Product is out of stock");
    });
    const user = userEvent.setup();
    render(<ControlForm {...baseProps} kind="order" />);

    await user.click(screen.getByRole("button", { name: "Create →" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Product is out of stock",
    );
    expect(baseProps.onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Simulate an order event" })).toBeVisible();
  });
});
