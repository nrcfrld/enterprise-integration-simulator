// @vitest-environment jsdom
import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { OrderActions } from "./OrderActions";
import { OrderDetail } from "./OrderDetail";

it("shows only permitted merchant actions with provider naming, and submits the chosen cancellation context", async () => {
 const onAction = vi.fn().mockResolvedValue(undefined);
 const user = userEvent.setup();
 render(<OrderActions data={{ id: "ord_1", status: "PAID", operations: { provider_profile: "TOKOPEDIA_LIKE", available_actions: ["process"], cancellation_options: [{ actor: "CUSTOMER", reasons: ["CHANGE_OF_MIND", "ADDRESS_ISSUE"] }, { actor: "SELLER", reasons: ["OUT_OF_STOCK", "SELLER_UNFULFILLABLE"] }] } }} pending={false} onAction={onAction} />);
 expect(screen.getByText(/POST \/api\/tokopedia\/v202309\/orders\/ord_1\/pack/)).toBeVisible();
 expect(screen.queryByRole("button", { name: "Verify payment" })).not.toBeInTheDocument();
 expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
 await user.click(screen.getByRole("button", { name: "Simulate pack" }));
 expect(onAction).toHaveBeenCalledWith("process");
 await user.selectOptions(screen.getByLabelText("Cancellation actor"), "SELLER");
 await user.selectOptions(screen.getByLabelText("Cancellation reason"), "SELLER_UNFULFILLABLE");
 await user.click(screen.getByRole("button", { name: "Cancel order as seller" }));
 expect(onAction).toHaveBeenLastCalledWith("cancel", { actor: "SELLER", reason: "SELLER_UNFULFILLABLE" });
});

it.each(["FAILED", "EXPIRED"])("shows authoritative %s payment state and no illegal actions on a cancelled order", payment => {
 render(<OrderDetail data={{ id: "ord_1", status: "CANCELLED", payment: { status: "UNPAID" }, operations: { provider_status: "CANCEL", payment_status: payment, available_actions: [], cancellation_options: [] } }} token="token" onReload={vi.fn()} onRefresh={vi.fn()} onNotice={vi.fn()} onError={vi.fn()} />);
 expect(screen.getByText(payment)).toBeVisible();
 expect(screen.queryByText("UNPAID", { exact: true })).not.toBeInTheDocument();
 expect(screen.queryByRole("button", { name: "Verify payment" })).not.toBeInTheDocument();
 expect(screen.getByText(/This order is terminal/)).toBeVisible();
});
