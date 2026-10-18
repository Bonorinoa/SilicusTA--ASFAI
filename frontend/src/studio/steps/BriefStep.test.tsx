/**
 * BriefStep.test.tsx — lane A1+A2: the brief collapses to one decision.
 *
 * Three clicks used to make one decision: confirm the source list, save the answers, confirm the
 * brief. The fixed step shows the three questions immediately (they exist on the host from the
 * start — LOCAL_QUESTIONS — and the host accepts intake answers before the files checkpoint), and
 * a single primary "Confirm the brief" that records any unsaved answers, confirms the (empty or
 * listed) source list, then confirms the outline — leaving each step as its own intent. The copy
 * about the source list must never speak of "this list" when there is no list.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HostView } from "../../gate/transport";
import type { HeldFile } from "../../materials/session";
import type { StepProps } from "../CourseStudio";
import { useCourse } from "../useCourse";
import { BriefStep } from "./BriefStep";

const QUESTIONS = [
  { id: "topic", prompt: "What topic should this lesson cover?", reason: "The outline needs a subject." },
  { id: "course", prompt: "Which course is this part of?", reason: "Course context sets scope and sequencing." },
  { id: "learning_outcomes", prompt: "What should learners be able to do by the end?", reason: "An observable outcome anchors the outline." },
];

const intake = (answers: Record<string, string>) => ({
  courseId: "urn:uuid:11111111-2222-3333-4444-555555555555", guardState: "ready", observedState: null,
  questionsFrom: "local", roundOpened: false, roundAnswered: false, questions: QUESTIONS, answeredKeys: Object.keys(answers),
  answers, outlineAuthorized: true, mayCallPrepareOutline: true, refusal: null,
} as unknown as HostView["intake"]);

function view(files: "pending" | "confirmed", outline: "pending" | "confirmed", materials: { name: string }[], answers: Record<string, string>): HostView {
  return {
    course: { courseId: "urn:uuid:11111111-2222-3333-4444-555555555555", owner: "Ada Lovelace", title: "How plants eat", description: "", materials, createdAt: 1 },
    checkpoints: {
      files: { id: "files", status: files, provenance: null, note: null },
      outline: { id: "outline", status: outline, provenance: null, note: null },
      objectives: { id: "objectives", status: "pending", provenance: null, note: null },
      plan: { id: "plan", status: "pending", provenance: null, note: null },
      publish: { id: "publish", status: "pending", provenance: null, note: null },
    },
    intake: intake(answers),
  } as unknown as HostView;
}

/** A useCourse-shaped object with recorded action spies. */
function makeC(overrides: Partial<ReturnType<typeof useCourse>> = {}) {
  const base = {
    view: null, missing: false, busy: false, notice: null, setNotice: vi.fn(),
    waiting: null, sources: [] as HeldFile[], setSources: vi.fn(), reload: vi.fn(async () => null),
    actions: {
      confirmSources: vi.fn(), answerBrief: vi.fn(), confirmBrief: vi.fn(), confirmTheBrief: vi.fn(),
      proposeFromAnswers: vi.fn(), proposeFromSources: vi.fn(), suggestMore: vi.fn(), decide: vi.fn(),
      draftPlan: vi.fn(), confirmPlan: vi.fn(), publish: vi.fn(), exportVersion: vi.fn(), pins: vi.fn(),
    },
  };
  return { ...base, ...overrides, actions: { ...base.actions, ...(overrides.actions ?? {}) } } as unknown as StepProps["c"];
}

const renderBrief = (v: HostView, c: StepProps["c"]) => render(<BriefStep c={c} view={v} looking={false} worker={null} onLook={vi.fn()} />);

const FILL = {
  topic: "Photosynthesis",
  course: "Grade 4 science, ages 9–10",
  outcomes: "Explain how a plant makes its food",
};

