/**
 * AiWaiting.test.tsx — the waiting experience tells the truth, and only the truth.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiWaiting, newWaitClock, stopWaitClock } from "./AiWaiting";
import { DEFAULT_TYPICAL, describeStep, planReceipt, proposalsReceipt, typicalRange, type ReceiptView, type WaitingStep } from "./model";

const OBJECTIVES = [
  "Students can explain what an algorithm is.",
  "Students can trace a loop by hand.",
  "Students can name one limit of a model.",
  "Students can compare two sources.",
  "Students can ask a good question.",
  "Students can check a claim.",
];
const PLAN_STEP: WaitingStep = { kind: "plan", objectives: OBJECTIVES, topic: "How plants eat", materialNames: ["Lesson notes", "Slides"], referenceNotes: false };
const OBJ_STEP: WaitingStep = {
  kind: "objectives",
  materials: [{ kind: "text", name: "Lesson notes", chars: 1204 }, { kind: "link", url: "https://example.org/photosynthesis" }],
  topic: "Photosynthesis", course: "Science, ages 8-10",
};
const ANSWER_STEP: WaitingStep = { kind: "answer", question: "What do plants need?", earlierTurns: 2, title: "How plants eat", version: 1, objectives: 6, activities: 5 };

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  }));
}

beforeEach(() => { vi.useFakeTimers(); stubMatchMedia(false); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("AiWaiting — plain words with real numbers", () => {
  it("names the step with the count in the view (and says one, not 1 objectives)", () => {
    const { unmount } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    expect(screen.getByText("Drafting a lesson plan from your 6 confirmed objectives")).toBeInTheDocument();
    unmount();
    render(<AiWaiting step={{ ...PLAN_STEP, objectives: OBJECTIVES.slice(0, 1) }} phase="running" />);
    expect(screen.getByText("Drafting a lesson plan from your 1 confirmed objective")).toBeInTheDocument();
  });

  it("counts what is being proposed from, and says when a link is read first", () => {
    render(<AiWaiting step={OBJ_STEP} phase="running" />);
    expect(screen.getByText("Proposing learning objectives from your 1 text and 1 link")).toBeInTheDocument();
    expect(screen.getByText(/1 link is read by the site first/)).toBeInTheDocument();
  });

  it("names the published version a student's answer comes from (compact)", () => {
    render(<AiWaiting step={ANSWER_STEP} phase="running" variant="compact" />);
    expect(screen.getByText("Looking for the answer in version 1 of this lesson")).toBeInTheDocument();
  });

  it("shows no progress bar and no percentage, ever", () => {
    const { container } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    advance(30_000);
    expect(container.querySelector("progress, [role='progressbar'], meter")).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
  });
});

describe("AiWaiting — a real clock and the typical range", () => {
  it("elapsed time advances with the clock", () => {
    render(<AiWaiting step={PLAN_STEP} phase="running" />);
    expect(screen.getByText("0 s")).toBeInTheDocument();
    advance(3_000);
    expect(screen.getByText("3 s")).toBeInTheDocument();
    advance(9_000);
    expect(screen.getByText("12 s")).toBeInTheDocument();
    advance(60_000);
    expect(screen.getByText("1 min 12 s")).toBeInTheDocument();
  });

  it("holds the clock while the passcode dialog waits for the teacher", () => {
    const { rerender } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    advance(4_000);
    rerender(<AiWaiting step={PLAN_STEP} phase="running" paused />);
    expect(screen.getByText(/Waiting for your passcode/)).toBeInTheDocument();
    advance(90_000);
    rerender(<AiWaiting step={PLAN_STEP} phase="running" paused={false} />);
    expect(screen.getByText("4 s")).toBeInTheDocument();
    expect(screen.queryByText(/Taking longer than usual/)).not.toBeInTheDocument();
  });

  it("takes the typical range from the worker status typicalSeconds", () => {
    render(<AiWaiting step={PLAN_STEP} phase="running" typicalSeconds={{ plan: [8, 40], objectives: [1, 2] }} />);
    expect(screen.getByText(/usually 8\u201340 seconds/)).toBeInTheDocument();
  });

  it("falls back to exactly the documented defaults when typicalSeconds is absent", () => {
    expect(DEFAULT_TYPICAL).toEqual({ objectives: [3, 15], plan: [5, 25], answer: [2, 8] });
    const { unmount } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    expect(screen.getByText(/usually 5\u201325 seconds/)).toBeInTheDocument();
    unmount();
    const o = render(<AiWaiting step={OBJ_STEP} phase="running" typicalSeconds={{}} />);
    expect(screen.getByText(/usually 3\u201315 seconds/)).toBeInTheDocument();
    o.unmount();
    render(<AiWaiting step={ANSWER_STEP} phase="running" variant="compact" typicalSeconds={null} />);
    expect(screen.getByText(/usually 2\u20138 seconds/)).toBeInTheDocument();
  });

  it("ignores a malformed range instead of showing nonsense", () => {
    for (const bad of [{ plan: [30, 10] }, { plan: [5] }, { plan: ["5", "25"] }, { plan: [-1, 4] }, { plan: [Number.NaN, 9] }, "x", 7]) {
      expect(typicalRange("plan", bad)).toEqual([5, 25]);
    }
    expect(typicalRange("plan", { plan: [7.4, 31.6] })).toEqual([7, 32]);
  });
});

describe("AiWaiting — taking longer than usual", () => {
  it("appears only after the high end of the range, and says what is true", () => {
    render(<AiWaiting step={PLAN_STEP} phase="running" />);
    advance(25_000);
    expect(screen.queryByText(/Taking longer than usual/)).not.toBeInTheDocument();
    advance(1_000);
    expect(screen.getByText(/Taking longer than usual\. If the model does not answer, this step stops by itself, and nothing you have recorded is lost\./)).toBeInTheDocument();
  });

  it("uses the range it was given for the threshold", () => {
    render(<AiWaiting step={ANSWER_STEP} phase="running" variant="compact" typicalSeconds={{ answer: [1, 3] }} />);
    advance(3_000);
    expect(screen.queryByText(/Taking longer than usual/)).not.toBeInTheDocument();
    advance(1_000);
    expect(screen.getByText(/Taking longer than usual/)).toBeInTheDocument();
  });
});

describe("AiWaiting — what the model sees", () => {
  const sees = () => screen.getByRole("button", { name: "What the model sees" });

  it("is closed at first, and opens and closes from the keyboard", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<AiWaiting step={PLAN_STEP} phase="running" />);
    expect(sees()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Students can trace a loop by hand.")).not.toBeVisible();
    await user.tab();
    expect(sees()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(sees()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Students can trace a loop by hand.")).toBeVisible();
    await user.keyboard(" ");
    expect(sees()).toHaveAttribute("aria-expanded", "false");
  });

  it("plan: lists exactly the confirmed statements, the topic and the material NAMES, and what it never sees", () => {
    render(<AiWaiting step={PLAN_STEP} phase="running" />);
    fireEvent.click(sees());
    const panel = document.getElementById(sees().getAttribute("aria-controls")!)!;
    const items = within(panel).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      ...OBJECTIVES,
      "How plants eat",
      "Lesson notes", "Slides",
      "Use only these objectives and cite each by its internal id.", "Student chat is never evidence of learning.",
      "The text of your materials", "Your name or the label on your record", "Anything else from your record",
    ]);
    expect(within(panel).getByText("Objectives")).toBeInTheDocument();
    expect(within(panel).getByText("What it never sees")).toBeInTheDocument();
  });

  it("plan: the teacher's course answer is listed, quoted, with the instruction that goes with it; absent, nothing changes", () => {
    const withCourse = describeStep({ ...PLAN_STEP, course: "Grade 3 math, one 45-minute lesson" });
    const group = withCourse.sends.find((g) => g.heading === "Course");
    expect(group).toEqual({ heading: "Course", items: ["Grade 3 math, one 45-minute lesson"], quote: true });
    expect(withCourse.sends.map((g) => g.heading)).toEqual(["Objectives", "Topic", "Course", "Material names", "Instructions"]);
    expect(withCourse.sends.at(-1)?.items).toContain("Fit the plan to any length or audience you state in your course answer.");

    for (const course of [undefined, "", "   "]) {
      const t = describeStep({ ...PLAN_STEP, course });
      expect(t.sends.map((g) => g.heading)).toEqual(["Objectives", "Topic", "Material names", "Instructions"]);
      expect(t.sends.at(-1)?.items).toEqual(["Use only these objectives and cite each by its internal id.", "Student chat is never evidence of learning."]);
    }
  });

  it("plan: the open disclosure shows the course", () => {
    render(<AiWaiting step={{ ...PLAN_STEP, course: "Grade 3 math, one 45-minute lesson" }} phase="running" />);
    fireEvent.click(screen.getByRole("button", { name: "What the model sees" }));
    expect(screen.getByText(/Grade 3 math, one 45-minute lesson/)).toBeInTheDocument();
  });

  it("objectives: lists each material with its character count, and a link as a link", () => {
    const t = describeStep(OBJ_STEP);
    expect(t.sends[0].items).toEqual([
      "Lesson notes \u00b7 1,204 characters, as you provided it",
      "https://example.org/photosynthesis \u00b7 the site reads this page first; only its text goes on",
    ]);
    expect(t.sends[1].items).toEqual(["Topic: Photosynthesis", "Course: Science, ages 8-10"]);
    expect(JSON.stringify(t.sends)).not.toContain("Lesson notes text"); // the text itself is never part of the view model
  });

  it("answer: lists the question, the earlier turns (at most 6) and the published package, nothing else", () => {
    const t = describeStep({ ...ANSWER_STEP, earlierTurns: 9 });
    expect(t.sends.map((g) => g.heading)).toEqual(["Question", "Earlier chat", "Version 1", "Instructions"]);
    expect(t.sends[0].items).toEqual(["What do plants need?"]);
    expect(t.sends[1].items).toEqual(["The last 6 messages shown above"]);
    expect(t.never).toContain("Anything you have changed since version 1");
  });

  it("says nothing about retention unless it knows, and claims zero-retention only for an explicit true", () => {
    const { rerender } = render(<AiWaiting step={PLAN_STEP} phase="running" zdr={null} />);
    expect(document.body.textContent).not.toMatch(/retention/);
    rerender(<AiWaiting step={PLAN_STEP} phase="running" zdr={false} />);
    expect(document.body.textContent).toMatch(/normal data-retention terms \(not zero-retention\)/);
    expect(document.body.textContent).not.toMatch(/zero-data-retention/);
    rerender(<AiWaiting step={PLAN_STEP} phase="running" zdr />);
    expect(document.body.textContent).toMatch(/zero-data-retention endpoints only/);
  });
});

describe("AiWaiting — motion", () => {
  it("runs the type-setting motion normally and switches it off under prefers-reduced-motion", () => {
    const { container, unmount } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    expect(container.querySelector("section")).toHaveAttribute("data-motion", "live");
    unmount();
    stubMatchMedia(true);
    const r = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    expect(r.container.querySelector("section")).toHaveAttribute("data-motion", "still");
  });

  it("the stylesheet removes every animation for still motion and for the media query", () => {
    const css = readFileSync(join(process.cwd(), "src/components/AiWaiting/AiWaiting.module.css"), "utf8");
    expect(css).toMatch(/\[data-motion="still"\] \.word \{ animation: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*animation: none/);
    // the only place an animation is switched ON is the live-motion rule
    expect(css.match(/animation: [^n;][^;]*;/g)).toEqual(['animation: set 3.9s var(--ease-standard) infinite;']);
  });
});

describe("AiWaiting — the clock belongs to the step, not to the card", () => {
  // The stage page renders the waiting card in whichever stage is open, so a step that finishes moves the card
  // to the next stage and React mounts a NEW card already "done". A card-local clock then said "Took 0 s" after
  // an 18 s plan (seen in a real-model run). The caller passes the step's clock; the card only reads and banks it.
  it("a card remounted after the step finished says the real time, not 0 s", () => {
    const clock = newWaitClock();
    const first = render(<AiWaiting step={PLAN_STEP} phase="running" clock={clock} />);
    advance(18_000);
    first.rerender(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    first.unmount();
    render(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    expect(screen.getByText("18 s").parentElement).toHaveTextContent("Took 18 s");
  });

  it("a card that unmounts mid-step and remounts done still counts the whole wait", () => {
    const clock = newWaitClock();
    const first = render(<AiWaiting step={PLAN_STEP} phase="running" clock={clock} />);
    advance(10_000);
    first.unmount();                 // the stage changed while the model was still working
    advance(8_000);                  // ...and the model kept working with no card mounted
    render(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    expect(screen.getByText("18 s").parentElement).toHaveTextContent("Took 18 s");
  });

  it("a finished clock stops: remounting minutes later adds nothing", () => {
    const clock = newWaitClock();
    const first = render(<AiWaiting step={PLAN_STEP} phase="running" clock={clock} />);
    advance(18_000);
    first.rerender(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    first.unmount();
    advance(5 * 60_000);             // the teacher reads the plan for five minutes, then opens another stage
    render(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    expect(screen.getByText("18 s").parentElement).toHaveTextContent("Took 18 s");
  });

  it("a card remounted after the finish does not announce again (it was already said)", () => {
    const clock = newWaitClock();
    const first = render(<AiWaiting step={PLAN_STEP} phase="running" clock={clock} />);
    advance(18_000);
    first.rerender(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    first.unmount();
    render(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    expect((document.querySelector("[aria-live='polite']") as HTMLElement).textContent).toBe("");
  });

  it("the caller stops the clock at the real finish, even when no card is mounted then", () => {
    const clock = newWaitClock();
    const first = render(<AiWaiting step={PLAN_STEP} phase="running" clock={clock} />);
    advance(10_000);
    first.unmount();
    advance(8_000);
    stopWaitClock(clock);            // LiveCourse.finishWait: the host answered at 18 s
    advance(60_000);                 // the next stage opens a minute later
    render(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    expect(screen.getByText("18 s").parentElement).toHaveTextContent("Took 18 s");
  });

  it("time at the passcode dialog is still held out of a shared clock", () => {
    const clock = newWaitClock();
    const { rerender } = render(<AiWaiting step={PLAN_STEP} phase="running" paused clock={clock} />);
    advance(30_000);                 // the teacher types the passcode
    rerender(<AiWaiting step={PLAN_STEP} phase="running" clock={clock} />);
    advance(6_000);
    rerender(<AiWaiting step={PLAN_STEP} phase="done" clock={clock} />);
    expect(screen.getByText("6 s").parentElement).toHaveTextContent("Took 6 s");
  });
});

describe("AiWaiting — announcements and the receipt", () => {
  const live = () => document.querySelector("[aria-live='polite']") as HTMLElement;

  it("has one polite live region, written at the start and at the finish, never every second", () => {
    const writes: string[] = [];
    const { rerender } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
    const seen = () => { const t = live().textContent ?? ""; if (writes.at(-1) !== t) writes.push(t); };
    seen();
    for (let i = 0; i < 20; i += 1) { advance(1_000); seen(); }
    expect(writes).toEqual(["Drafting a lesson plan from your 6 confirmed objectives. Usually 5 to 25 seconds."]);
    rerender(<AiWaiting step={PLAN_STEP} phase="done" receipt={["Checked: 5 activities, each cites only objectives you confirmed (9 citations)."]} />);
    seen();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe("Finished after 20 s. Checked: 5 activities, each cites only objectives you confirmed (9 citations).");
    advance(10_000);
    seen();
    expect(writes).toHaveLength(2);
  });

  it("shows how long it took and the receipt when done, and stops the clock", () => {
    const { rerender } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    advance(12_000);
    rerender(<AiWaiting step={PLAN_STEP} phase="done" receipt={["6 proposals. None is confirmed until you decide."]} />);
    expect(screen.getByText(/Took/)).toBeInTheDocument();
    expect(screen.getByText("12 s")).toBeInTheDocument();
    expect(screen.getAllByText("6 proposals. None is confirmed until you decide.").length).toBeGreaterThan(0);
    advance(60_000);
    expect(screen.getByText("12 s")).toBeInTheDocument();
    expect(screen.queryByText(/Taking longer than usual/)).not.toBeInTheDocument();
  });

  it("changes tense when it finishes, so 'Done' and the title agree", () => {
    const { rerender } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    rerender(<AiWaiting step={PLAN_STEP} phase="done" />);
    expect(screen.getByText("Drafted a lesson plan from your 6 confirmed objectives")).toBeInTheDocument();
    expect(screen.queryByText("Drafting a lesson plan from your 6 confirmed objectives")).not.toBeInTheDocument();
  });

  it("says plainly when a step stopped, with no receipt", () => {
    const { rerender } = render(<AiWaiting step={PLAN_STEP} phase="running" />);
    advance(7_000);
    rerender(<AiWaiting step={PLAN_STEP} phase="failed" />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("7 s").parentElement).toHaveTextContent("Stopped after 7 s");
    expect(live().textContent).toBe("Stopped after 7 s.");
  });

  it("a finished compact step leaves only its announcement: the answer itself is the result", () => {
    const { rerender, container } = render(<AiWaiting step={ANSWER_STEP} phase="running" variant="compact" />);
    advance(3_000);
    rerender(<AiWaiting step={ANSWER_STEP} phase="done" variant="compact" />);
    expect(container.textContent).toBe("Finished after 3 s.");
    expect(container.querySelector("button")).toBeNull();
  });
});

/* ---------------------------- receipts, from a view ---------------------------- */

