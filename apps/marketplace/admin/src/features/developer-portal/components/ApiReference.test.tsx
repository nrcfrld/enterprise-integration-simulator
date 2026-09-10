// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../data/endpoints";
import { ApiReference } from "./ApiReference";

describe("ApiReference", () => {
  it("shows one complete endpoint at a time and keeps every operation discoverable", async () => {
    const user = userEvent.setup();
    render(
      <ApiReference
        title="Products API reference"
        description="Provider product operations."
        note="Read the contract before calling it."
        groups={["Products"]}
        endpoints={ENDPOINTS}
        onTry={() => undefined}
      />,
    );

    expect(screen.getByText("4 endpoints")).toBeVisible();
    expect(screen.getByRole("heading", { name: "List Shopee-like items" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Search Tokopedia-like products" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /scroll horizontally/ }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("link", { name: /Search Tokopedia-like products/ }));
    expect(screen.getByRole("heading", { name: "Search Tokopedia-like products" })).toBeVisible();
    expect(document.getElementById("endpoint-tokopedia-search-products")).toHaveTextContent("next_page_token");
    expect(screen.queryByRole("heading", { name: "List Shopee-like items" })).not.toBeInTheDocument();
  });

  it("switches from the order index to one selected fulfilment contract", async () => {
    const user = userEvent.setup();
    render(
      <ApiReference
        title="Orders and fulfilment API reference"
        description="Provider order operations."
        note="List an order first."
        groups={["Orders", "Fulfillment"]}
        endpoints={ENDPOINTS}
        onTry={() => undefined}
      />,
    );

    expect(screen.getByText("13 endpoints")).toBeVisible();
    await user.click(screen.getByRole("link", { name: /Allocate a Shopee-like package/ }));
    expect(screen.getByRole("heading", { name: "Allocate a Shopee-like package" })).toBeVisible();
    expect(document.getElementById("endpoint-shopee-create-package")).toHaveTextContent("Idempotency-Key");
    expect(document.getElementById("endpoint-shopee-create-package")).toHaveTextContent("items[].order_item_id");
  });
});
