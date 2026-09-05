// @vitest-environment jsdom
import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PackageAllocationFields } from "./PackageAllocationFields";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));
it("loads later-page eligible orders and submits real line IDs within remaining quantities", async () => {
  request.mockImplementation((path: string) => Promise.resolve(path.includes("page=1") ? { data: [{ id: "unpaid", status: "UNPAID" }], pagination: { total_pages: 2 } } : path.includes("page=2") ? { data: [{ id: "ord_2", order_number: "SIM-2", status: "READY_TO_SHIP" }] } : { items: [{ id: "ori_2", sku: "MUG", product_name: "Mug", quantity: 3, allocated_quantity: 2, remaining_quantity: 1 }, { id: "ori_full", sku: "BAG", product_name: "Bag", quantity: 1, allocated_quantity: 1, remaining_quantity: 0 }] }));
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<PackageAllocationFields shopID="shop_1" token="token" onChange={onChange} />);
  await screen.findByRole("option", { name: "SIM-2 · ord_2" });
  expect(screen.queryByRole("option", { name: /unpaid/ })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Order"), "ord_2");
  const quantity = await screen.findByRole("spinbutton", { name: /Quantity for Mug/ });
  expect(quantity).toHaveAttribute("max", "1");
  expect(screen.getByRole("spinbutton", { name: /Quantity for Bag/ })).toBeDisabled();
  await user.clear(quantity); await user.type(quantity, "1");
  expect(onChange).toHaveBeenLastCalledWith("ord_2", [{ order_item_id: "ori_2", quantity: 1 }]);
  await user.selectOptions(screen.getByLabelText("Order"), "");
  expect(onChange).toHaveBeenLastCalledWith("", []);
});