const act_ = (id: string, objectiveIds: string[]) => ({
  id, title: id, minutes: 5, objectiveIds, materialVersionIds: [], learnerDoes: "x", teacherDoes: "y", evidenceIfAny: "none" as const,
});
const obj = (id: string) => ({ id, kind: "local" as const, statement: `Statement ${id}` });
const prop = (id: string, status: "proposed" | "accepted" | "added" = "proposed", by: "ai" | "teacher" = "ai") =>
  ({ id, kind: "local" as const, status, statement: id, originalStatement: id, source: null, alignment: null, by });

function planView(acts: ReturnType<typeof act_>[], objectives: string[], status: "draft" | "confirmed" = "draft"): ReceiptView {
  return {
    proposals: [], materialsUsed: [], objectives: objectives.map(obj),
    plan: { id: "p", courseId: "c", courseVersion: 1, title: "T", status, activities: acts, proposedBy: "ai", proposedAt: 1 },
  };
}

describe("receipts are recomputed from the resulting view", () => {
  it("plan: counts activities and citations, and checks every citation against the confirmed objectives", () => {
    const view = planView(
      [act_("a1", ["o1", "o2"]), act_("a2", ["o2"]), act_("a3", ["o3"]), act_("a4", ["o1", "o3", "o4"]), act_("a5", ["o4"])],
      ["o1", "o2", "o3", "o4"],
    );
    expect(planReceipt(view)).toEqual([
      "Checked: 5 activities, each cites only objectives you confirmed (8 citations).",
      "It stays a draft until you confirm it.",
    ]);
  });

  it("plan: says so when an activity cites something that is not a confirmed objective", () => {
    const view = planView([act_("a1", ["o1"]), act_("a2", ["ghost"]), act_("a3", [])], ["o1"]);
    expect(planReceipt(view)[0]).toBe("Checked: 2 of 3 activities cite something other than your confirmed objectives. Read the plan closely before you confirm it.");
  });

  it("plan: says which confirmed objectives no activity covers, and is singular for one activity", () => {
    const view = planView([act_("a1", ["o1"])], ["o1", "o2", "o3"]);
    expect(planReceipt(view)).toEqual([
      "Checked: 1 activity, each cites only objectives you confirmed (1 citation).",
      "2 of your 3 confirmed objectives are not in any activity yet.",
      "It stays a draft until you confirm it.",
    ]);
    expect(planReceipt(planView([act_("a1", ["o1"])], ["o1"], "confirmed"))).toEqual(["Checked: 1 activity, each cites only objectives you confirmed (1 citation)."]);
  });

  it("plan: no plan, no receipt", () => {
    expect(planReceipt({ proposals: [], objectives: [], plan: null })).toEqual([]);
  });

  it("proposals: counts the AI's proposals and says none is confirmed, with what was read", () => {
    const view: ReceiptView = {
      proposals: [prop("a"), prop("b"), prop("c"), prop("d"), prop("e"), prop("f")], objectives: [], plan: null,
      materialsUsed: [{ name: "Lesson notes", digest: "x", chars: 1204 }, { name: "Slides", digest: "y", chars: 3006 }],
    };
    expect(proposalsReceipt(view)).toEqual([
      "6 proposals. None is confirmed until you decide.",
      "Drawn from 2 materials (4,210 characters read).",
    ]);
  });

  it("proposals: never says 'none is confirmed' when one already is, and ignores the teacher's own objectives", () => {
    const view: ReceiptView = { proposals: [prop("a"), prop("b", "accepted"), prop("t", "added", "teacher")], objectives: [], plan: null, materialsUsed: [] };
    expect(proposalsReceipt(view)).toEqual(["2 proposals, 1 still waiting for your decision."]);
    expect(proposalsReceipt({ proposals: [prop("a")], objectives: [], plan: null })).toEqual(["1 proposal. None is confirmed until you decide."]);
    expect(proposalsReceipt({ proposals: [], objectives: [], plan: null })).toEqual([]);
  });
});

