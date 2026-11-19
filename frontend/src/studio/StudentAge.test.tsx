/**
 * StudentAge.test.tsx — N4 (owner, 18 Nov): Rehearse and the student preview show the attempt_first reply (under 18),
 * the general explanation label and the nudge (18+), and the trace names the kind.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudentAnswer } from "../gate/transport";
import { Learn } from "./Learn";
import { Rehearse } from "./Rehearse";

const { COURSE_ID, state } = vi.hoisted(() => ({
  COURSE_ID: "urn:uuid:11111111-2222-3333-4444-555555555555",
  state: { replies: [] as unknown[] },
}));

vi.mock("../gate/transport", async (orig) => {
  const real = await orig<typeof import("../gate/transport")>();
  const view = {
    course: { courseId: COURSE_ID, owner: "Dr. Okafor", title: "Supply and demand" },
    versions: [{ version: 1, owner: "Dr. Okafor", title: "Supply and demand", objectiveRefs: [{ id: "o-1", statement: "Students can explain why a price rises." }] }],
    timeline: [], ledger: [], integrity: { events: 1, head: "h" },
  };
  const host = {
    getCourse: async () => view,
    workerStatus: async () => ({ configured: true }),
    askStudent: async () => state.replies.shift(),
  };
  return { ...real, host: host as unknown as typeof real.host };
});

const NOTE = "Asking questions here is not evidence of learning.";
const TRY_FIRST: StudentAnswer = {
  answer: "This one is for you to try first: Predict the new price. Ask me after you've had a go.",
  grounded: false, cites: [{ id: "activity:2", label: "Activity 2: Predict the new price" }], note: NOTE,
  kind: "attempt_first", activity: { id: "activity:2", title: "Predict the new price" },
};
const GENERAL: StudentAnswer = { answer: "Price elasticity measures how much quantity responds to price.", grounded: false, cites: [], note: NOTE, kind: "answer", basis: "explanation", general: true };
const NUDGE: StudentAnswer = {
  answer: "Worth trying this yourself first. Here's a nudge: Start from what happens to demand.",
  grounded: true, cites: [{ id: "activity:2", label: "Activity 2: Predict the new price" }], note: NOTE, kind: "answer", basis: "plan", nudge: true,
};

afterEach(() => { cleanup(); state.replies = []; });

async function askAll(placeholder: string, questions: string[]) {
  const user = userEvent.setup();
  const box = await screen.findByPlaceholderText(placeholder);
  for (const q of questions) {
    await user.type(box, q);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(q);
  }
  return user;
}

describe("N4 · student preview (Learn)", () => {
  it("attempt_first reads as the host wrote it; a general answer carries the plain label; a nudge cites the activity", async () => {
    state.replies = [TRY_FIRST, GENERAL, NUDGE];
    render(<Learn courseId={COURSE_ID} />);
    await askAll("Ask about today’s lesson", ["how do I do activity 2"]);
    await screen.findByText(TRY_FIRST.answer);
    expect(screen.queryByText(/From the lesson/u)).not.toBeInTheDocument();
    await askAll("Ask about today’s lesson", ["what is elasticity"]);
    await screen.findByText(GENERAL.answer);
    expect(screen.getByText("General explanation, not from your lesson")).toBeInTheDocument();
    await askAll("Ask about today’s lesson", ["help with predicting"]);
    await screen.findByText(NUDGE.answer);
    expect(screen.getByText(/From the lesson: Activity 2: Predict the new price/u)).toBeInTheDocument();
  });
});

describe("N4 · Rehearse names the kind in the trace", () => {
  it("attempt_first, the general explanation and the nudge each get their own label and trace", async () => {
    state.replies = [TRY_FIRST, GENERAL, NUDGE];
    render(<Rehearse courseId={COURSE_ID} />);
    await askAll("Type as a student would…", ["how do I do activity 2"]);
    expect((await screen.findAllByText("Try first · fixed text, nothing explained (under 18)")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/“Predict the new price” is for the student to try first/u)).toBeInTheDocument();
    expect(document.querySelector('[data-kind="attempt_first"]')).not.toBeNull();

    await askAll("Type as a student would…", ["what is elasticity"]);
    expect((await screen.findAllByText("General explanation, not from your lesson")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Nothing from your plan: a general explanation of the course’s subject/u)).toBeInTheDocument();

    await askAll("Type as a student would…", ["help with predicting"]);
    expect((await screen.findAllByText("Nudge on a try-first activity · Based on your plan")).length).toBeGreaterThanOrEqual(1);
  });
});
