// @vitest-environment jsdom
import "@/test/setup";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ENDPOINT_BY_ID } from "../data/endpoints";
import { RequestSimulator, type SavedRequestDraft } from "./RequestSimulator";
const credentials = { clientID: "client", secret: "secret", accessToken: "access" };
const props = { api: "http://localhost:18080", credentials };
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, statusText: status === 200 ? "OK" : "Too Many Requests", headers: new Headers(headers), text: async () => JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());

it("reset and unmount abort pending requests and discard late responses", async () => {
  let complete!: (value: unknown) => void;
  const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const { unmount } = render(<RequestSimulator {...props} endpoint={ENDPOINT_BY_ID["shopee-process-order"]} initialPathParams={{ id: "ord_1" }} />);
  const key = (screen.getByLabelText(/Idempotency key/) as HTMLInputElement).value;
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const signal = fetchMock.mock.calls[0][1].signal;
  fireEvent.click(screen.getByRole("button", { name: "Reset request" }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByLabelText(/Idempotency key/)).not.toHaveValue(key);
  await act(async () => complete(response({ stale: "old result" })));
  expect(screen.queryByText("200 OK")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Order ID/), { target: { value: "ord_2" } });
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  unmount();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
});

it("keeps drafts and retry keys across operation remounts and retries the original body", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValue(response({ error: "", response: {} }));
  vi.stubGlobal("fetch", fetchMock);
  const drafts = new Map<string, SavedRequestDraft>();
  const endpoint = ENDPOINT_BY_ID["shopee-cancel-order"];
  const { rerender } = render(<RequestSimulator key="cancel" {...props} drafts={drafts} endpoint={endpoint} initialPathParams={{ id: "ord_1" }} />);
  const original = '{ "cancel_reason" : "DUPLICATE_ORDER" }';
  fireEvent.change(screen.getByLabelText(/JSON request body/), { target: { value: original } });
  const key = (screen.getByLabelText(/Idempotency key/) as HTMLInputElement).value;
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  await screen.findByRole("alert");
  rerender(<RequestSimulator key="list" {...props} drafts={drafts} endpoint={ENDPOINT_BY_ID["shopee-list-orders"]} />);
  rerender(<RequestSimulator key="cancel" {...props} drafts={drafts} endpoint={endpoint} />);
  expect(screen.getByLabelText(/JSON request body/)).toHaveValue(original);
  expect(screen.getByLabelText(/Idempotency key/)).toHaveValue(key);
  fireEvent.change(screen.getByLabelText(/JSON request body/), { target: { value: '{"cancel_reason":"ADDRESS_ISSUE"}' } });
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  expect(screen.getByRole("alert")).toHaveTextContent("already used with different inputs");
  expect(fetchMock).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Retry same operation" }));
  await screen.findByText("200 OK");
  expect(fetchMock.mock.calls[1][1].body).toBe(original);
  expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBe(key);
  fireEvent.click(screen.getByRole("button", { name: "New operation" }));
  expect(screen.getByLabelText(/Idempotency key/)).not.toHaveValue(key);
});

it("reports a timeout without implying rollback and retains the retry key", async () => {
  const fetchMock = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  vi.stubGlobal("fetch", fetchMock);
  render(<RequestSimulator {...props} endpoint={ENDPOINT_BY_ID["shopee-process-order"]} initialPathParams={{ id: "ord_1" }} />);
  fireEvent.change(screen.getByLabelText("Timeout (seconds)"), { target: { value: "1" } });
  const key = (screen.getByLabelText(/Idempotency key/) as HTMLInputElement).value;
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent("server may still complete a mutation");
  expect(screen.getByLabelText(/Idempotency key/)).toHaveValue(key);
  expect(screen.getByRole("button", { name: "Retry same operation" })).toBeEnabled();
});

it("shows HTTP failures with retry/replay headers and uses unfiltered Tokopedia defaults", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({ code: 429, message: "quota" }, 429, { "retry-after": "30", "idempotent-replayed": "true", "x-tts-ratelimit-remaining": "0" }));
  vi.stubGlobal("fetch", fetchMock);
  render(<RequestSimulator {...props} endpoint={ENDPOINT_BY_ID["tokopedia-search-orders"]} />);
  expect(JSON.parse((screen.getByLabelText(/JSON request body/) as HTMLTextAreaElement).value)).toEqual({ page_size: 20 });
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Wait for Retry-After");
  expect(screen.getByText("429 Too Many Requests")).toBeVisible();
  expect(screen.getByText("retry-after")).toBeVisible();
  expect(screen.getByText("idempotent-replayed")).toBeVisible();
  expect(screen.queryByText(/Request succeeded/)).not.toBeInTheDocument();
});

it("passes opaque Tokopedia tokens unchanged and hands off returned order IDs", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ code: 0, data: { orders: [{ order_id: "ord_21" }], has_more: true, next_page_token: "opaque+/=" } }))
    .mockResolvedValueOnce(response({ code: 0, data: { orders: [], has_more: false } }));
  vi.stubGlobal("fetch", fetchMock);
  const select = vi.fn();
  render(<RequestSimulator {...props} endpoint={ENDPOINT_BY_ID["tokopedia-search-orders"]} onSelectResource={select} />);
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use returned ID: ord_21" }));
  expect(select).toHaveBeenCalledWith("tokopedia-get-order", "ord_21");
  fireEvent.click(screen.getByRole("button", { name: "Fetch next page" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ page_size: 20, page_token: "opaque+/=" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Fetch next page" })).not.toBeInTheDocument());
});

it("blocks reusing a mutation retry key under a different credential", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("lost response"));
  vi.stubGlobal("fetch", fetchMock);
  const endpoint = ENDPOINT_BY_ID["shopee-process-order"];
  const { rerender } = render(<RequestSimulator {...props} endpoint={endpoint} initialPathParams={{ id: "ord_1" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Send signed request" }));
  await screen.findByRole("alert");
  rerender(<RequestSimulator {...props} endpoint={endpoint} credentials={{ ...credentials, clientID: "another-client" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry same operation" }));
  expect(screen.getByRole("alert")).toHaveTextContent("another Client ID");
  expect(fetchMock).toHaveBeenCalledOnce();
});
