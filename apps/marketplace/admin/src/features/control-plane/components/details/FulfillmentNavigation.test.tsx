// @vitest-environment jsdom
import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DetailPanel } from "../DetailPanel";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));
it("shows all packages and follows package → shipment → warehouse with a return path", async () => {
  const warehouse = { warehouse_id: "warehouse_1", warehouse_name: "Main", warehouse_code: "WH-1" };
  const item = { id: "ori_1", product_name: "Mug", sku: "MUG", quantity: 2, allocated_quantity: 2, remaining_quantity: 0 };
  const shipments = [{ id: "shp_a", package_id: "pkg_a", tracking_number: "TRACK-A", status: "DELIVERED" }, { id: "shp_b", package_id: "pkg_b", tracking_number: "TRACK-B", status: "CREATED" }];
  request.mockImplementation((path: string) => Promise.resolve(path.includes("/orders/") ? { id: "ord_1", order_number: "SIM-1", fulfillment: warehouse, items: [item], shipment: { id: "obsolete", tracking_number: "OLD" }, shipments, packages: [{ id: "pkg_a", status: "DELIVERED", items: [{ ...item, quantity: 1 }] }, { id: "pkg_b", status: "READY_TO_SHIP", items: [{ ...item, quantity: 1 }] }] }
    : path.includes("/packages/") ? { id: "pkg_b", order_id: "ord_1", warehouse, shipments: [shipments[1]] }
    : path.includes("/shipments/") ? { ...shipments[1], order_id: "ord_1", warehouse }
    : { id: "warehouse_1", name: "Main", code: "WH-1", inventory: [] }));
  const user = userEvent.setup();
  render(<DetailPanel detail={{ type: "order", id: "ord_1" }} token="token" onClose={vi.fn()} onNotice={vi.fn()} onRefresh={vi.fn()} />);
  expect(await screen.findByText("Packages (2) · Shipments (2)")).toBeVisible();
  expect(screen.queryByText("OLD")).not.toBeInTheDocument();
  expect(screen.getByText("ori_1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Open package pkg_b" }));
  await user.click(await screen.findByRole("button", { name: "Open shipment TRACK-B" }));
  expect(await screen.findByRole("button", { name: "Open package pkg_b" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Open warehouse Main · WH-1" }));
  expect(await screen.findByRole("dialog", { name: "warehouse details" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back to previous resource" }));
  expect(await screen.findByRole("dialog", { name: "shipment details" })).toBeVisible();
  expect(request).toHaveBeenCalledWith("/control/v1/shipments/shp_b", "token");
});
