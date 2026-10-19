/**
 * Rehearse.test.tsx — repair round 3 · G4: a cancelled passcode in Rehearse must not eat the question the
 * teacher typed, and focus must come back to the control that asked for it.
 *
 * Round 2 measured this at 0/8: Rehearse cleared the box on submit, so after "Not now" the box was empty,
 * the Ask button was disabled, and focus went to the page body. Here the real PasscodeDialog is mounted
 * beside Rehearse (as StudioApp mounts it) and the host is mocked at the transport, so the dialog — the
 * thing that restores focus — is the real one.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rehearse } from "./Rehearse";
import { PasscodeDialog } from "../browser/PasscodeDialog";

const { COURSE_ID } = vi.hoisted(() => ({ COURSE_ID: "urn:uuid:11111111-2222-3333-4444-555555555555" }));

vi.mock("../gate/transport", async () => {
  const { passcodeKeeper } = await import("../browser/passcode");
  const view = {
    course: { courseId: COURSE_ID, owner: "Ms. Lovelace", title: "How plants eat" },
    versions: [{ version: 1, objectiveRefs: [{ id: "o-1", statement: "students can say what a fraction is." }] }],
  };
  const host = {
    getCourse: async () => view,
    workerStatus: async () => ({ configured: true, passcodeRequired: true }),
    // Exactly the browser path: the passcode gate comes first, and a cancel sends nothing.
    askStudent: async () => {
      const code = await passcodeKeeper().ask("needed");
      if (!code) throw new Error("AI drafting needs the demo passcode. Nothing was sent.");
      return { answer: "A fraction is a part of a whole.", grounded: true, cites: [{ id: "o-1", label: "Objective 1" }], note: "", basis: "plan" };
    },
  };
  return { host: host as unknown as typeof import("../gate/transport").host };
});

const mount = () => render(<><Rehearse courseId={COURSE_ID} /><PasscodeDialog /></>);
const QUESTION = "What is a fraction?";

async function typeAndAsk(user: ReturnType<typeof userEvent.setup>) {
  const box = await screen.findByPlaceholderText("Type as a student would…");
  await user.type(box, QUESTION);
  await user.click(screen.getByRole("button", { name: "Ask" }));
  const dialog = await screen.findByRole("dialog", { name: "Demo passcode" });
  return { box, dialog };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("G4: cancelling the passcode in Rehearse keeps the question and returns focus", () => {
  it("'Not now' keeps the typed question and focuses the Ask button", async () => {
    const user = userEvent.setup();
    mount();
    const { box, dialog } = await typeAndAsk(user);
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(box).toHaveValue(QUESTION);
    expect(screen.getByRole("button", { name: "Ask" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask" })).toHaveFocus());
  });

  it("Escape keeps the typed question and focuses the textarea when Enter was the opener", async () => {
    const user = userEvent.setup();
    mount();
    const { box, dialog } = await typeAndAsk(user);
    await user.click(box); // the textarea is the control that asks, as it is after Enter
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(box).toHaveValue(QUESTION);
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("the box is cleared only once the host has taken the question", async () => {
    const user = userEvent.setup();
    mount();
    const { box, dialog } = await typeAndAsk(user);
    await user.type(within(dialog).getByLabelText("Passcode"), "letmein");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(box).toHaveValue(""));
    expect(await screen.findByText("A fraction is a part of a whole.")).toBeInTheDocument();
  });
});
