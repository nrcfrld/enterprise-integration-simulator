// @vitest-environment jsdom
import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneApp } from "./ControlPlaneApp";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ API_BASE_URL: "http://localhost:18080", controlPlaneRequest: request }));
const shop = { id: "shop_toko", name: "Toko learner", provider_profile: "TOKOPEDIA_LIKE", status: "ACTIVE" };
const other = { id: "shop_shopee", name: "Shopee learner", provider_profile: "SHOPEE_LIKE", status: "ACTIVE" };
beforeEach(() => {
 localStorage.clear(); sessionStorage.clear();
 localStorage.setItem("marketplace-session", JSON.stringify({ token: "console-session", user: { id: "user", email: "user@test.local", role: "OPERATOR" } }));
 request.mockReset().mockImplementation((path: string, _token: string, options?: { method?: string }) => {
  if (path === "/control/v1/shops") return Promise.resolve({ data: [shop, other] });
  if (path.endsWith("/credentials") && options?.method === "POST") return Promise.resolve({ id: "cred_1", client_id: "client_toko", client_secret: "one-time-secret", access_token: "one-time-access" });
  return Promise.resolve({ data: [] });
 });
});

it("returns from credential creation to the edited Tokopedia request, warns on mismatch, and clears on shop switch", async () => {
 const user = userEvent.setup();
 render(<MemoryRouter initialEntries={["/docs"]}><ControlPlaneApp /></MemoryRouter>);
 await waitFor(() => expect(screen.getByLabelText("Selected shop context")).toHaveTextContent("Toko learner"));
 await user.click(screen.getByRole("button", { name: /Fulfil an order/ }));
 const body = screen.getByLabelText(/JSON request body/);
 await user.clear(body); await user.paste('{"page_size":7}');
 await user.click(screen.getByRole("button", { name: "Open Credentials" }));
 await user.click(await screen.findByRole("button", { name: "+ New credential" }));
 await user.click(screen.getByRole("button", { name: "Create →" }));
 expect(await screen.findByRole("dialog", { name: "Credential created" })).toHaveTextContent("Toko learner");
 await user.click(screen.getByRole("button", { name: "Use in simulator" }));
 await waitFor(() => expect(screen.getByRole("textbox", { name: "Client ID" })).toHaveValue("client_toko"));
 expect(screen.getByLabelText(/Client secret/)).toHaveValue("one-time-secret");
 expect(screen.getByLabelText(/Tokopedia-like access token/)).toHaveValue("one-time-access");
 expect(screen.getByLabelText(/JSON request body/)).toHaveValue('{"page_size":7}');
 expect(screen.getByText(/Known Client ID/)).toHaveTextContent("Toko learner");
 expect(JSON.stringify(localStorage)).not.toContain("one-time");
 expect(sessionStorage.length).toBe(0);
 await user.click(screen.getByRole("button", { name: "Shopee-like" }));
 expect(screen.getByRole("alert")).toHaveTextContent("Toko learner uses tokopedia");
 expect(screen.getByRole("button", { name: "Send signed request" })).toBeDisabled();
 await user.click(screen.getByRole("button", { name: "Shared resources" }));
 expect(screen.getByRole("button", { name: "Send signed request" })).toBeEnabled();
 await user.click(screen.getByRole("button", { name: "Back to console" }));
 await user.selectOptions(screen.getByLabelText("Current shop"), "shop_shopee");
 await user.click(screen.getByRole("link", { name: "API Documentation" }));
 await user.click(screen.getByRole("button", { name: "Request simulator" }));
 expect(screen.getByRole("textbox", { name: "Client ID" })).toHaveValue("");
 expect(screen.getByLabelText(/Client secret/)).toHaveValue("");
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("preserves pasted credentials across a console visit and explicitly clears them", async () => {
 const user = userEvent.setup();
 render(<MemoryRouter initialEntries={["/docs"]}><ControlPlaneApp /></MemoryRouter>);
 await waitFor(() => expect(screen.getByLabelText("Selected shop context")).toHaveTextContent("Toko learner"));
 await user.click(screen.getByRole("button", { name: "Request simulator" }));
 await user.type(screen.getByRole("textbox", { name: "Client ID" }), "pasted_id");
 await user.type(screen.getByLabelText(/Client secret/), "pasted-secret");
 await user.click(screen.getByRole("button", { name: "Open Credentials" }));
 await user.click(await screen.findByRole("link", { name: "API Documentation" }));
 expect(screen.getByLabelText(/Client secret/)).toHaveValue("pasted-secret");
 await user.click(screen.getByRole("button", { name: "Clear credential" }));
 expect(screen.getByLabelText(/Client secret/)).toHaveValue("");
 expect(screen.getByRole("textbox", { name: "Client ID" })).toHaveValue("");
});
