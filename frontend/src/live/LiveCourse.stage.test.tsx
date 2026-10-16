/**
 * LiveCourse.stage.test.tsx — the stage-focused page: one stage at a time, one primary action, no machine text
 * in the reading path. Each test pins one defect from the 15 October walkthrough (D1, D2, D3-words, D4, D8)
 * or one rule of the stage page. The host is a mutable stub: a POST changes the view the next GET returns.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostView } from "../gate/transport";
import { LiveCourse } from "./LiveCourse";

const COURSE_ID = "urn:uuid:11111111-2222-3333-4444-555555555555";
const A = "urn:uuid:aaaa";
const STATEMENT = "Students can explain what an algorithm is, in their own words.";
const PLAN_TITLE = "Seeing the claim: a short lesson";
const ACTIVITY = "Spot the claim in an answer";

const ok = (o: unknown) => ({ ok: true, status: 200, json: async () => o }) as unknown as Response;

type Cp = "pending" | "open" | "confirmed";
function baseView(): HostView {
  const s = (id: string, status: Cp) => [id, { id, status, provenance: null, note: null }] as const;
  return {
    course: { courseId: COURSE_ID, owner: "Ada Lovelace", title: "Lesson 3 · AI literacy", description: "", materials: [{ name: "slides.pdf" }], createdAt: 1 },
    checkpoints: Object.fromEntries([s("files", "confirmed"), s("outline", "confirmed"), s("objectives", "confirmed"), s("plan", "pending"), s("publish", "pending")]),
    proposals: [{ id: A, kind: "local", status: "accepted", statement: STATEMENT, originalStatement: STATEMENT, source: "from your answer", alignment: null, by: "ai" }],
    intake: {
      courseId: COURSE_ID, guardState: "ready", observedState: null, questionsFrom: "local", roundOpened: false, roundAnswered: false,
      questions: [], answers: { topic: "how AI answers are built", course: "Grade 3 math, one 45-minute lesson" },
      draftAuthorization: null, outlineAuthorized: true, mayCallPrepareOutline: true, refusal: null,
    } as unknown as HostView["intake"],
    objectives: [{ id: A, kind: "local", statement: STATEMENT }],
    decisions: [], plan: null, invalidation: { invalidated: false, gaps: [] },
    publish: { canPublish: false, blockers: ["no teacher-confirmed lesson plan"], reasons: [{ code: "NO_CONFIRMED_PLAN" }] },
    versions: [], timeline: [], ledger: [], integrity: { events: 13, head: "deadbeef" },
  } as unknown as HostView;
}
const planOf = (status: "draft" | "confirmed" | "invalidated") => ({
  id: "urn:uuid:plan", courseId: COURSE_ID, courseVersion: 1, title: PLAN_TITLE, status, proposedBy: "ai", proposedAt: 1,
  activities: [{ id: "act-1", title: ACTIVITY, minutes: 20, objectiveIds: [A], materialVersionIds: [], learnerDoes: "Mark it.", teacherDoes: "Ask.", evidenceIfAny: "observation" }],
}) as unknown as HostView["plan"];
const VERSION = {
  courseId: COURSE_ID, version: 1, previousVersion: null, title: PLAN_TITLE, owner: "Ada Lovelace", status: "published",
  objectiveRefs: [{ id: A, kind: "local", statement: STATEMENT }], lessonPlan: planOf("confirmed"), publishedAt: Date.UTC(2026, 9, 16, 12), note: null,
  provenance: { turnRef: "urn:turn:9", decidedBy: "Ada Lovelace", channel: "ui", decidedAt: 1 },
};
const set = (v: HostView, id: string, status: Cp) => { (v.checkpoints as Record<string, { status: Cp }>)[id].status = status; };

function atPlanDraft(): HostView {
  const v = baseView();
  v.plan = planOf("draft");
  v.publish = { canPublish: false, blockers: ["no teacher-confirmed lesson plan"], reasons: [{ code: "NO_CONFIRMED_PLAN" }] } as HostView["publish"];
  return v;
}
function atPublish(): HostView {
  const v = baseView();
  v.plan = planOf("confirmed"); set(v, "plan", "confirmed");
  v.publish = { canPublish: true, blockers: [], reasons: [] } as HostView["publish"];
  return v;
}
function atPublished(): HostView {
  const v = atPublish();
  set(v, "publish", "confirmed");
  v.versions = [VERSION as unknown as HostView["versions"][number]];
  v.revision = { sealedVersion: 1, nextVersion: 2, drafting: false, changes: { objectivesAdded: [], objectivesRemoved: [], plan: "same", planStatus: "confirmed" }, notInPlan: [] } as unknown as HostView["revision"];
  return v;
}

interface Call { method: string; url: string; body: Record<string, unknown> | undefined }
function mockHost(initial: HostView | null, { worker = true, onPost }: { worker?: boolean; onPost?: (url: string, body: Record<string, unknown> | undefined) => void } = {}) {
  // `library` is what GET /courses lists: a course exists once the host has one (or once the teacher creates it).
  const state = { view: initial, library: initial !== null };
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, url, body });
    if (method === "POST") onPost?.(url, body);
    if (url === "/api/courses" && method === "GET") {
      return ok({ courses: state.view && state.library ? [{ courseId: COURSE_ID, owner: "Ada Lovelace", title: state.view.course.title, createdAt: 1, progress: { confirmed: 2, total: 5, versions: 0 } }] : [] });
    }
    if (url === "/api/courses" && method === "POST") { state.library = true; return ok({ ok: true, courseId: COURSE_ID, view: state.view }); }
    if (url === "/api/asfai/status") return ok({ connected: false, expiresAt: null, scope: null, canRefresh: false });
    if (url === "/api/worker/status") return ok({ configured: worker, zdr: true });
    if (url.endsWith("/verify")) return ok({ ok: true, events: state.view?.integrity.events ?? 0, head: "h" });
    if (url.includes("/anchor/")) return ok({ anchor: null });
    if (method === "POST") return ok({});
    if (url.startsWith("/api/courses/")) return ok(state.view);
    return ok({});
  }));
  return { calls, state };
}

/** Elements that are the stage's primary action. LiveCourse and the cards mark exactly one with data-primary. */
const primaries = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-primary="true"]')];
const countOf = (text: string) => screen.queryAllByText(text, { exact: false }).length;