describe("A1: the brief is one decision, not three", () => {
  it("shows the three questions before the sources are confirmed (the host has them from the start)", () => {
    const c = makeC();
    renderBrief(view("pending", "pending", [], {}), c);
    expect(screen.getByRole("heading", { name: "Three questions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Topic")).toBeInTheDocument();
    expect(screen.getByLabelText("Who it’s for")).toBeInTheDocument();
    expect(screen.getByLabelText("What learners should be able to do")).toBeInTheDocument();
    // And nothing was confirmed: there is no first click to make before the questions.
    expect(c.actions.confirmSources).not.toHaveBeenCalled();
  });

  it("with complete unsaved answers the single primary is 'Confirm the brief', wired to confirmTheBrief", async () => {
    const c = makeC();
    renderBrief(view("confirmed", "pending", [{ name: "Lesson notes" }], {}), c);
    await userEvent.type(screen.getByLabelText("Topic"), FILL.topic);
    await userEvent.type(screen.getByLabelText("Who it’s for"), FILL.course);
    await userEvent.type(screen.getByLabelText("What learners should be able to do"), FILL.outcomes);
    const primary = screen.getByRole("button", { name: "Confirm the brief" });
    expect(primary).toBeEnabled();
    await userEvent.click(primary);
    // One click, two intents: first the unsaved answers, then the outline (the files step is already done, so no source intent).
    expect(c.actions.confirmTheBrief).toHaveBeenCalledWith(
      { topic: FILL.topic, course: FILL.course, learning_outcomes: FILL.outcomes },
      { sources: false },
    );
  });

  it("with the source list unconfirmed the same primary also confirms it (sources intent first)", async () => {
    const c = makeC();
    renderBrief(view("pending", "pending", [], {}), c);
    await userEvent.type(screen.getByLabelText("Topic"), FILL.topic);
    await userEvent.type(screen.getByLabelText("Who it’s for"), FILL.course);
    await userEvent.type(screen.getByLabelText("What learners should be able to do"), FILL.outcomes);
    await userEvent.click(screen.getByRole("button", { name: "Confirm the brief" }));
    expect(c.actions.confirmTheBrief).toHaveBeenCalledWith(
      { topic: FILL.topic, course: FILL.course, learning_outcomes: FILL.outcomes },
      { sources: true },
    );
  });

  it("an already-saved brief confirms without re-recording the answers", async () => {
    const c = makeC();
    renderBrief(view("confirmed", "pending", [], {
      topic: FILL.topic, course: FILL.course, learning_outcomes: FILL.outcomes,
    }), c);
    await userEvent.click(screen.getByRole("button", { name: "Confirm the brief" }));
    expect(c.actions.confirmTheBrief).toHaveBeenCalledWith(null, { sources: false });
  });

  it("keeps a quiet 'Save answers' secondary beside the confirm primary, for saving without deciding", async () => {
    const c = makeC();
    renderBrief(view("confirmed", "pending", [], {}), c);
    await userEvent.type(screen.getByLabelText("Topic"), FILL.topic);
    await userEvent.type(screen.getByLabelText("Who it’s for"), FILL.course);
    await userEvent.type(screen.getByLabelText("What learners should be able to do"), FILL.outcomes);
    expect(screen.getByRole("button", { name: "Confirm the brief" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save answers" }));
    expect(c.actions.answerBrief).toHaveBeenCalledWith(
      { topic: FILL.topic, course: FILL.course, learning_outcomes: FILL.outcomes },
    );
    expect(c.actions.confirmTheBrief).not.toHaveBeenCalled();
  });

  it("while an answer is missing the primary is a disabled 'Confirm the brief'", () => {
    renderBrief(view("confirmed", "pending", [], {}), makeC());
    expect(screen.getByRole("button", { name: "Confirm the brief" })).toBeDisabled();
    expect(screen.getByText("Answer each question to continue.")).toBeInTheDocument();
  });
});

describe("A2: the sources copy is true for zero sources and for a list", () => {
  it("at first run with zero sources the page never asks about an empty list", () => {
    renderBrief(view("pending", "pending", [], {}), makeC());
    expect(screen.queryByText(/Is this list right\?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Start with your sources/)).not.toBeInTheDocument();
  });

  it("with zero sources the confirm bar says so honestly, once the answers are complete", async () => {
    const c = makeC();
    renderBrief(view("pending", "pending", [], {}), c);
    await userEvent.type(screen.getByLabelText("Topic"), FILL.topic);
    await userEvent.type(screen.getByLabelText("Who it’s for"), FILL.course);
    await userEvent.type(screen.getByLabelText("What learners should be able to do"), FILL.outcomes);
    expect(screen.getAllByText(/No sources yet\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/your answers alone can brief Silicus/)).toBeInTheDocument();
    expect(screen.queryByText(/Is this list right\?/)).not.toBeInTheDocument();
    // The same text must not carry a machine id or a gate string.
    expect(screen.queryByText(/urn:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/learning_outcomes/)).not.toBeInTheDocument();
  });

  it("with a non-empty list the confirm bar asks about the list itself", async () => {
    renderBrief(view("pending", "pending", [{ name: "Lesson notes" }, { name: "Chapter 4 slides" }], {}), makeC());
    await userEvent.type(screen.getByLabelText("Topic"), FILL.topic);
    await userEvent.type(screen.getByLabelText("Who it’s for"), FILL.course);
    await userEvent.type(screen.getByLabelText("What learners should be able to do"), FILL.outcomes);
    expect(screen.getByText(/Is this list right\?/)).toBeInTheDocument();
    expect(screen.queryByText(/No sources yet\./)).not.toBeInTheDocument();
  });
});