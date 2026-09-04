// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENDPOINT_BY_ID } from "../data/endpoints";
import { RequestSimulator } from "./RequestSimulator";

const response = (body: string, headers: Record<string, string> = {}) => ({
  status: 200,
  statusText: "OK",
  headers: {
    has: (name: string) => Object.hasOwn(headers, name),
    get: (name: string) => headers[name] ?? null,
  },
  text: vi.fn().mockResolvedValue(body),
}) as unknown as Response;

describe("RequestSimulator", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("explains missing credentials before making a request", async () => {
    const user = userEvent.setup();
    render(<RequestSimulator endpoint={ENDPOINT_BY_ID["list-warehouses"]} api="http://localhost:8080" credentials={{ clientID: "", secret: "", accessToken: "" }} />);

    await user.click(screen.getByRole("button", { name: "Send signed request" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Paste the Client ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates provider access tokens, path values, and JSON bodies", async () => {
    const user = userEvent.setup();
    const credentials = { clientID: "client_1", secret: "secret_1", accessToken: "" };
    const { rerender } = render(<RequestSimulator key="token" endpoint={ENDPOINT_BY_ID["tokopedia-search-products"]} api="http://localhost:8080" credentials={credentials} />);

    await user.click(screen.getByRole("button", { name: "Send signed request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("one-time access token");

    rerender(<RequestSimulator key="path" endpoint={ENDPOINT_BY_ID["get-warehouse"]} api="http://localhost:8080" credentials={{ ...credentials, accessToken: "token_1" }} />);
    await user.click(screen.getByRole("button", { name: "Send signed request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Fill in every required path value");

    rerender(<RequestSimulator key="body" endpoint={ENDPOINT_BY_ID["register-webhook"]} api="http://localhost:8080" credentials={{ ...credentials, accessToken: "token_1" }} />);
    await user.clear(screen.getByLabelText(/JSON request body/));
    await user.type(screen.getByLabelText(/JSON request body/), "not json");
    await user.click(screen.getByRole("button", { name: "Send signed request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("must be valid JSON");
  });

  it("signs and displays a shared API response with rate-limit headers", async () => {
    fetchMock.mockResolvedValue(response('{"data":[]}', {
      "x-ratelimit-limit": "60",
      "x-ratelimit-remaining": "59",
    }));
    const user = userEvent.setup();
    render(<RequestSimulator endpoint={ENDPOINT_BY_ID["list-warehouses"]} api="http://localhost:8080" credentials={{ clientID: " client_1 ", secret: "secret_1", accessToken: "" }} />);

    await user.click(screen.getByRole("button", { name: "Send signed request" }));

    expect(await screen.findByText("200 OK")).toBeInTheDocument();
    expect(screen.getByText("x-ratelimit-remaining")).toBeInTheDocument();
    const [requestURL, options] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    expect(new URL(String(requestURL)).pathname).toBe("/api/v1/warehouses");
    expect(options).toEqual(expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ "X-Client-Id": "client_1", "X-Signature": expect.any(String) }),
    }));
  });

  it("sends a Shopee-like mutation with its path, body, and idempotency key", async () => {
    fetchMock.mockResolvedValue(response('{"message":"success"}', { "x-shopee-api-call-limit": "100" }));
    const user = userEvent.setup();
    render(<RequestSimulator endpoint={ENDPOINT_BY_ID["shopee-cancel-order"]} api="http://localhost:8080" credentials={{ clientID: "partner_1", secret: "secret_1", accessToken: "" }} />);

    await user.type(screen.getByLabelText(/Order ID/), "order_1");
    await user.click(screen.getByRole("button", { name: "Send signed request" }));

    expect(await screen.findByText("200 OK")).toBeInTheDocument();
    const [requestURL, options] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    expect(new URL(String(requestURL)).pathname).toBe("/api/shopee/v1/orders/order_1/cancel");
    expect(options).toEqual(expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("CHANGE_OF_MIND"),
      headers: expect.objectContaining({
        "X-Shopee-Partner-Id": "partner_1",
        "Idempotency-Key": expect.any(String),
        "Content-Type": "application/json",
      }),
    }));
  });

  it("adds Tokopedia-like signature parameters and reports network failures", async () => {
    fetchMock
      .mockResolvedValueOnce(response('{"code":0}', { "x-tts-ratelimit-remaining": "49" }))
      .mockRejectedValueOnce(new Error("network offline"));
    const user = userEvent.setup();
    const credentials = { clientID: "app_1", secret: "secret_1", accessToken: "access_1" };
    const { rerender } = render(<RequestSimulator key="success" endpoint={ENDPOINT_BY_ID["tokopedia-search-products"]} api="http://localhost:8080" credentials={credentials} />);

    await user.click(screen.getByRole("button", { name: "Send signed request" }));
    expect(await screen.findByText("200 OK")).toBeInTheDocument();
    const [requestURL, options] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    const url = new URL(String(requestURL));
    expect(url.searchParams.get("app_key")).toBe("app_1");
    expect(url.searchParams.get("sign")).toEqual(expect.any(String));
    expect(options.headers).toEqual(expect.objectContaining({ "x-tts-access-token": "access_1" }));

    rerender(<RequestSimulator key="failure" endpoint={ENDPOINT_BY_ID["list-warehouses"]} api="http://localhost:8080" credentials={credentials} />);
    await user.click(screen.getByRole("button", { name: "Send signed request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network offline");
  });
});
