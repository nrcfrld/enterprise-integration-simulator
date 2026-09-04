// @vitest-environment jsdom

import "@/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlPlaneSession } from "@/shared/types/controlPlane";
import { LoginPage } from "./LoginPage";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/shared/api/controlPlaneClient", () => ({
  controlPlaneRequest: requestMock,
}));

const session: ControlPlaneSession = {
  token: "session-token",
  user: { id: "user_1", email: "admin@example.test", role: "ADMIN" },
};

describe("LoginPage critical authentication flows", () => {
  beforeEach(() => requestMock.mockReset());

  it("signs in with the submitted credentials", async () => {
    requestMock.mockResolvedValue(session);
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);

    await user.click(screen.getByRole("button", { name: "Sign in →" }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(session));
    expect(requestMock).toHaveBeenCalledWith("/control/v1/auth/login", null, {
      method: "POST",
      body: JSON.stringify({
        email: "admin@example.test",
        password: "change-me-now",
      }),
    });
  });

  it("registers a new operator with the values entered by the user", async () => {
    requestMock.mockResolvedValue(session);
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);

    await user.click(screen.getByRole("tab", { name: "Create account" }));
    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Create account →" }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(session));
    expect(requestMock).toHaveBeenCalledWith("/control/v1/auth/register", null, {
      method: "POST",
      body: JSON.stringify({
        email: "operator@example.test",
        password: "safe-password",
      }),
    });
  });

});
