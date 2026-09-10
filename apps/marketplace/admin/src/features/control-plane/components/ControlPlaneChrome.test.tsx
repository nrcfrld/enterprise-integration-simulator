// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneSession } from "@/shared/types/controlPlane";
import { ControlPlaneSidebar, Notice } from "./ControlPlaneChrome";

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

describe("ControlPlaneSidebar", () => {
  const operator: ControlPlaneSession = { token: "token", user: { id: "operator", email: "operator@example.test", role: "OPERATOR" } };
  const admin: ControlPlaneSession = { token: "token", user: { id: "admin", email: "admin@example.test", role: "ADMIN" } };

  it("uses a compact disclosure and keeps administration role-aware", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MemoryRouter><ControlPlaneSidebar page="Dashboard" session={operator} onLogout={vi.fn()} /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    rerender(<MemoryRouter><ControlPlaneSidebar page="Dashboard" session={admin} onLogout={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/users");
  });
});
