// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

describe("LoginPage authentication failure", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows an API error and lets the user retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "Invalid email or password" } }),
          { status: 401 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<LoginPage onLogin={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Sign in →" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password",
    );
    expect(screen.getByRole("button", { name: "Sign in →" })).toBeEnabled();
  });
});
