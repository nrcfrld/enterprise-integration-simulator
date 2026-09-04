// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeveloperPortal } from "./DeveloperPortal";

describe("DeveloperPortal navigation", () => {
  const onNavigate = vi.fn();

  beforeEach(() => {
    onNavigate.mockReset();
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("opens every documentation section from the side navigation", async () => {
    const user = userEvent.setup();
    render(<DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} />);

    expect(screen.getByRole("heading", { name: /make a real provider request/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Request signing" }));
    expect(screen.getByRole("heading", { name: /choose the signature/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Products" }));
    expect(screen.getByRole("heading", { name: "Products API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Warehouses" }));
    expect(screen.getByRole("heading", { name: "Warehouses API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Orders & fulfilment" }));
    expect(screen.getByRole("heading", { name: "Orders and fulfilment API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Webhooks" }));
    expect(screen.getByRole("heading", { name: "Webhook API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Errors & limits" }));
    expect(screen.getByRole("heading", { name: /recover from common responses/i })).toBeInTheDocument();
  });

  it("preserves credentials while switching provider contracts and clears them on demand", async () => {
    const user = userEvent.setup();
    render(<DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: "Request simulator" }));
    await user.type(screen.getByLabelText("Client ID"), "client_123");
    await user.type(screen.getByLabelText(/Client secret/), "secret_123");

    await user.click(screen.getByRole("button", { name: "Tokopedia-like" }));
    expect(screen.getByLabelText("Client ID")).toHaveValue("client_123");
    expect(screen.getByLabelText(/Tokopedia-like access token/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Tokopedia-like access token/), "token_123");

    await user.click(screen.getByRole("button", { name: "Clear credential" }));
    expect(screen.getByLabelText("Client ID")).toHaveValue("");
    expect(screen.getByLabelText(/Client secret/)).toHaveValue("");
    expect(screen.getByLabelText(/Tokopedia-like access token/)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Open Credentials" }));
    expect(onNavigate).toHaveBeenCalledWith("Credentials");
  });

  it("routes console shortcuts to their control-plane pages", async () => {
    const user = userEvent.setup();
    render(<DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: "Back to console" }));
    await user.click(screen.getByRole("button", { name: "Manage shops" }));
    await user.click(screen.getByRole("button", { name: "Failure scenarios" }));

    expect(onNavigate.mock.calls).toEqual([["Dashboard"], ["Shops"], ["Scenarios"]]);
  });
});
