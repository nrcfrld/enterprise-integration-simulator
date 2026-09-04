// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Authentication, QuickStart, Webhooks } from "./Guides";

describe("developer portal guides", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes each quick-start and webhook action to the intended workflow", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onTry = vi.fn();
    const { rerender } = render(<QuickStart onNavigate={onNavigate} onTry={onTry} />);

    await user.click(screen.getByRole("button", { name: "Create credential" }));
    await user.click(screen.getByRole("button", { name: "Try a provider request" }));
    await user.click(screen.getByRole("button", { name: "Start the order workflow" }));

    expect(onNavigate).toHaveBeenCalledWith("Credentials");
    expect(onTry).toHaveBeenCalledWith("shopee-list-products");
    expect(onTry).toHaveBeenCalledWith("shopee-list-orders");

    rerender(<Webhooks onTry={onTry} />);
    await user.click(screen.getByRole("button", { name: "Register shared webhook" }));
    await user.click(screen.getByRole("button", { name: "Register Shopee-like callback" }));
    await user.click(screen.getByRole("button", { name: "Configure Tokopedia-like callback" }));

    expect(onTry).toHaveBeenCalledWith("register-webhook");
    expect(onTry).toHaveBeenCalledWith("shopee-create-webhook");
    expect(onTry).toHaveBeenCalledWith("tokopedia-configure-webhook");
  });

  it("submits account registration and renders the API response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({ token: "session-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Authentication api="http://localhost:8080" />);

    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.click(screen.getByRole("button", { name: "Send registration request" }));

    expect(await screen.findByText(/HTTP 201/)).toHaveTextContent("session-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/control/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "operator@example.test", password: "practice-password" }),
      }),
    );
  });

  it("shows both API errors and unreachable-server errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: vi.fn().mockResolvedValue({ error: { message: "Email already registered" } }),
      })
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { unmount } = render(<Authentication api="http://localhost:8080" />);

    await user.click(screen.getByRole("button", { name: "Send registration request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email already registered");

    unmount();
    render(<Authentication api="http://localhost:8080" />);
    await user.click(screen.getByRole("button", { name: "Send registration request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not reach the API");
  });
});
