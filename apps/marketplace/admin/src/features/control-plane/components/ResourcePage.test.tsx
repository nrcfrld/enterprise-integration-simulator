import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourcePage } from "./ResourcePage";

const props = {
  page: "Products" as const,
  data: { data: [] },
  shopID: "shop_operator",
  token: "session-token",
  role: "OPERATOR" as const,
  onForm: () => undefined,
  onDetail: () => undefined,
  onRefresh: () => undefined,
  onNotice: () => undefined,
  onSeed: () => undefined,
  listPage: 1,
  onPageChange: () => undefined,
};

describe("ResourcePage seed action", () => {
  it("allows an operator to seed the selected shop", () => {
    const markup = renderToStaticMarkup(<ResourcePage {...props} isSeeding={false} />);

    expect(markup).toContain("Reset to seed");
    expect(markup).not.toContain("Resetting…");
  });

  it("disables the action while a reset is running", () => {
    const markup = renderToStaticMarkup(<ResourcePage {...props} isSeeding />);

    expect(markup).toContain("Resetting…");
    expect(markup).toContain("disabled=\"\"");
  });
});
