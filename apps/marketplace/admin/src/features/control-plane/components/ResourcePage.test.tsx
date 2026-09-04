// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pagination, ResourcePage } from "./ResourcePage";

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

  it("renders the empty state without exposing row actions", () => {
    render(<ResourcePage {...props} />);

    expect(
      screen.getByText("Choose a shop or create a record to begin."),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "View product" }));
    expect(props.onDetail).toHaveBeenCalledWith({
      type: "product",
      id: "product_1",
      shopID: "shop_operator",
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

describe("Pagination states", () => {
  it("moves between pages and disables the boundary action", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Pagination
        pagination={{ page: 1, limit: 20, total: 45, total_pages: 3 }}
        page={1}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onChange).toHaveBeenCalledWith(2);

    rerender(
      <Pagination
        pagination={{ page: 3, limit: 20, total: 45, total_pages: 3 }}
        page={3}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("does not render controls for a single page", () => {
    render(
      <Pagination
        pagination={{ page: 1, limit: 20, total: 10, total_pages: 1 }}
        page={1}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });
});
