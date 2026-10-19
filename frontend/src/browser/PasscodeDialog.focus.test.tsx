/**
 * PasscodeDialog.focus.test.tsx — R5 · B5: after the passcode dialog is cancelled, focus returns to the
 * control that asked for it.
 *
 * In the studio an AI step swaps its action bar for a skeleton the moment the draft starts, so the
 * invoking button is gone (and disabled) by the time the dialog closes: the old restore landed on
 * <body>. The dialog now falls back to the step's primary action (the invoking control, once the step
 * has settled), which is marked with data-primary="true" throughout the studio and the live course.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PasscodeDialog } from "./PasscodeDialog";
import { passcodeKeeper } from "./passcode";

/** Mimics the studio: pressing the step's primary action replaces it with a working placeholder. */
function Harness() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      {busy ? <span aria-hidden="true">Working…</span> : (
        <button
          type="button"
          data-primary="true"
          onClick={() => { setBusy(true); void passcodeKeeper().ask("needed").then(() => setBusy(false)); }}
        >
          Draft the lesson plan
        </button>
      )}
      <PasscodeDialog />
    </>
  );
}

afterEach(() => { cleanup(); });

describe("B5: focus returns to the invoking control after a cancelled passcode", () => {
  it("re-focuses the step's primary action when the invoking control was replaced while the dialog was open", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Draft the lesson plan" }));
    const dialog = await screen.findByRole("dialog", { name: "Demo passcode" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Draft the lesson plan" })).toHaveFocus());
  });
});
