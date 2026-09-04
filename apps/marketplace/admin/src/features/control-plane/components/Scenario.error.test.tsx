// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scenario } from "./Scenario";

describe("Scenario API failure", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes a recoverable error and enables save again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "Scenario service unavailable" } }),
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <Scenario
        token="session-token"
        shopID="shop_1"
        data={{}}
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Apply scenario →" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scenario service unavailable",
    );
    expect(screen.getByRole("button", { name: "Apply scenario →" })).toBeEnabled();
  });
});
