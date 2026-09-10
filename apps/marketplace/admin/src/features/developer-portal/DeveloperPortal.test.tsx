// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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

  it("makes receiver verification reachable from Webhooks navigation", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} /></MemoryRouter>);
    await user.click(screen.getByRole("link", { name: "Webhooks" }));
    expect(screen.getByRole("heading", { name: "Receive and verify webhook deliveries" })).toBeVisible();
    await user.click(screen.getByText("Verify incoming deliveries"));
    expect(screen.getByText("EVENT + TIMESTAMP + RAW_BODY")).toBeVisible();
    expect(screen.getByText("APP_KEY + RAW_BODY")).toBeVisible();
    expect(screen.getByText(/oldest ACTIVE credential/, { selector: "p" })).toBeVisible();
    await user.click(screen.getByText("Run a local receiver"));
    expect(screen.getByText("timingSafeEqual", { selector: "span.token.function" })).toBeVisible();
  });

  it("opens a returned Shopee order by its API ID and sends the detail request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "", message: "success", response: { order_list: [
          { order_id: "ord_first", order_sn: "SIM-FIRST" },
          { order_id: "ord_selected", order_sn: "SIM-DISPLAY-ONLY" },
        ] },
      }), { status: 200, statusText: "OK" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "", response: { order_id: "ord_selected", order_sn: "SIM-DISPLAY-ONLY", order_status: "UNPAID" },
      }), { status: 200, statusText: "OK" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: /Fulfil an order/ }));
    expect(screen.getByText(/Copy order_id from response.order_list into/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Client ID"), "partner_1");
    await user.type(screen.getByLabelText(/Client secret/), "secret_1");
    await user.click(screen.getByRole("button", { name: "Send signed request" }));
    await user.click(await screen.findByRole("button", { name: "Use this order: SIM-DISPLAY-ONLY" }));

    expect(screen.getByLabelText(/Order ID/)).toHaveValue("ord_selected");
    expect(screen.getByText(/order_sn is the display order number and cannot be used/)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toHaveValue("partner_1");
    await user.click(screen.getByRole("button", { name: "Send signed request" }));
    expect(await screen.findByText("200 OK")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [requestURL, options] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(new URL(String(requestURL)).pathname).toBe("/api/shopee/v1/orders/ord_selected");
    expect(options).toEqual(expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ "X-Shopee-Partner-Id": "partner_1", "X-Shopee-Signature": expect.any(String) }),
    }));
  });

  it("opens every documentation section from the side navigation", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: /send your first signed request/i })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Request signing" }));
    expect(screen.getByRole("heading", { name: /choose the signature/i })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Products" }));
    expect(screen.getByRole("heading", { level: 1, name: "Products API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Warehouses" }));
    expect(screen.getByRole("heading", { level: 1, name: "Warehouses API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Orders & fulfilment" }));
    expect(screen.getByRole("heading", { level: 1, name: "Orders and fulfilment API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Webhooks" }));
    expect(screen.getByRole("heading", { level: 1, name: "Webhook API reference" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Errors & limits" }));
    expect(screen.getByRole("heading", { name: /recover from common responses/i })).toBeInTheDocument();
  });

  it("preserves credentials while switching provider contracts and clears them on demand", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} /></MemoryRouter>);

    await user.click(screen.getByRole("link", { name: "Request simulator" }));
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

  it("exposes console shortcuts as real, shareable links", () => {
    render(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "Back to console" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Manage shops" })).toHaveAttribute("href", "/shops");
    expect(screen.getByRole("link", { name: "Failure scenarios" })).toHaveAttribute("href", "/scenarios");
  });

  it("keeps account administration separate and Admin-only", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Account administration" })).not.toBeInTheDocument();

    rerender(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={onNavigate} canManageUsers /></MemoryRouter>);
    await user.click(screen.getByRole("link", { name: "Account administration" }));
    expect(screen.getByRole("heading", { name: "Manage Control Plane accounts" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Users" })).toHaveAttribute("href", "/users");
  });
});

it("opens the provider-specific durable exercise with runnable downloads", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><DeveloperPortal shop={{ id: "toko_1", name: "Toko", status: "ACTIVE", provider_profile: "TOKOPEDIA_LIKE" }} api="http://localhost:18080" onNavigate={vi.fn()} /></MemoryRouter>);
  await user.click(screen.getByRole("link", { name: "Durable consumer exercise" }));
  expect(screen.getByRole("heading", { name: "Build a durable Tokopedia-like consumer" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Download durable-consumer.mjs" })).toHaveAttribute("download", "durable-consumer.mjs");
  expect(screen.getByRole("link", { name: "Download webhook-receiver.mjs" })).toHaveAttribute("download", "webhook-receiver.mjs");
  await user.click(screen.getByText("Create and discover a fresh order"));
  expect(screen.getByRole("button", { name: "Search orders (POST)" })).toBeVisible();
  await user.click(screen.getByText("Prove recovery"));
  expect(screen.getByText(/same persisted retry_key/i)).toBeVisible();
});
