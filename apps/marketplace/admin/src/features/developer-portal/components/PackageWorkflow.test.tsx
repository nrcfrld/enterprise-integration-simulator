// @vitest-environment jsdom
import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RequestSimulator } from "./RequestSimulator";
import { DeveloperPortal } from "../DeveloperPortal";
import { ENDPOINT_BY_ID } from "../data/endpoints";
afterEach(() => vi.unstubAllGlobals());
for (const provider of ["shopee", "tokopedia"]) it(`sends an explicit package or omits it for ${provider} automatic packaging`, async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200, statusText: "OK" })); vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<RequestSimulator endpoint={ENDPOINT_BY_ID[`${provider}-create-shipment`]} api="http://localhost:8080" credentials={{ clientID: "client", secret: "secret", accessToken: "access" }} initialPathParams={{ id: "ord_1" }} />);
  await user.clear(screen.getByLabelText(/^Package ID/)); await user.type(screen.getByLabelText(/^Package ID/), "pkg_second");
  await user.click(screen.getByRole("button", { name: "Send signed request" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetch.mock.calls[0][1].body).package_id).toBe("pkg_second");
  await user.selectOptions(screen.getByLabelText("Package selection"), "automatic");
  expect(JSON.parse((screen.getByLabelText(/^JSON request body/) as HTMLTextAreaElement).value)).not.toHaveProperty("package_id");
});
it("carries a returned Shopee package and its order into the signed shipment request", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "", response: { package: { id: "pkg_returned", order_id: "ord_returned" } } }), { status: 200, statusText: "OK" })).mockResolvedValueOnce(new Response("{}", { status: 200, statusText: "OK" })); vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<MemoryRouter><DeveloperPortal api="http://localhost:8080" onNavigate={vi.fn()} /></MemoryRouter>);
  await user.click(screen.getByRole("link", { name: "Request simulator" }));
  await user.click(screen.getByRole("button", { name: "Shopee-like" }));
  await user.click(screen.getByRole("button", { name: /Allocate a Shopee-like package/ }));
  await user.type(screen.getByLabelText("Client ID"), "client"); await user.type(screen.getByLabelText(/Client secret/), "secret");
  await user.type(screen.getByLabelText(/^Order ID/), "ord_returned");
  await user.click(screen.getByRole("button", { name: "Send signed request" }));
  await user.click(await screen.findByRole("button", { name: "Create shipment for package pkg_returned" }));
  expect(screen.getByLabelText(/^Order ID/)).toHaveValue("ord_returned");
  expect(screen.getByLabelText(/^Package ID/)).toHaveValue("pkg_returned");
  await user.click(screen.getByRole("button", { name: "Send signed request" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body).package_id).toBe("pkg_returned");
});
