// @vitest-environment jsdom

import "@/test/setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MassOrderFields, type MassOrderConfig } from "./MassOrderFields";

const product = {
  id: "product_hot",
  name: "Limited Bag",
  sku: "HOT-001",
  stock: 3,
};

function renderFields(
  config: MassOrderConfig = {
    productID: product.id,
    orderCount: 5,
    concurrency: 2,
    quantity: 1,
  },
  onChange = vi.fn(),
) {
  return {
    onChange,
    ...render(
      <MassOrderFields
        config={config}
        products={[product]}
        loading={false}
        progress={null}
        disabled={false}
        onChange={onChange}
      />,
    ),
  };
}

describe("MassOrderFields", () => {
  it("explains when the requested orders will contend for inventory", () => {
    renderFields();

    expect(screen.getByText("3 units available.")).toBeVisible();
    expect(screen.getByText(/At most 3 orders should succeed/)).toBeVisible();
  });

  it("updates numeric configuration and shows live progress", () => {
    const onChange = vi.fn();
    const { rerender } = renderFields(undefined, onChange);

    fireEvent.change(screen.getByLabelText("Quantity per order"), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ quantity: 2 }),
    );

    rerender(
      <MassOrderFields
        config={{ productID: product.id, orderCount: 2, concurrency: 2, quantity: 1 }}
        products={[product]}
        loading={false}
        progress={{ completed: 1, created: 1, rejected: 0, total: 2 }}
        disabled
        onChange={onChange}
      />,
    );

    expect(screen.getByText(/Current stock can satisfy every attempt/)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("1/2");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
  });
});
