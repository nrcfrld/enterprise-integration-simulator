// @vitest-environment jsdom
import "@/test/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CredentialRevocation } from "./CredentialRevocation";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));
const records = [
  { id: "a", client_id: "old-client", status: "ACTIVE", created_at: "2026-09-09T00:00:00Z" },
  { id: "b", client_id: "new-client", status: "ACTIVE", created_at: "2026-09-09T00:00:00Z" },
];
const shop = { id: "shop_1", name: "Shop", provider_profile: "TOKOPEDIA_LIKE" as const, status: "ACTIVE" };
beforeEach(() => { request.mockReset(); });
it("previews the next signer and only revokes after explicit action; errors allow retry", async () => {
  request.mockImplementation((_path, _token, options) => options?.method ? Promise.reject(new Error("Try again")) : Promise.resolve({ data: [...records].reverse() }));
  const onRevoked = vi.fn(), listener = vi.fn();
  window.addEventListener("marketplace:credential-revoked", listener);
  render(<CredentialRevocation id="a" shop={shop} token="token" onClose={vi.fn()} onRevoked={onRevoked} />);
  expect(await screen.findByText(/Current webhook signer:/)).toHaveTextContent("old-client. After revocation: new-client");
  expect(request.mock.calls.some(call => call[2]?.method === "POST")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Revoke this credential" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(onRevoked).not.toHaveBeenCalled();
  request.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Revoke this credential" }));
  await waitFor(() => expect(onRevoked).toHaveBeenCalledOnce());
  expect(listener.mock.calls[0][0].detail).toEqual({ clientID: "old-client" });
  window.removeEventListener("marketplace:credential-revoked", listener);
});
it("warns on the last key and does not claim Shopee webhook secrets rotate", async () => {
  request.mockResolvedValue({ data: [records[0]] });
  render(<CredentialRevocation id="a" shop={{ ...shop, provider_profile: "SHOPEE_LIKE" }} onClose={vi.fn()} onRevoked={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("last active credential");
  expect(screen.getByText(/Shopee webhook verification/)).toHaveTextContent("does not rotate");
  expect(screen.queryByText(/Current webhook signer:/)).not.toBeInTheDocument();
});
it("blocks revocation when the impact cannot load", async () => {
  request.mockRejectedValue(new Error("Offline"));
  render(<CredentialRevocation id="a" shop={shop} onClose={vi.fn()} onRevoked={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  expect(screen.getByRole("button", { name: "Revoke this credential" })).toBeDisabled();
});