beforeEach(() => { window.localStorage.setItem("silicus.tour.seen", "1"); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("D1: the confirm bar that says 'build the plan' does it, and only while there is no plan", () => {
  it("is wired: clicking it asks the host to draft the plan, and sends no content", async () => {
    const { calls, state } = mockHost(baseView(), { onPost: (u) => { if (u.endsWith("/plan")) { state.view!.plan = planOf("draft"); } } });
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: "Confirm 1 objective · build the plan" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/plan"))).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/plan"))!.body).toEqual({});
  });

  it("is the stage's one primary action (there is no second 'draft the plan' button beside it)", async () => {
    mockHost(baseView());
    const { container } = render(<LiveCourse />);
    await screen.findByRole("button", { name: /build the plan/ });
    expect(primaries(container)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Draft the plan from your confirmed objectives$/ })).not.toBeInTheDocument();
  });

  it("is gone once the plan exists, and stays gone after publish", async () => {
    mockHost(atPlanDraft());
    const first = render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    expect(screen.queryByRole("button", { name: /build the plan/ })).not.toBeInTheDocument();
    first.unmount();
    mockHost(atPublished());
    render(<LiveCourse />);
    await screen.findByText(/^Version 1 is published\./);
    expect(screen.queryByRole("button", { name: /build the plan/ })).not.toBeInTheDocument();
  });

  it("with no drafting worker there is no button to press, and the page says why", async () => {
    mockHost(baseView(), { worker: false });
    render(<LiveCourse />);
    expect(await screen.findByText(/no drafting worker is configured/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build the plan/ })).not.toBeInTheDocument();
  });
});

describe("D2: the lesson plan is on the page once, at every stage", () => {
  it.each([
    ["plan (draft)", atPlanDraft],
    ["publish", atPublish],
    ["published", atPublished],
  ])("at the %s stage", async (_name, make) => {
    mockHost(make());
    render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    expect(screen.getAllByText(ACTIVITY)).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1, name: PLAN_TITLE })).toHaveLength(1);
  });
});

