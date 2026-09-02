import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL, controlPlaneRequest } from "./controlPlaneClient";

describe("controlPlaneRequest", () => {
	const originalFetch = globalThis.fetch;
	const originalWindow = globalThis.window;

  afterEach(() => {
	globalThis.fetch = originalFetch;
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: originalWindow,
	});
  });

  it("adds JSON and bearer headers while returning a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "shop_1" }] }), { status: 200 }),
    );
	globalThis.fetch = fetchMock as typeof fetch;

    const result = await controlPlaneRequest<{ data: Array<{ id: string }> }>(
      "/control/v1/shops",
      "session-token",
      { method: "GET", headers: { "X-Request-Id": "req_1" } },
    );

    expect(result.data[0].id).toBe("shop_1");
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/control/v1/shops`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer session-token",
        "X-Request-Id": "req_1",
      },
    });
  });

  it("returns null for a successful no-content response", async () => {
	globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as typeof fetch;

    await expect(controlPlaneRequest<null>("/control/v1/webhooks/wh_1", "token", {
      method: "DELETE",
    })).resolves.toBeNull();
  });

  it("uses the API error message when a request fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "warehouse not found" } }),
      { status: 404 },
    )) as typeof fetch;

    await expect(controlPlaneRequest("/control/v1/warehouses/wh_missing", "token")).rejects.toThrow(
      "warehouse not found",
    );
  });

  it("notifies the application when an authenticated session has expired", async () => {
    const windowTarget = new EventTarget();
    const invalidSession = vi.fn();
    windowTarget.addEventListener("marketplace:session-invalid", invalidSession);
    Object.defineProperty(globalThis, "window", { configurable: true, value: windowTarget });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "expired token" } }),
      { status: 401 },
    )) as typeof fetch;

    await expect(controlPlaneRequest("/control/v1/dashboard", "expired-token")).rejects.toThrow(
      "expired token",
    );
    expect(invalidSession).toHaveBeenCalledTimes(1);
  });
});
