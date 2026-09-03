import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../data/endpoints";
import { ApiReference } from "./ApiReference";

describe("ApiReference", () => {
  it("renders complete endpoint documentation with a secondary simulator action", () => {
    const markup = renderToStaticMarkup(
      <ApiReference
        title="Products API reference"
        description="Provider product operations."
        note="Read the contract before calling it."
        groups={["Products"]}
        endpoints={ENDPOINTS}
        onTry={() => undefined}
      />,
    );

    expect(markup).toContain("On this page");
    expect(markup).toContain("Authentication and headers");
    expect(markup).toContain("Path and query parameters");
    expect(markup).toContain("Request payload");
    expect(markup).toContain("Return value");
    expect(markup).toContain("Common error");
    expect(markup).toContain("Open in request simulator");
    expect(markup).toContain("href=\"#endpoint-shopee-list-products\"");
    expect(markup).toContain("next_page_token");
  });

  it("combines order and fulfillment operations in one endpoint index", () => {
    const markup = renderToStaticMarkup(
      <ApiReference
        title="Orders and fulfilment API reference"
        description="Provider order operations."
        note="List an order first."
        groups={["Orders", "Fulfillment"]}
        endpoints={ENDPOINTS}
        onTry={() => undefined}
      />,
    );

    expect(markup).toContain("Allocate a Shopee-like package");
    expect(markup).toContain("Create a Tokopedia-like shipment");
    expect(markup).toContain("Idempotency-Key");
    expect(markup).toContain("items[].order_item_id");
  });
});