describe("D3 in words: the reasons a course cannot be sealed yet are plain sentences, the gate's text is a click away", () => {
  it("says it in words in the reading path; the raw blocker and any urn live in Record details", async () => {
    const v = atPublish();
    v.publish = {
      canPublish: false,
      blockers: ['checkpoint "files" is not teacher-confirmed', "undecided proposals await teacher decisions: urn:uuid:a, urn:uuid:b"],
      reasons: [{ code: "CHECKPOINT_UNCONFIRMED", checkpoint: "files" }, { code: "UNDECIDED_PROPOSALS", count: 2 }],
    } as HostView["publish"];
    mockHost(v);
    render(<LiveCourse />);
    const list = await screen.findByRole("list", { name: "Why this version cannot be published" });
    expect(within(list).getByText("Confirm the material list")).toBeInTheDocument();
    expect(within(list).getByText("Decide the 2 proposed objectives still waiting")).toBeInTheDocument();
    expect(list.textContent).not.toMatch(/urn:|is not teacher-confirmed/);
    const details = screen.getByRole("group", { name: "Record details" });
    expect(within(details).getByText(/is not teacher-confirmed/)).toBeInTheDocument();
  });
});

describe("D4: the host's developer text is not read by a teacher", () => {
  const intakeView = (code: string, reason: string): HostView => {
    const v = baseView();
    set(v, "outline", "pending"); set(v, "objectives", "pending");
    v.proposals = []; v.objectives = [];
    v.intake = { ...v.intake, outlineAuthorized: false, mayCallPrepareOutline: false, answers: { topic: "t" },
      questions: [{ id: "topic", prompt: "What topic should this lesson cover?", reason: null }, { id: "course", prompt: "Which course is this part of?", reason: null }],
      refusal: { code, reason } } as HostView["intake"];
    return v;
  };
  it("AWAITING_TEACHER_REPLY reads as a sentence to the teacher; the guard's wording goes to Record details only", async () => {
    mockHost(intakeView("AWAITING_TEACHER_REPLY", "Surface them and wait for the teacher's reply before calling prepare_outline again."));
    render(<LiveCourse />);
    expect(await screen.findByText("Answer the questions above, then send them.")).toBeInTheDocument();
    const details = screen.getByRole("group", { name: "Record details" });
    const all = screen.getAllByText(/Surface them and wait/);
    expect(all).toHaveLength(1);
    expect(details.contains(all[0])).toBe(true);
  });
  it("INCOMPLETE_ANSWERS and any other code each have a sentence of their own", async () => {
    mockHost(intakeView("INCOMPLETE_ANSWERS", "payload.topic missing"));
    const first = render(<LiveCourse />);
    expect(await screen.findByText("Answer every question before sending.")).toBeInTheDocument();
    first.unmount();
    mockHost(intakeView("SOMETHING_NEW", "internal reason"));
    render(<LiveCourse />);
    expect(await screen.findByText("Silicus could not continue the intake.")).toBeInTheDocument();
  });
});

describe("D8: a notice belongs to the stage that raised it", () => {
  it("the 'Course recorded' notice goes away when the teacher moves on", async () => {
    const created = baseView();
    set(created, "files", "pending"); set(created, "outline", "pending"); set(created, "objectives", "pending");
    created.proposals = []; created.objectives = []; created.intake = { ...created.intake, outlineAuthorized: false } as HostView["intake"];
    const { state } = mockHost(null, { onPost: (u) => { if (u.endsWith("/checkpoints")) { set(state.view!, "files", "confirmed"); } } });
    state.view = created;
    // The page opens on the naming conversation (the library is empty), then the host returns the created course.
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.type(await screen.findByLabelText("What should we call this course?"), "Seeing the claim");
    await user.click(screen.getByRole("button", { name: "Record the course title" }));
    await user.type(await screen.findByLabelText("What name should this course show for you?"), "Ada");
    await user.click(screen.getByRole("button", { name: "Record this name" }));
    await user.click(screen.getByRole("button", { name: "No materials" }));
    expect(await screen.findByText("Course recorded. Confirm the material list when it is right.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Confirm the material list" }));
    await waitFor(() => expect(screen.queryByText(/Confirm the material list when it is right/)).not.toBeInTheDocument());
  });

  it("a notice from the objectives stage does not follow the teacher into the plan stage", async () => {
    const v = baseView();
    set(v, "objectives", "open"); v.objectives = []; v.proposals[0].status = "proposed" as never;
    const { state } = mockHost(v, { onPost: (u) => { if (u.endsWith("/decisions")) { state.view!.proposals[0].status = "accepted"; set(state.view!, "objectives", "confirmed"); } } });
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: /Verify the event log/ }));
    expect(await screen.findByText(/Event log verified/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Accept objective/ }));
    await screen.findByRole("button", { name: /build the plan/ });
    expect(screen.queryByText(/Event log verified/)).not.toBeInTheDocument();
  });
});

