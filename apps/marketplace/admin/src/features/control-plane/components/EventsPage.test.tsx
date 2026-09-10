// @vitest-environment jsdom
import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { EventsPage } from "./EventsPage";

const { request } = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue({}) }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));

function Location() { return <output aria-label="Current filters">{useLocation().search}</output>; }

describe("shop event discovery", () => {
  it("applies resource filters, links resources/deliveries, and replays product events", async () => {
    const onDetail = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/events"]}><Location /><EventsPage shopID="shop_a" token="session" data={{ data: [{ id: "evt_product", event_type: "product.updated", aggregate_id: "product_a", aggregate_type: "product", occurred_at: "today", payload: { name: "New name" }, deliveries: [{ id: "delivery_a", event_id: "evt_product", status: "SUCCESS", attempt_count: 1 }] }], pagination: { page: 1, limit: 20, total: 21, total_pages: 2 } }} onDetail={onDetail} onRefresh={onRefresh} onNotice={vi.fn()} onNavigate={vi.fn()} listPage={1} onPageChange={onPageChange} /></MemoryRouter>);
    await user.selectOptions(screen.getByLabelText("Resource type"), "product");
    await user.type(screen.getByLabelText("Resource ID"), "product_a");
    await user.selectOptions(screen.getByLabelText("Event type"), "product.updated");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(screen.getByLabelText("Current filters")).toHaveTextContent("resource_type=product&aggregate_id=product_a&event_type=product.updated");
    expect(onPageChange).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: "product_a" }));
    expect(onDetail).toHaveBeenCalledWith({ type: "product", shopID: "shop_a", id: "product_a" });
    await user.click(screen.getByRole("button", { name: /delivery_a · SUCCESS/ }));
    expect(onDetail).toHaveBeenCalledWith({ type: "delivery", id: "delivery_a" });
    await user.click(screen.getByText("Canonical event payload"));
    expect(screen.getByText(/"New name"/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(request).toHaveBeenCalledWith("/control/v1/events/evt_product/replay", "session", { method: "POST" });
    expect(onRefresh).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Current filters")).toHaveTextContent("?shop=shop_a");
  });
});
