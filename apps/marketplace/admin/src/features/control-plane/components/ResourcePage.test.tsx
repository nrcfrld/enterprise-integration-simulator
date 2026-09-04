// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourcePage } from "./ResourcePage";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

const props = {
  page: "Products" as const,
  data: { data: [] },
  shopID: "shop_operator",
  token: "session-token",
  role: "OPERATOR" as const,
  onForm: vi.fn(),
  onDetail: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onNotice: vi.fn(),
  onSeed: vi.fn().mockResolvedValue(undefined),
  isSeeding: false,
  listPage: 1,
  onPageChange: vi.fn(),
};

describe("ResourcePage critical product actions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    props.onForm.mockClear();
    props.onDetail.mockClear();
    props.onRefresh.mockClear();
    props.onNotice.mockClear();
    props.onSeed.mockClear();
    props.onPageChange.mockClear();
  });

  it("runs the selected shop seed handler once", async () => {
    const user = userEvent.setup();
    render(<ResourcePage {...props} />);

    await user.click(screen.getByRole("button", { name: "Reset to seed" }));

    expect(props.onSeed).toHaveBeenCalledTimes(1);
  });

  it("disables the seed action while a reset is running", () => {
    render(<ResourcePage {...props} isSeeding />);

    expect(screen.getByRole("button", { name: "Resetting…" })).toBeDisabled();
  });

  it("opens create and edit product forms with the correct record", async () => {
    const product = {
      id: "product_1",
      sku: "SKU-001",
      name: "Travel Bag",
      status: "ACTIVE",
    };
    const user = userEvent.setup();
    render(<ResourcePage {...props} data={{ data: [product] }} />);

    await user.click(screen.getByRole("button", { name: "+ New product" }));
    expect(props.onForm).toHaveBeenCalledWith({ kind: "product" });

    await user.click(screen.getByRole("button", { name: "Edit product" }));
    expect(props.onForm).toHaveBeenCalledWith({
      kind: "product",
      initial: product,
    });
  });

  it("archives a confirmed product and refreshes the list", async () => {
    requestMock.mockResolvedValue({});
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ResourcePage
        {...props}
        data={{ data: [{ id: "product_1", name: "Travel Bag" }] }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
    expect(confirmMock).toHaveBeenCalledWith(
      "Archive Travel Bag? Existing order history will be preserved.",
    );
    expect(requestMock).toHaveBeenCalledWith(
      "/control/v1/shops/shop_operator/products/product_1",
      "session-token",
      { method: "DELETE" },
    );
    expect(props.onNotice).toHaveBeenCalledWith("Product archived");
    confirmMock.mockRestore();
  });
});
