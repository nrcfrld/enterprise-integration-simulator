// @vitest-environment jsdom
import "@/test/setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FaultContext } from "./FaultContext";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/controlPlaneClient", () => ({ controlPlaneRequest: request }));
it("shows active faults, refreshes recovery, and keeps failed status unknown", async () => {
  request.mockImplementation((path: string) => Promise.resolve(path.endsWith("scenario") ? { force_rate_limit: true } : { enabled: true }));
  render(<FaultContext shopID="shop_1" token="token" onConfigure={vi.fn()} />);
  expect(await screen.findByText("Forced rate limit")).toBeVisible();
  expect(screen.getByText(/Global maintenance is on/i)).toBeVisible();
  request.mockRejectedValue(new Error("Offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be checked");
  expect(screen.queryByText(/No shop faults enabled/)).not.toBeInTheDocument();
  request.mockImplementation((path: string) => Promise.resolve(path.endsWith("scenario") ? {} : { enabled: false }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(await screen.findByText("No shop faults enabled")).toBeVisible();
});