/* ---------------------------- contrast ---------------------------- */

describe("every text pair the waiting card sets is AA (>= 4.5:1)", () => {
  const tokens = Object.fromEntries([...readFileSync(join(process.cwd(), "src/design/tokens.css"), "utf8").matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg: string, bg: string) => { const [a, b] = [lum(tokens[fg]), lum(tokens[bg])].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  // [text colour, ground it is set on] — read from AiWaiting.module.css
  const PAIRS: [string, string][] = [
    ["ink", "paper-raised"], ["ink-soft", "paper-raised"], ["ink-muted", "paper-raised"], // title, clock, eyebrow
    ["ink", "paper"], ["ink-soft", "paper"], ["ink-muted", "paper"],                        // the ledger and its labels, and the compact card
    ["ink-soft", "paper-raised"],                                                            // "What it never sees"
    ["ink", "accepted-bg"],                                                                  // the receipt
    ["accent-strong", "paper-raised"], ["accent-strong", "paper"],                           // the disclosure button
  ];
  it.each(PAIRS)("%s on %s", (fg, bg) => { expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5); });
});

describe("AiWaiting — the suggest step (sprint weekend-share)", () => {
  const SUGGEST: WaitingStep = { kind: "suggest", outcomes: ["Name a unit fraction."], topic: "Unit fractions", course: "Grade 3 math", alreadyListed: 2 };

  it("says what is sent: the teacher's outcomes, topic, course and the wording already on the page", () => {
    const t = describeStep(SUGGEST);
    expect(t.title).toBe("Suggesting up to 3 objectives that round out yours");
    const sent = t.sends.map((g) => g.heading);
    expect(sent).toEqual(["Your outcomes", "Named by you", "Already listed", "Instructions"]);
    expect(t.sends.find((g) => g.heading === "Already listed")!.items[0]).toContain("2 objectives");
    expect(t.never).toContain("The text of your materials");
  });

  it("reuses the objectives timing (the worker status may name 'suggest' or not)", () => {
    expect(typicalRange("suggest")).toEqual(DEFAULT_TYPICAL.objectives);
    expect(typicalRange("suggest", { objectives: [4, 9] })).toEqual([4, 9]);
  });

  it("never claims the AI decided anything while it runs", () => {
    render(<AiWaiting step={SUGGEST} phase="running" />);
    expect(screen.getByText(/nothing is decided yet/i)).toBeInTheDocument();
  });

  it("the student's answer step tells the truth about the new prompt (a cited idea may be explained)", () => {
    const t = describeStep(ANSWER_STEP);
    const text = JSON.stringify(t);
    expect(text).toContain("explain it in plain words for the learners");
    expect(text).not.toMatch(/package/i);
  });
});
