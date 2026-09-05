// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShopeeOrderResults } from "./ShopeeOrderResults";

describe("Shopee order result handoff", () => {
  it.each([
    "not JSON",
    "null",
    JSON.stringify({ error: "error_auth", response: { order_list: [{ order_id: "ord_1", order_sn: "SIM-1" }] } }),
    JSON.stringify({ error: "", response: { order_list: [] } }),
    JSON.stringify({ error: "", response: { order_list: [{ order_sn: "SIM-NOT-AN-ID" }] } }),
    JSON.stringify({ error: "", response: { order_list: [{ order_id: " ", order_sn: "SIM-NOT-AN-ID" }] } }),
  ])("never falls back to the display number for an unusable response: %s", (body) => {
    render(<ShopeeOrderResults body={body} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