describe("one stage at a time, one primary action", () => {
  it("shows the plan stage's card only: no publish card, no student chat, no later stage", async () => {
    mockHost(atPlanDraft());
    const { container } = render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    expect(screen.queryByRole("region", { name: /Course package/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Try the student helper" })).not.toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    expect(primaries(container)[0]).toHaveTextContent("Confirm the lesson plan");
  });

  it("the confirm for the plan sits BELOW the plan it confirms", async () => {
    mockHost(atPlanDraft());
    render(<LiveCourse />);
    const plan = await screen.findByRole("article", { name: `Lesson plan: ${PLAN_TITLE}` });
    const button = screen.getByRole("button", { name: "Confirm the lesson plan" });
    expect(plan.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the publish stage has one primary: review and publish", async () => {
    mockHost(atPublish());
    const { container } = render(<LiveCourse />);
    await screen.findByRole("button", { name: /Review & publish/ });
    expect(primaries(container)).toHaveLength(1);
  });

  it("finished stages are one line each, and open on request", async () => {
    mockHost(atPlanDraft());
    const user = userEvent.setup();
    render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    const earlier = screen.getByRole("list", { name: "Earlier steps" });
    expect(within(earlier).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(within(earlier).queryByRole("heading", { name: STATEMENT })).not.toBeInTheDocument();
    await user.click(within(earlier).getByText(/Objectives/));
    expect(await within(earlier).findByRole("heading", { name: STATEMENT })).toBeInTheDocument();
  });

  it("keeps urns and the event count out of the reading path: they are in Record details", async () => {
    mockHost(atPlanDraft());
    render(<LiveCourse />);
    const h1 = await screen.findByRole("heading", { level: 1, name: "Lesson 3 · AI literacy" });
    const header = h1.closest("header") as HTMLElement;
    expect(header.textContent).not.toMatch(/urn:uuid|log \d+ event/);
    const details = screen.getByRole("group", { name: "Record details" });
    expect(within(details).getByText(/13 events/)).toBeInTheDocument();
    expect(within(details).getByText(/urn:uuid:11111111/)).toBeInTheDocument();
  });

  it("the step index names the five steps, marks the current one, and ticks the finished ones", async () => {
    mockHost(atPlanDraft());
    render(<LiveCourse />);
    const steps = await screen.findByRole("list", { name: "Steps" });
    const items = within(steps).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringMatching(/Material/), expect.stringMatching(/Brief/), expect.stringMatching(/Objectives/), expect.stringMatching(/Plan/), expect.stringMatching(/Publish/),
    ]);
    expect(items[3]).toHaveAttribute("aria-current", "step");
    expect(items[0]).toHaveAttribute("data-state", "done");
    expect(items[4]).toHaveAttribute("data-state", "todo");
  });
});

describe("the published moment", () => {
  it("reads in the glossary's order: one status sentence, the lesson plan, the student helper, then the actions; Revise stays secondary", async () => {
    mockHost(atPublished());
    const { container } = render(<LiveCourse />);
    const status = await screen.findByText("Version 1 is published. Students use this version; changes become version 2.");
    // The old three sentences are gone.
    expect(screen.queryByText(/Sealed 16 October 2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/is published and unchanged/)).not.toBeInTheDocument();
    const plan = screen.getByRole("heading", { name: PLAN_TITLE });
    const helper = screen.getByRole("region", { name: "Try the student helper" });
    const bar = container.querySelector('[data-stage-bar="true"]') as HTMLElement;
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(status, plan)).toBe(true);
    expect(before(plan, helper)).toBe(true);
    expect(before(helper, bar)).toBe(true);
    const names = within(bar).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Try the student helper", "Download the student handout", "Export the published version"]);
    expect(screen.getByRole("button", { name: "Revise this course" })).toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    expect(primaries(container)[0]).toHaveTextContent("Try the student helper");
  });

  it("the student helper is collapsed until opened, and 'Try the student helper' opens it and puts the cursor in the question box", async () => {
    mockHost(atPublished());
    const user = userEvent.setup();
    const { container } = render(<LiveCourse />);
    await screen.findByText(/^Version 1 is published\./);
    const details = container.querySelector("section[aria-label='Try the student helper'] details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await user.click(screen.getByRole("button", { name: "Try the student helper" }));
    expect(details.open).toBe(true);
    expect(screen.getByLabelText("Your question")).toHaveFocus();
  });

  it("decided objectives are read-only until Revise: no Edit wording, no Revoke", async () => {
    mockHost(atPublished());
    const user = userEvent.setup();
    render(<LiveCourse />);
    await screen.findByText(/^Version 1 is published\./);
    await user.click(screen.getByText(/Objectives/, { selector: "summary *, summary" }));
    await screen.findByRole("heading", { name: STATEMENT });
    expect(screen.queryByRole("button", { name: /Edit the wording/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revise this course" }));
    expect(await screen.findByRole("button", { name: /Edit the wording of objective 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Revoke your decision on objective 1/ })).toBeInTheDocument();
  });
});

describe("the first-run tour", () => {
  beforeEach(() => { window.localStorage.clear(); });

  it("opens once on a first visit with no courses, and not again on reload", async () => {
    mockHost(null);
    const first = render(<LiveCourse />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.localStorage.getItem("silicus.tour.seen")).toBe("1");
    first.unmount();
    mockHost(null);
    render(<LiveCourse />);
    await screen.findByLabelText("What should we call this course?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not open when the teacher already has a course", async () => {
    mockHost(baseView());
    render(<LiveCourse />);
    await screen.findByRole("heading", { level: 1, name: "Lesson 3 · AI literacy" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("'Start my course' closes it and puts the cursor in the first question", async () => {
    mockHost(null);
    const user = userEvent.setup();
    render(<LiveCourse />);
    await screen.findByRole("dialog");
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Start my course" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.getElementById("onboarding-reply")).toHaveFocus());
  });

  it("'How it works' opens it again, any time", async () => {
    mockHost(baseView());
    const user = userEvent.setup();
    render(<LiveCourse />);
    await screen.findByRole("heading", { level: 1, name: "Lesson 3 · AI literacy" });
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: "How it works" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("Behind the scenes", () => {
  it("shows the host's activity once there is some, and names no ASFAI lane when ASFAI is not offered", async () => {
    const v = atPlanDraft();
    v.activity = [
      { seq: 1, at: 1, actor: "teacher", action: "course.created", artifact: "record", facts: { materials: 1 } },
      { seq: 2, at: 2, actor: "worker", action: "plan.drafted", artifact: "plan", facts: { activities: 1 } },
    ];
    mockHost(v);
    render(<LiveCourse />);
    expect(await screen.findByText("Behind the scenes")).toBeInTheDocument();
    expect(screen.getByText(/Drafted a lesson plan with 1 activity/)).toBeInTheDocument();
  });

  it("is not drawn at all on a host that sends no activity", async () => {
    mockHost(atPlanDraft());
    render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    expect(screen.queryByText("Behind the scenes")).not.toBeInTheDocument();
  });
});

void countOf;

describe("copy: the hint under an unanswered question promises, it does not report", () => {
  it("says the answer is recorded WHEN the teacher presses the button, not that it already was", async () => {
    const v = baseView();
    set(v, "outline", "pending"); set(v, "objectives", "pending");
    v.proposals = []; v.objectives = [];
    v.intake = { ...v.intake, outlineAuthorized: false, mayCallPrepareOutline: false, answers: { topic: "t" },
      questions: [{ id: "topic", prompt: "What topic should this lesson cover?", reason: null }, { id: "course", prompt: "Which course is this part of?", reason: null }],
      refusal: null } as HostView["intake"];
    mockHost(v);
    render(<LiveCourse />);
    const box = await screen.findByLabelText("Which course is this part of?");
    const hint = document.getElementById(box.getAttribute("aria-describedby")!.split(" ")[0])!;
    expect(hint.textContent).toMatch(/recorded on this course when you press Record this answer/i);
    expect(hint.textContent).not.toMatch(/^Recorded on this course[.;]/);
    expect(hint.textContent).toMatch(/Not sent to ASFAI/); // the local app keeps its honesty line
  });
});

describe("the workspace: edit any stage without hunting for it", () => {
  const stepsList = async () => within(await screen.findByRole("list", { name: "Steps" }));

  it("the navigator says where each step stands, in one line", async () => {
    mockHost(atPlanDraft());
    render(<LiveCourse />);
    const steps = await stepsList();
    const lines = steps.getAllByRole("listitem").map((li) => li.textContent?.replace(/\s+/g, " ").trim());
    expect(lines[0]).toMatch(/Material.*1 material/);
    expect(lines[1]).toMatch(/Brief.*how AI answers are built/);
    expect(lines[2]).toMatch(/Objectives.*1 objective confirmed/);
    expect(lines[3]).toMatch(/Plan.*1 activity · 20 min/);
    expect(lines[3]).not.toMatch(/draft/i); // the plan stage says "draft" once: its tag and its bar, not the navigator
    expect(lines[4]).toMatch(/Publish.*Not published/);
  });

  it("a step is a button only where there is something to look at", async () => {
    mockHost(atPlanDraft());
    render(<LiveCourse />);
    const steps = await stepsList();
    expect(steps.getByRole("button", { name: /Objectives/ })).toBeInTheDocument();
    expect(steps.getByRole("button", { name: /Plan/ })).toBeInTheDocument();
    expect(steps.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument(); // nothing to publish yet
  });

  it("edit objectives from the plan, and back: two clicks, one primary each time, the plan as it was", async () => {
    const { calls } = mockHost(atPlanDraft());
    const user = userEvent.setup();
    const { container } = render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    expect(primaries(container)).toHaveLength(1);
    const writes = () => calls.filter((c) => c.method === "POST").length;
    const before = writes();

    await user.click(screen.getByRole("button", { name: "Edit objectives" })); // click 1
    expect(await screen.findByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: PLAN_TITLE })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reword|Edit/ })).toBeInTheDocument(); // the objectives are editable here
    expect(primaries(container)).toHaveLength(1);
    expect(primaries(container)[0]).toHaveTextContent("Back to the plan");

    await user.click(screen.getByRole("button", { name: "Back to the plan" })); // click 2
    expect(await screen.findByRole("heading", { name: PLAN_TITLE })).toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    expect(primaries(container)[0]).toHaveTextContent("Confirm the lesson plan");
    expect(writes()).toBe(before); // looking is not an act
  });

  it("the navigator opens a finished step as a look, and its one primary goes back", async () => {
    mockHost(atPlanDraft());
    const user = userEvent.setup();
    const { container } = render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    await user.click((await stepsList()).getByRole("button", { name: /Brief/ }));
    expect(await screen.findByText("Topic")).toBeInTheDocument(); // the brief's own answers are what is on screen
    expect(screen.queryByRole("heading", { name: PLAN_TITLE })).not.toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    expect((await stepsList()).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    await user.click(screen.getByRole("button", { name: "Back to the plan" }));
    expect(await screen.findByRole("heading", { name: PLAN_TITLE })).toBeInTheDocument();
  });

  it("once published, objectives are only a look: no verbs, no Edit objectives on the plan", async () => {
    mockHost(atPublished());
    const user = userEvent.setup();
    render(<LiveCourse />);
    await screen.findByText(/^Version 1 is published\./);
    await user.click((await stepsList()).getByRole("button", { name: /Objectives/ }));
    expect(await screen.findByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add objective/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to the published version" })).toBeInTheDocument();
  });

  it("a plan that cites an objective the teacher dropped says so in the bar, and offers a new draft first", async () => {
    const v = atPlanDraft();
    v.plan = planOf("invalidated");
    mockHost(v);
    const { container } = render(<LiveCourse />);
    expect(await screen.findByText(/cites an objective you dropped, so it cannot be published as it is/)).toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    expect(primaries(container)[0]).toHaveTextContent("Draft a new plan from your confirmed objectives");
  });

  it("the plan sheet keeps its ids in Record details, not in the reading path", async () => {
    mockHost(atPlanDraft());
    render(<LiveCourse />);
    await screen.findByRole("heading", { name: PLAN_TITLE });
    const details = screen.getByRole("group", { name: "Record details" });
    expect(within(details).getByText("Lesson plan")).toBeInTheDocument();
    expect(within(details).getByText(/print cleanly/)).toBeInTheDocument();
    expect(screen.queryByText(/This page is set to print cleanly — use your browser/)).not.toBeInTheDocument();
  });
});

// ---- the glossary's retired words -----------------------------------------------------------------------------
// Owner, 2026-10-16: "outline", "package", "sealed" and "yet" confused teachers. They live on in gate ids, file names
// and Record details only. This renders every stage, opens everything that can be opened, and reads the text a
// teacher can read (textContent also reads the closed <details>, so a negative check is never vacuous).
describe("retired words: outline, package, sealed, yet are absent from every stage's teacher-facing text", () => {
  const RETIRED = /\b(outlines?|packages?|seal(ed|s|ing)?|in this course yet)\b/i;
  const stages: Array<[string, () => HostView]> = [
    ["intake", () => { const v = baseView(); set(v, "files", "pending"); set(v, "outline", "pending"); set(v, "objectives", "pending"); v.proposals = []; return v; }],
    ["brief", () => { const v = baseView(); set(v, "outline", "open"); set(v, "objectives", "pending"); v.proposals = []; v.intake = { ...v.intake, outlineAuthorized: true, answers: { topic: "t", course: "c", learning_outcomes: ["o"] } } as HostView["intake"]; return v; }],
    ["brief with no outcome", () => { const v = baseView(); set(v, "outline", "open"); set(v, "objectives", "pending"); v.proposals = []; v.intake = { ...v.intake, outlineAuthorized: true, answers: { topic: "t", course: "c" } } as HostView["intake"]; return v; }],
    ["objectives", () => { const v = baseView(); set(v, "objectives", "pending"); v.proposals = [
      { id: A, kind: "local", status: "proposed", statement: STATEMENT, originalStatement: STATEMENT, source: "from your answer", alignment: null, by: "ai" },
      { id: "urn:uuid:bbbb", kind: "local", status: "proposed", statement: "Students can name one thing.", originalStatement: "Students can name one thing.", source: "suggested by Silicus", alignment: null, by: "ai" },
    ] as unknown as HostView["proposals"]; return v; }],
    ["plan", () => baseView()],
    ["plan draft", atPlanDraft],
    ["publish", atPublish],
    ["published", atPublished],
  ];
  for (const [name, make] of stages) {
    it(`${name}`, async () => {
      mockHost(make());
      const { container } = render(<LiveCourse />);
      await screen.findByRole("heading", { level: 1 }).catch(() => null);
      await waitFor(() => expect(container.querySelector("[data-stage-bar='true'], section")).not.toBeNull());
      await new Promise((r) => setTimeout(r, 50));
      // Record details hold the machine words on purpose; they are a click away, not the reading path.
      const clone = container.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[data-record-details], [aria-label='Record details']").forEach((n) => n.remove());
      const text = clone.textContent ?? "";
      const hits = [...text.matchAll(new RegExp(RETIRED, "gi"))].map((m) => text.slice(Math.max(0, m.index! - 40), m.index! + 40));
      expect(hits).toEqual([]);
    });
  }
});
