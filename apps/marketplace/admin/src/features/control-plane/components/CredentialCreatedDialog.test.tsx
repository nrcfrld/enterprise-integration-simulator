// @vitest-environment jsdom

import "@/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CredentialCreatedDialog } from "./CredentialCreatedDialog";

describe("CredentialCreatedDialog", () => {
  it("shows all one-time values and copies an individual value", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    render(
      <CredentialCreatedDialog
        credential={{
          id: "credential_1",
          client_id: "client_once",
          client_secret: "sec_once",
          access_token: "acc_once",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Credential created" })).toBeVisible();
    expect(screen.getByText("sec_once")).toBeVisible();
    expect(screen.getByText("acc_once")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Copy Client secret" }));
    expect(writeText).toHaveBeenCalledWith("sec_once");
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("supports Escape and explicit confirmation to close", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <CredentialCreatedDialog
        credential={{
          id: "credential_1",
          client_id: "client_once",
          client_secret: "sec_once",
        }}
        onClose={onClose}
      />,
    );

    expect(screen.queryByText("Access token")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Credential created" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    onClose.mockClear();
    await user.click(screen.getByRole("button", { name: "I saved these credentials" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
