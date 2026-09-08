// @vitest-environment jsdom

import "@/test/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { AccessibleDialog } from "./AccessibleDialog";

function DialogHarness() {
  const [isOpen, setIsOpen] = useState(false);
  const initialFocusRef = useRef<HTMLHeadingElement>(null);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>Open dialog</button>
      {isOpen && (
        <AccessibleDialog
          ariaLabel="Example dialog"
          backdropClassName="modal-backdrop"
          className="modal-card"
          initialFocusRef={initialFocusRef}
          onClose={() => setIsOpen(false)}
        >
          <h2 ref={initialFocusRef} tabIndex={-1}>Example title</h2>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </AccessibleDialog>
      )}
    </div>
  );
}

function ChainedDialogHarness() {
  const [stage, setStage] = useState<"closed" | "first" | "second">("closed");
  const firstTitleRef = useRef<HTMLHeadingElement>(null);
  const secondTitleRef = useRef<HTMLHeadingElement>(null);

  return (
    <div>
      <button type="button" onClick={() => setStage("first")}>Start flow</button>
      {stage === "first" && (
        <AccessibleDialog ariaLabel="First dialog" initialFocusRef={firstTitleRef}>
          <h2 ref={firstTitleRef} tabIndex={-1}>First step</h2>
          <button type="button" onClick={() => setStage("second")}>Continue</button>
        </AccessibleDialog>
      )}
      {stage === "second" && (
        <AccessibleDialog
          ariaLabel="Second dialog"
          initialFocusRef={secondTitleRef}
          onClose={() => setStage("closed")}
        >
          <h2 ref={secondTitleRef} tabIndex={-1}>Second step</h2>
        </AccessibleDialog>
      )}
    </div>
  );
}

describe("AccessibleDialog", () => {
  it("contains keyboard focus, makes the background inert, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Example dialog" });
    const firstAction = screen.getByRole("button", { name: "First action" });
    const lastAction = screen.getByRole("button", { name: "Last action" });
    expect(container).toHaveAttribute("inert");
    expect(container).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { name: "Example title" })).toHaveFocus();

    await user.tab();
    expect(firstAction).toHaveFocus();
    await user.tab();
    expect(lastAction).toHaveFocus();
    await user.tab();
    expect(firstAction).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastAction).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(dialog).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("aria-hidden");
    expect(trigger).toHaveFocus();
  });

  it("dismisses the active dialog when Escape reaches the document", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Example dialog" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open dialog" })).toHaveFocus());
  });

  it("preserves the original return target across a chained dialog flow", async () => {
    const user = userEvent.setup();
    render(<ChainedDialogHarness />);
    const trigger = screen.getByRole("button", { name: "Start flow" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Second step" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
