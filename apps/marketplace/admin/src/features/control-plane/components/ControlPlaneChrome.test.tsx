// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Notice } from "./ControlPlaneChrome";

describe("Notice", () => {
  it("announces success without presenting it as an error alert", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<Notice message={{ type: "success", text: "Product created" }} onDismiss={onDismiss} />);

    expect(screen.getByRole("status")).toHaveTextContent("DoneProduct created");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses an assertive alert for failures", () => {
    render(<Notice message={{ type: "error", text: "Request failed" }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Action failedRequest failed");
  });
});
