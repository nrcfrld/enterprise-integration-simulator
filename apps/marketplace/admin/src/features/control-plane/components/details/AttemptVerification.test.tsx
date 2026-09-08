// @vitest-environment jsdom
import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { signCanonicalRequest } from "@/features/developer-portal/lib/signing";
import { DeliveryDetail } from "./DeliveryDetail";

it.each(["SHOPEE_LIKE", "TOKOPEDIA_LIKE"])("verifies the historical %s snapshot locally and clears the key", async provider => {
 const body = '{"data": {"status":"PAID"}}';
 const input = provider === "TOKOPEDIA_LIKE" ? "client_old" + body : "order_status_update1000" + body;
 const signature = await signCanonicalRequest("historical-secret", input);
 const headers: Record<string, string> = provider === "TOKOPEDIA_LIKE" ? { Authorization: signature } : { "X-Shopee-Event": "order_status_update", "X-Shopee-Timestamp": "1000", "X-Shopee-Signature": signature };
 const user = userEvent.setup();
 const onOpen = vi.fn();
 render(<DeliveryDetail onOpen={onOpen} data={{ id: "del_1", shop_id: "shop_1", event_id: "evt_1", status: "FAILED", webhook: { id: "wh_1", url: "https://new.example", enabled: true, deleted: false }, event: { id: "evt_1", aggregate_type: "order", aggregate_id: "ord_1", event_type: "order.paid", occurred_at: "then", payload: { status: "PAID" } }, attempts: [{ id: "att_1", attempt: 1, status: "FAILURE", duration_ms: 7, request_body: body, request_url: "https://old.example", provider_profile: provider, signing_client_id: provider === "TOKOPEDIA_LIKE" ? "client_old" : undefined, request_headers: headers, failure_code: "NETWORK_ERROR", failure_reason: "connection refused", http_attempted: true }] }} />);
 expect(screen.getByText("https://old.example")).toBeVisible();
 expect(screen.getByText("https://new.example")).toBeVisible();
 expect(screen.getByText(/connection refused/)).toHaveTextContent("worker can reach");
 await user.click(screen.getByRole("button", { name: "Open order ord_1" }));
 expect(onOpen).toHaveBeenCalledWith({ type: "order", id: "ord_1" });
 await user.click(screen.getByText("Verify this historical attempt locally"));
 await user.type(screen.getByLabelText("Verification secret"), "historical-secret");
 await user.click(screen.getByRole("button", { name: "Verify stored signature" }));
 expect(await screen.findByRole("status")).toHaveTextContent("Signature matches the stored bytes");
 expect(screen.getByLabelText("Verification secret")).toHaveValue("");
 await user.type(screen.getByLabelText("Verification secret"), "rotated-key");
 await user.click(screen.getByRole("button", { name: "Verify stored signature" }));
 expect(await screen.findByRole("status")).toHaveTextContent("Signature mismatch");
});

it("does not invent request evidence for a legacy attempt", async () => {
 render(<DeliveryDetail data={{ attempts: [{ id: "att_old", attempt: 1, status: "FAILURE", duration_ms: 1 }] }} />);
 await userEvent.click(screen.getByText("Request headers and exact body"));
 expect(screen.getByText(/Exact request body was not recorded/)).toBeVisible();
 expect(screen.queryByText("Verify this historical attempt locally")).not.toBeInTheDocument();
});
