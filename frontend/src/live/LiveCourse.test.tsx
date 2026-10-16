/**
 * LiveCourse.test.tsx — the UI is a THIN CLIENT of the Silicus host.
 *
 * Two properties under test:
 *   1. it renders the host's view (nothing decided locally);
 *   2. a teacher verb leaves as an INTENT — no provenance, no turnRef, no
 *      channel ever crosses from the browser to the host.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CourseSummary, HostView } from "../gate/transport";
import { LiveCourse } from "./LiveCourse";
import { parseMaterials } from "./OnboardingChat";

const COURSE_ID = "urn:uuid:11111111-2222-3333-4444-555555555555";
const OTHER_ID = "urn:uuid:99999999-8888-7777-6666-555555555555";
const STATEMENT = "Students can explain what an algorithm is, in their own words.";

const ok = (o: unknown) => ({ ok: true, status: 200, json: async () => o }) as unknown as Response;

function stubView(): HostView {
  return {
    course: { courseId: COURSE_ID, owner: "teacher:tk-1", title: "Lesson 3 · AI literacy", description: "", materials: [], createdAt: 1 },
    checkpoints: {
      files: { id: "files", status: "confirmed", provenance: null, note: null },
      outline: { id: "outline", status: "confirmed", provenance: null, note: null },
      objectives: { id: "objectives", status: "open", provenance: null, note: null },
      plan: { id: "plan", status: "pending", provenance: null, note: null },
      publish: { id: "publish", status: "pending", provenance: null, note: null },
    },
    proposals: [
      { id: "urn:uuid:aaaa", kind: "local", status: "proposed", statement: STATEMENT,
        originalStatement: STATEMENT, source: "from your slides p.4", alignment: null, by: "ai" },
    ],
    intake: {
      courseId: COURSE_ID,
      guardState: "clarifying",
      observedState: "clarifying",
      questionsFrom: "asfai",
      roundOpened: true,
      roundAnswered: false,
      questions: [
        { id: "topic", prompt: "What topic should this lesson cover?", reason: "The outline needs a subject." },
        { id: "course", prompt: "Which course is this part of?", reason: "Course context sets scope and sequencing." },
      ],
      draftAuthorization: false,
      outlineAuthorized: false,
      mayCallPrepareOutline: false,
      refusal: { code: "AWAITING_TEACHER_REPLY", reason: "The intake asked clarifying questions and the teacher has not answered." },
    },
    objectives: [],
    decisions: [],
    plan: null,
    invalidation: { invalidated: false, gaps: [] },
    publish: { canPublish: false, blockers: ["checkpoint \"objectives\" is not teacher-confirmed"] },
    versions: [],
    timeline: [],
    ledger: [],
    integrity: { events: 3, head: "deadbeef" },
  };
}

/** A fresh course before ASFAI is consulted: the host's own three questions, none answered. */
function localView(): HostView {
  const v = stubView();
  v.checkpoints.outline.status = "pending";
  v.intake = {
    courseId: COURSE_ID,
    guardState: "ready",
    observedState: null,
    questionsFrom: "local",
    roundOpened: false,
    roundAnswered: false,
    questions: [
      { id: "topic", prompt: "What topic should this lesson cover?", reason: "The outline needs a subject." },
      { id: "course", prompt: "Which course is this part of?", reason: "Course context sets scope and sequencing." },
      { id: "learning_outcomes", prompt: "What should learners be able to do by the end?", reason: "An observable outcome anchors the outline." },
    ],
    draftAuthorization: false,
    outlineAuthorized: false,
    mayCallPrepareOutline: true,
    refusal: null,
  };
  return v;
}

interface Call { url: string; body: Record<string, unknown> | undefined }

function mockHost(
  view: HostView | null,
  { workerConfigured = true, asfaiConnected = true, studentReply, zdr = true, extraCourses = [], otherView, verify }: { workerConfigured?: boolean; asfaiConnected?: boolean; studentReply?: unknown; zdr?: boolean; extraCourses?: CourseSummary[]; otherView?: HostView; verify?: { ok: boolean; events: number; head?: string } } = {},
): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (url === "/api/courses") {
      return ok({ courses: [...(view ? [{ courseId: COURSE_ID, owner: view.course.owner, title: view.course.title, createdAt: 1, progress: { confirmed: 2, total: 5, versions: 0 } }] : []), ...extraCourses] });
    }
    if (url === `/api/courses/${encodeURIComponent(OTHER_ID)}` && otherView) return ok(otherView);
    if (url === "/api/asfai/status") return ok({ connected: asfaiConnected, expiresAt: asfaiConnected ? 9 : null, scope: asfaiConnected ? "asfai" : null, canRefresh: asfaiConnected });
    if (url === "/api/worker/status") return ok({ configured: workerConfigured, zdr, provider: zdr ? "openai" : "anthropic" });
    if (url.endsWith("/decisions")) return ok({ decisions: [] });
    if (url.endsWith("/materials/propose")) return ok({ proposals: [], materials: [], skipped: [] });
    if (url.endsWith("/student/ask")) return ok(studentReply ?? { answer: "x", grounded: false, cites: [], note: "n" });
    if (url.endsWith("/verify")) return ok(verify ?? { ok: true, events: view?.integrity.events ?? 0, head: view?.integrity.head ?? "h" });
    if (url.startsWith("/api/courses/")) return ok(view);
    return ok({});
  }));
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("LiveCourse — thin client of the host", () => {
  it("loads the course view from the host and renders it", async () => {
    mockHost(stubView());
    render(<LiveCourse />);

    expect(await screen.findByRole("heading", { level: 1, name: "Lesson 3 · AI literacy" })).toBeInTheDocument();
    // D3/stage page: the machine's words (course id, log length) are in Record details, not in the heading's meta line.
    expect(screen.getByText(/teacher:tk-1 · kept on this computer/)).toBeInTheDocument();
    // The proposal row comes straight from the host view.
    expect(screen.getByRole("heading", { name: STATEMENT })).toBeInTheDocument();
    // The step index reflects the host's checkpoints, not local state; the log length is under Record details.
    expect(screen.getByRole("list", { name: "Steps" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Record details" })).getByText(/3 events/)).toBeInTheDocument();
  });

  it("counts a one-event log in words in Record details: '1 event', never '1 events'", async () => {
    const v = stubView();
    v.integrity = { events: 1, head: "deadbeef" };
    mockHost(v);
    render(<LiveCourse />);

    expect(await screen.findByText(/\b1 event(?!s)/)).toBeInTheDocument();
    expect(screen.queryByText(/\b1 events/)).not.toBeInTheDocument();
  });

  it("counts a one-event log in words in the verify receipt: 'Event log verified — 1 event, chain intact.'", async () => {
    const v = stubView();
    mockHost(v, { verify: { ok: true, events: 1, head: "deadbeef" } });
    const user = userEvent.setup();
    render(<LiveCourse />);

    await user.click(await screen.findByRole("button", { name: /verify the event log/i }));
    // One course-level notice, shown once: it used to be echoed by every card it was also passed to.
    const shown = await screen.findAllByText("Event log verified — 1 event, chain intact.");
    expect(shown.length).toBe(1);
    expect(screen.queryByText(/Event log verified — 1 events/)).not.toBeInTheDocument();
  });

  it("sends a teacher verb as an intent — no provenance leaves the browser", async () => {
    const { calls } = mockHost(stubView());
    const user = userEvent.setup();
    render(<LiveCourse />);

    const row = (await screen.findByRole("heading", { name: STATEMENT })).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^accept objective/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/decisions"))).toBe(true);
    });
    const decisionCall = calls.find((c) => c.url.endsWith("/decisions"))!;
    const body = decisionCall.body as { decisions: { verb: string; proposalId: string }[]; text: string };

    expect(body.decisions).toEqual([{ verb: "accept", proposalId: "urn:uuid:aaaa" }]);
    expect(typeof body.text).toBe("string");
    expect(body.text.length).toBeGreaterThan(0);
    // THE property: the browser invented no provenance.
    const wire = JSON.stringify(body);
    expect(wire).not.toMatch(/turnRef/);
    expect(wire).not.toMatch(/provenance/);
    expect(wire).not.toMatch(/decidedBy/);
    expect(wire).not.toMatch(/channel/);
  });

  it("gates checkpoint 2: the intake questions surface, and no outline confirm is offered", async () => {
    // The outline must still be open for the intake gate to be the thing in the way.
    const gated = stubView();
    gated.checkpoints.outline.status = "pending";
    const { calls } = mockHost(gated);
    const user = userEvent.setup();
    render(<LiveCourse />);

    expect(await screen.findByRole("region", { name: "ASFAI course intake" })).toBeInTheDocument();
    expect(screen.getByText("What topic should this lesson cover?")).toBeInTheDocument();
    // The outline is NOT offered while the intake is unanswered.
    expect(screen.queryByRole("button", { name: "Confirm the outline" })).not.toBeInTheDocument();
    // The gate's refusal reason is surfaced.
    // D4: a teacher's sentence by code; the guard's own wording is kept in Record details only.
    expect(screen.getByText("Answer the questions above, then send them.")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Record details" })).getByText(/clarifying questions and the teacher has not answered/i)).toBeInTheDocument();

    // One open question. The reply is posted under that id only — the browser does not
    // map free prose onto the other questions, and it does not build the ASFAI call.
    await user.type(screen.getByLabelText("What topic should this lesson cover?"), "how AI answers are built");
    expect(screen.queryByLabelText("Which course is this part of?")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record this answer" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/intake/answer"))).toBe(true));
    const body = calls.find((c) => c.url.endsWith("/intake/answer"))!.body as { answers: Record<string, string>; text: string };
    expect(body.answers).toEqual({ topic: "how AI answers are built" });
    expect(body.text).toBe("how AI answers are built");
    expect(JSON.stringify(body)).not.toMatch(/payload|learningOutcomes|mode/);
  });

  it("asking ASFAI sends NO fields from the browser (the host builds the call)", async () => {
    const fresh = localView();
    const { calls } = mockHost(fresh);
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: /use ASFAI's questionnaire/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/intake/call"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/intake/call"))!.body).toEqual({});
  });

  it("names the course in the correspondence and writes NOTHING on load", async () => {
    const { calls } = mockHost(null);
    const user = userEvent.setup();
    render(<LiveCourse />);

    expect(await screen.findByLabelText("What should we call this course?")).toBeInTheDocument();
    expect(screen.getByText("On this device only. Not sent to ASFAI.")).toBeInTheDocument();
    expect(calls.every((c) => c.body === undefined)).toBe(true);

    await user.type(screen.getByLabelText("What should we call this course?"), "Seeing the claim");
    await user.click(screen.getByRole("button", { name: "Record the course title" }));
    await user.type(await screen.findByLabelText("What name should this course show for you?"), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Record this name" }));
    expect(calls.every((c) => c.body === undefined)).toBe(true);
    expect(screen.getAllByText("Not sent to ASFAI.").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "No materials" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/courses" && c.body !== undefined)).toBe(true));
    const body = calls.find((c) => c.url === "/api/courses" && c.body !== undefined)!.body as Record<string, unknown>;
    expect(body).toEqual({ owner: "Ada Lovelace", title: "Seeing the claim", materials: [] });
    expect(JSON.stringify(body)).not.toMatch(/topic|learningOutcomes|payload/);
  });

  it("tells the teacher that ASFAI's outcomes field reads one outcome per line", async () => {
    // ASFAI asks this as ONE open field, but the host reads it as a list (and sends
    // learningOutcomes as an array). The field has to say so, or a teacher who writes a
    // paragraph gets one objective covering several outcomes.
    const fresh = stubView();
    fresh.checkpoints.outline.status = "pending";   // the intake panel shows while the outline is open
    fresh.intake = {
      ...fresh.intake,
      questions: [
        { id: "topic", prompt: "What topic should this lesson cover?", reason: "The outline needs a subject." },
        { id: "course", prompt: "Which course is this part of?", reason: "Course context sets scope and sequencing." },
        { id: "learning_outcomes", prompt: "What should learners be able to do by the end?", reason: "An observable outcome anchors the outline." },
      ],
      answers: { topic: "how AI answers are built", course: "AI literacy, ages 8-10" },
    };
    mockHost(fresh);
    render(<LiveCourse />);

    expect(await screen.findByLabelText(/what should learners be able to do by the end/i)).toBeInTheDocument();
    expect(screen.getByText(/one outcome per line/i)).toBeInTheDocument();
  });

  it("proposes objectives without the browser sending any statement", async () => {
    const fresh = stubView();
    fresh.proposals = [];
    const { calls } = mockHost(fresh);
    const user = userEvent.setup();
    render(<LiveCourse />);

    await user.click(await screen.findByRole("button", { name: /propose objectives from your answers/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/objectives"))).toBe(true));
    // THE property: the host derives them from its own record. The browser sends nothing.
    expect(calls.find((c) => c.url.endsWith("/objectives"))!.body).toEqual({});
  });

  it("drafts the plan without the browser sending any spec", async () => {
    const fresh = stubView();
    fresh.checkpoints.objectives.status = "confirmed";
    fresh.proposals[0] = { ...fresh.proposals[0], status: "accepted" };   // a confirmed checkpoint means every proposal is decided
    const { calls } = mockHost(fresh);
    const user = userEvent.setup();
    render(<LiveCourse />);

    // D1: the confirm bar under the decided objectives is the button, and it says what it does.
    await user.click(await screen.findByRole("button", { name: "Confirm 1 objective · build the plan" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/plan"))).toBe(true));
    const body = calls.find((c) => c.url.endsWith("/plan"))!.body as Record<string, unknown>;
    expect(body).toEqual({});
    expect(JSON.stringify(body)).not.toMatch(/spec|activities|learnerDoes/);
  });

  it("says plainly when no drafting worker is configured, and offers no draft button", async () => {
    const fresh = stubView();
    fresh.checkpoints.objectives.status = "confirmed";
    mockHost(fresh, { workerConfigured: false });
    render(<LiveCourse />);

    expect(await screen.findByText(/no drafting worker is configured/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /draft the plan/i })).not.toBeInTheDocument();
  });

  it("treats a materials list as names and 'none' as an empty list", () => {
    expect(parseMaterials("none")).toEqual([]);
    expect(parseMaterials("None yet.")).toEqual([]);
    expect(parseMaterials("slides.pdf\n a worksheet ")).toEqual([{ name: "slides.pdf" }, { name: "a worksheet" }]);
  });

  it("recommends ASFAI when it is connected, as the primary way in", async () => {
    mockHost(localView(), { asfaiConnected: true });
    render(<LiveCourse />);
    expect(await screen.findByRole("button", { name: /use ASFAI's questionnaire/i })).toBeInTheDocument();
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
    // ...and the host's own questions stay live underneath, so a failed call loses nothing.
    expect(screen.getByLabelText(/what topic should this lesson cover/i)).toBeInTheDocument();
  });

  it("recommends ASFAI without blocking when it is not connected", async () => {
    mockHost(localView(), { asfaiConnected: false });
    render(<LiveCourse />);
    expect(await screen.findByRole("button", { name: /connect ASFAI/i })).toBeInTheDocument();
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
    // The teacher can simply answer: the questions are live, not disabled behind the connection.
    const box = await screen.findByLabelText(/what topic should this lesson cover/i);
    expect(box).toBeEnabled();
    // And nothing attributes the host's own questions to ASFAI.
    expect(screen.queryByText(/ASFAI asked/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ASFAI", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Course intake" })).toBeInTheDocument();
    expect(screen.getAllByText(/Not sent to ASFAI/i).length).toBeGreaterThan(0);
  });

  it("records a local answer under its own question id, with nothing but the teacher's words", async () => {
    const { calls } = mockHost(localView(), { asfaiConnected: false });
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.type(await screen.findByLabelText(/what topic should this lesson cover/i), "how AI answers are built");
    await user.click(screen.getByRole("button", { name: "Record this answer" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/intake/answer"))).toBe(true));
    const body = calls.find((c) => c.url.endsWith("/intake/answer"))!.body as Record<string, unknown>;
    expect(body.answers).toEqual({ topic: "how AI answers are built" });
    expect(JSON.stringify(body)).not.toMatch(/payload|learningOutcomes|mode/);
  });

  it("opens the outline confirm once the teacher's own answers are in, with ASFAI untouched", async () => {
    const done = localView();
    done.intake = { ...done.intake, outlineAuthorized: true, answers: { topic: "t", course: "c", learning_outcomes: ["o"] } };
    mockHost(done, { asfaiConnected: false });
    render(<LiveCourse />);
    expect(await screen.findByRole("button", { name: "Confirm the outline" })).toBeInTheDocument();
    expect(screen.queryByText(/Connect ASFAI to continue/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /course intake/i })).not.toBeInTheDocument();
  });

  it("once ASFAI has asked, its questions are attributed to it and no recommendation is repeated", async () => {
    const asked = stubView();
    asked.checkpoints.outline.status = "pending";
    mockHost(asked, { asfaiConnected: true });
    render(<LiveCourse />);
    expect(await screen.findByRole("region", { name: "ASFAI course intake" })).toBeInTheDocument();
    expect(screen.queryByText(/recommended/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use ASFAI's questionnaire/i })).not.toBeInTheDocument();
  });

  it("shows the host's cited alignment on the plan as a suggestion, and nothing when there is none", async () => {
    const withPlan = (citations?: NonNullable<HostView["plan"]>["citations"]): HostView => {
      const v = stubView();
      v.checkpoints.objectives.status = "confirmed";
      v.proposals = [];
      v.objectives = [{ id: "urn:uuid:aaaa", kind: "local", statement: STATEMENT, publicId: undefined }];
      v.plan = {
        id: "plan-1", courseId: COURSE_ID, courseVersion: 1, title: "Seeing the claim", status: "draft", proposedBy: "ai", proposedAt: 1,
        activities: [{ id: "act-1", title: "Spot it", minutes: 20, objectiveIds: ["urn:uuid:aaaa"], materialVersionIds: [], learnerDoes: "Mark it.", teacherDoes: "Ask.", evidenceIfAny: "observation" }],
        ...(citations ? { citations } : {}),
      } as HostView["plan"];
      return v;
    };
    mockHost(withPlan([{ ref: "local:ai.claims", label: "Finding the claim in an AI answer", source: "local-ontology", activityIndexes: [0], verified: true }]));
    const first = render(<LiveCourse />);
    const region = await screen.findByRole("region", { name: "Suggested alignment" });
    expect(within(region).getByText(/Finding the claim in an AI answer/)).toBeInTheDocument();
    expect(within(region).getByText(/not requirements/i)).toBeInTheDocument();
    first.unmount();

    mockHost(withPlan());
    render(<LiveCourse />);
    expect((await screen.findAllByRole("heading", { level: 1, name: "Seeing the claim" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Suggested alignment" })).not.toBeInTheDocument();
  });

  it("offers to propose the outcomes from the materials only when a worker exists, as a recorded answer and not objective text", async () => {
    const v = localView();
    v.intake = { ...v.intake, answers: { topic: "t", course: "c" } };
    const { calls } = mockHost(v, { workerConfigured: true, asfaiConnected: false });
    const user = userEvent.setup();
    const first = render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: /propose these from my materials instead/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/intake/answer"))).toBe(true));
    const body = calls.find((c) => c.url.endsWith("/intake/answer"))!.body as { answers: Record<string, string>; text: string };
    expect(body.answers).toEqual({ outcomes_from: "materials" });
    expect(body.text).toBe("Propose the outcomes from my materials.");
    first.unmount();

    mockHost(v, { workerConfigured: false, asfaiConnected: false });
    render(<LiveCourse />);
    expect(await screen.findByLabelText(/what should learners be able to do by the end/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /propose these from my materials instead/i })).not.toBeInTheDocument();
  });

  it("sends the material to the host once, keeps it in memory only, and never sends an objective", async () => {
    const v = stubView();
    v.proposals = [];
    v.intake = { ...v.intake, questionsFrom: "local", answers: { topic: "t", course: "c", outcomes_from: "materials" } };
    const { calls } = mockHost(v);
    const user = userEvent.setup();
    render(<LiveCourse />);
    expect(await screen.findByText(/stays in this tab only/i)).toBeInTheDocument();
    expect(screen.getByText(/zero-data-retention/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /propose objectives from your answers/i })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("A public link"), "https://example.org/ai-intro");
    await user.click(screen.getByRole("button", { name: "Add this link" }));
    await user.type(screen.getByLabelText(/or paste text/i), "slides.txt");
    await user.type(screen.getByLabelText("Pasted text"), "An algorithm is a list of steps.");
    await user.click(screen.getByRole("button", { name: "Add this text" }));
    expect(screen.getByRole("list", { name: "Material added" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /propose objectives from my materials/i }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/materials/propose"))).toBe(true));
    const body = calls.find((c) => c.url.endsWith("/materials/propose"))!.body as Record<string, unknown>;
    expect(body).toEqual({ materials: [{ url: "https://example.org/ai-intro" }, { name: "slides.txt", text: "An algorithm is a list of steps." }] });
    expect(JSON.stringify(body)).not.toMatch(/statement|objective|provenance/);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("lets a teacher try the published course as a student: grounded answers show what they rest on, and nothing is saved", async () => {
    let v = stubView();
    v = publishedView(UNCHANGED);
    const { calls } = mockHost(v, { studentReply: { answer: "An algorithm is a list of steps.", grounded: true, cites: [{ id: "objective:1", label: "Objective 1" }], note: "Asking questions here is not evidence of learning." } });
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.type(await screen.findByLabelText("Your question"), "What is an algorithm?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("An algorithm is a list of steps.")).toBeInTheDocument();
    expect(screen.getByText(/From Objective 1\./)).toBeInTheDocument();
    const body = calls.find((c) => c.url.endsWith("/student/ask"))!.body as Record<string, unknown>;
    expect(body).toEqual({ question: "What is an algorithm?", history: [] });
    expect(screen.getByText(/not evidence of learning, and nothing you ask is saved/i)).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it("says plainly when the course does not cover a student's question", async () => {
    const v = publishedView(UNCHANGED);
    mockHost(v, { studentReply: { answer: "That isn't part of this lesson. Ask your teacher.", grounded: false, cites: [], note: "n", refusal: "off_topic" } });
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.type(await screen.findByLabelText("Your question"), "Who won in 1966?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/Not covered by this course\./)).toBeInTheDocument();
  });

  it("never claims zero-retention when the worker is not set to it: it says the provider's normal terms apply", async () => {
    const v = stubView();
    v.proposals = [];
    v.intake = { ...v.intake, questionsFrom: "local", answers: { topic: "t", course: "c", outcomes_from: "materials" } };
    mockHost(v, { zdr: false });
    render(<LiveCourse />);
    expect(await screen.findByText(/stays in this tab only/i)).toBeInTheDocument();
    expect(screen.queryByText(/is set to zero-data-retention providers only/i)).not.toBeInTheDocument();
    expect(screen.getByText(/normal data-retention terms \(not zero-retention\)/i)).toBeInTheDocument();
  });

  it("lists your courses with honest standing, opens another without writing anything, and starts a new one on request", async () => {
    const other = stubView();
    other.course = { ...other.course, courseId: OTHER_ID, title: "Earlier course" };
    const { calls } = mockHost(stubView(), {
      otherView: other,
      extraCourses: [
        { courseId: OTHER_ID, owner: "teacher:tk-1", title: "Earlier course", createdAt: 0, progress: { confirmed: 5, total: 5, versions: 1 } },
        { courseId: "urn:uuid:bad", owner: "teacher:tk-1", title: "Damaged course", createdAt: -1, progress: { error: "LOG_INTEGRITY" } },
      ],
    });
    const user = userEvent.setup();
    render(<LiveCourse />);
    // The library is a menu button named after the open course; its list is not on the page until it is asked for.
    const trigger = await screen.findByRole("button", { name: /Lesson 3 · AI literacy/ });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    const list = await screen.findByRole("menu", { name: "Your courses" });
    expect(within(list).getByText(/2 of 5 checkpoints confirmed/)).toBeInTheDocument();
    expect(within(list).getByText(/published, version 1/)).toBeInTheDocument();
    expect(within(list).getByText(/needs attention: its record does not verify/)).toBeInTheDocument();
    expect(within(list).getByRole("menuitem", { name: "Lesson 3 · AI literacy is open" })).toBeDisabled();

    const writes = () => calls.filter((c) => c.body !== undefined).length;
    const before = writes();
    await user.click(within(list).getByRole("menuitem", { name: "Open Earlier course" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Earlier course" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // choosing closes it
    expect(writes()).toBe(before);

    await user.click(screen.getByRole("button", { name: /Earlier course/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Start a new course" }));
    expect(await screen.findByLabelText("What should we call this course?")).toBeInTheDocument();
    expect(writes()).toBe(before);
  });

  it("offers a student handout once published, built from the sealed version", async () => {
    const v = publishedView(UNCHANGED);
    v.versions = [{
      courseId: COURSE_ID, version: 1, previousVersion: null, title: "AI literacy", owner: "Ada", status: "published",
      objectiveRefs: [{ id: "o", kind: "local", statement: STATEMENT }], lessonPlan: null, publishedAt: 1, note: null,
      provenance: { turnRef: "t", decidedBy: "Ada", channel: "c", decidedAt: 1 },
    }];
    mockHost(v);
    let blob: Blob | null = null;
    const created = vi.fn((b: Blob) => { blob = b; return "blob:handout"; });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});   // jsdom cannot navigate
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: "Download the student handout" }));
    expect(created).toHaveBeenCalledOnce();
    const text = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob as unknown as Blob); });
    expect(text).toContain(STATEMENT);
    expect((await screen.findAllByText(/Downloaded the student handout/)).length).toBeGreaterThan(0);
  });

  /** A published course (v1) whose single objective is accepted and cited by the sealed, confirmed plan. */
  function publishedView(revision: HostView["revision"]): HostView {
    const v = stubView();
    v.checkpoints.objectives.status = "confirmed";
    v.checkpoints.plan.status = "confirmed";
    v.checkpoints.publish.status = "confirmed";
    v.proposals = [{ id: "urn:uuid:aaaa", kind: "local", status: "accepted", statement: STATEMENT, originalStatement: STATEMENT, source: "from your answer", alignment: null, by: "ai", citedByPlan: true }];
    v.objectives = [{ id: "urn:uuid:aaaa", kind: "local", statement: STATEMENT }];
    v.versions = [{
      courseId: COURSE_ID, version: 1, previousVersion: null, title: "AI literacy", owner: "Ada", status: "published",
      objectiveRefs: [{ id: "urn:uuid:aaaa", kind: "local", statement: STATEMENT }], lessonPlan: null, publishedAt: 1, note: null,
      provenance: { turnRef: "t", decidedBy: "Ada", channel: "c", decidedAt: 1 },
    }];
    v.plan = { id: "urn:uuid:plan", courseId: COURSE_ID, courseVersion: 1, title: "Steps", status: "confirmed", proposedBy: "ai", proposedAt: 1,
      activities: [{ id: "act1", title: "Warm-up", minutes: 10, objectiveIds: ["urn:uuid:aaaa"], materialVersionIds: [], learnerDoes: "Do.", teacherDoes: "Ask.", evidenceIfAny: "none" }] };
    v.publish = { canPublish: true, blockers: [] };
    v.revision = revision;
    return v;
  }
  const UNCHANGED: HostView["revision"] = { sealedVersion: 1, nextVersion: 2, drafting: false, changes: { objectivesAdded: [], objectivesRemoved: [], plan: "same", planStatus: "confirmed" }, notInPlan: [] };
  const WRITES = (calls: Call[]) => calls.filter((c) => c.body !== undefined).length;

  it("offers 'Revise this course' on a published course; opening it writes nothing and says nothing is being drafted", async () => {
    const { calls } = mockHost(publishedView(UNCHANGED));
    const user = userEvent.setup();
    render(<LiveCourse />);
    expect(await screen.findByText("Version 1 is published and unchanged.")).toBeInTheDocument();
    const before = WRITES(calls);
    await user.click(screen.getByRole("button", { name: "Revise this course" }));
    expect(await screen.findByText(/Nothing yet\. Version 1 is still the latest/)).toBeInTheDocument();
    expect(screen.queryByText(/you are drafting/)).not.toBeInTheDocument();
    expect(WRITES(calls)).toBe(before);
    // The sealed course still reads the same everywhere.
    expect(screen.getByRole("button", { name: "Download the student handout" })).toBeInTheDocument();
  });

  it("Edit wording on a confirmed objective sends ONLY a reword intent; the reworded plan is flagged, not invalidated, and re-confirming is the teacher's own click", async () => {
    const AFTER = "Students can explain what an algorithm is, with an example.";
    const v = publishedView({
      sealedVersion: 1, nextVersion: 2, drafting: true,
      changes: { objectivesAdded: [], objectivesRemoved: [], objectivesReworded: [{ id: "urn:uuid:aaaa", before: STATEMENT, after: AFTER }], plan: "same", planStatus: "confirmed" },
      notInPlan: [],
    });
    v.proposals[0] = { ...v.proposals[0], statement: AFTER, reworded: true };
    v.objectives = [{ id: "urn:uuid:aaaa", kind: "local", statement: AFTER }];
    v.plan = { id: "urn:uuid:plan", courseId: COURSE_ID, courseVersion: 1, title: "Steps", status: "confirmed", proposedBy: "ai", proposedAt: 1,
      activities: [{ id: "act1", title: "Warm-up", minutes: 10, objectiveIds: ["urn:uuid:aaaa"], materialVersionIds: [], learnerDoes: "Do.", teacherDoes: "Ask.", evidenceIfAny: "none" }] };
    v.planWording = { stale: true, objectives: [{ id: "urn:uuid:aaaa", before: STATEMENT, after: AFTER }] };
    const { calls } = mockHost(v);
    const user = userEvent.setup();
    render(<LiveCourse />);

    // The plan is still confirmed and says it was written from the old wording; the revision panel lists the reword.
    const notice = await screen.findByRole("region", { name: "Objectives reworded since this plan was written" });
    expect(within(notice).getByText(`The plan was written from: “${STATEMENT}”`)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Why this plan was invalidated" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Changes since version 1" })).toHaveTextContent(`Reworded: “${STATEMENT}” became “${AFTER}”`);
    expect(screen.getByText(/Version 1 is published and unchanged; you are drafting version 2\./)).toBeInTheDocument();
    expect(screen.getByText("Reworded by you")).toBeInTheDocument();

    // Editing sends the intent only.
    const row = (await screen.findByRole("heading", { name: AFTER })).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Edit the wording of objective 1/ }));
    await user.type(within(row).getByRole("textbox"), " Really.");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/decisions"))).toBe(true));
    const body = calls.find((c) => c.url.endsWith("/decisions"))!.body as { decisions: unknown[]; text: string };
    expect(body.decisions).toEqual([{ verb: "reword", proposalId: "urn:uuid:aaaa", statement: `${AFTER} Really.` }]);
    expect(typeof body.text).toBe("string");
    for (const key of ["turnRef", "provenance", "decidedBy", "channel", "targetId", "mt_"]) expect(JSON.stringify(body)).not.toContain(key);

    // Nothing re-confirms the plan by itself: only the teacher's own click does, and it sends no content.
    expect(calls.some((c) => c.url.endsWith("/plan/confirm"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm the plan as it reads" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/plan/confirm"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/plan/confirm"))!.body).toEqual({ text: "Confirm this lesson plan." });
  });

  it("a host that does not report planWording shows no reword notice and no extra button", async () => {
    const v = publishedView(UNCHANGED);
    v.plan = { id: "urn:uuid:plan", courseId: COURSE_ID, courseVersion: 1, title: "Steps", status: "confirmed", proposedBy: "ai", proposedAt: 1,
      activities: [{ id: "act1", title: "Warm-up", minutes: 10, objectiveIds: ["urn:uuid:aaaa"], materialVersionIds: [], learnerDoes: "Do.", teacherDoes: "Ask.", evidenceIfAny: "none" }] };
    mockHost(v);
    render(<LiveCourse />);
    await screen.findByText("Version 1 is published and unchanged.");
    expect(screen.queryByRole("region", { name: /reworded since/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm the plan as it reads" })).not.toBeInTheDocument();
  });

  it("does not offer revision before anything is sealed, or on a host that does not report it", async () => {
    mockHost(stubView());
    const first = render(<LiveCourse />);
    await screen.findByRole("heading", { level: 1, name: "Lesson 3 · AI literacy" });
    expect(screen.queryByRole("button", { name: "Revise this course" })).not.toBeInTheDocument();
    first.unmount();
    const old = publishedView(UNCHANGED);
    delete old.revision;
    mockHost(old);
    render(<LiveCourse />);
    await screen.findByRole("heading", { level: 1, name: "Lesson 3 · AI literacy" });
    expect(screen.queryByRole("button", { name: "Revise this course" })).not.toBeInTheDocument();
  });

  it("while drafting version 2 it says so, keeps students on version 1, and the draft button sends no content", async () => {
    const drafting: HostView["revision"] = {
      sealedVersion: 1, nextVersion: 2, drafting: true,
      changes: { objectivesAdded: [], objectivesRemoved: [{ id: "urn:uuid:aaaa", statement: STATEMENT }], plan: "unconfirmed", planStatus: "invalidated" },
      notInPlan: [],
    };
    const v = publishedView(drafting);
    v.proposals[0] = { ...v.proposals[0], status: "dropped" };
    v.objectives = [];
    v.plan = { id: "urn:uuid:plan", courseId: COURSE_ID, courseVersion: 1, title: "Steps", status: "invalidated", activities: [], proposedBy: "ai", proposedAt: 1 };
    const { calls } = mockHost(v);
    const user = userEvent.setup();
    render(<LiveCourse />);
    expect(await screen.findByText("Version 1 is published and unchanged; you are drafting version 2.")).toBeInTheDocument();
    expect(screen.getByText(/keep reading it until you publish version 2/)).toBeInTheDocument();
    // One way forward, not two: the revision panel owns the new-plan button once a version is sealed.
    const draft = screen.getAllByRole("button", { name: /Draft a new (lesson )?plan from your confirmed objectives/ });
    expect(draft).toHaveLength(1);
    await user.click(draft[0]);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/plan"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/plan"))!.body).toEqual({});
  });

  it("before the first seal, an invalidated plan offers a new plan (the revoked objective cannot come back)", async () => {
    const v = stubView();
    v.checkpoints.objectives.status = "confirmed";
    v.plan = { id: "urn:uuid:plan", courseId: COURSE_ID, courseVersion: 1, title: "Steps", status: "invalidated", activities: [], proposedBy: "ai", proposedAt: 1 };
    mockHost(v);
    render(<LiveCourse />);
    expect(await screen.findByRole("button", { name: "Draft a new plan from your confirmed objectives" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-confirm the lesson plan" })).toBeInTheDocument();
  });

  it("with no worker, revoking a cited objective says what it costs BEFORE it is done, and does nothing until confirmed", async () => {
    const { calls } = mockHost(publishedView(UNCHANGED), { workerConfigured: false });
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: "Revise this course" }));   // decided objectives are read-only until then
    const row = (await screen.findByRole("heading", { name: STATEMENT })).closest("li") as HTMLElement;
    const before = WRITES(calls);
    await user.click(within(row).getByRole("button", { name: /^Revoke your decision on objective 1/ }));
    expect(within(row).getByText(/no drafting worker is configured on this host, so you could not publish again until one is/)).toBeInTheDocument();
    expect(WRITES(calls)).toBe(before);
    await user.click(within(row).getByRole("button", { name: "Keep it" }));
    expect(WRITES(calls)).toBe(before);
  });

  it("with a worker, the same revoke names the plan it will invalidate; an uncited objective has no such warning", async () => {
    const view = publishedView(UNCHANGED);
    mockHost(view);
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: "Revise this course" }));   // decided objectives are read-only until then
    const row = (await screen.findByRole("heading", { name: STATEMENT })).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^Revoke your decision on objective 1/ }));
    expect(within(row).getByText(/a new one must be drafted and confirmed before you can publish/)).toBeInTheDocument();
  });

  it("revoking an objective the plan does NOT cite carries no plan warning", async () => {
    const view = publishedView(UNCHANGED);
    view.proposals[0] = { ...view.proposals[0], citedByPlan: false };
    mockHost(view);
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: "Revise this course" }));   // decided objectives are read-only until then
    const row = (await screen.findByRole("heading", { name: STATEMENT })).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^Revoke your decision on objective 1/ }));
    expect(within(row).queryByText(/lesson plan cites it/)).not.toBeInTheDocument();
  });

  it("shows what changed between published versions, read-only, and says so when there is only one", async () => {
    const mk = (n: number, statement: string) => ({
      courseId: COURSE_ID, version: n, previousVersion: n > 1 ? n - 1 : null, title: "AI literacy", owner: "Ada", status: "published" as const,
      objectiveRefs: [{ id: "o", kind: "local" as const, statement }], lessonPlan: null, publishedAt: n, note: null,
      provenance: { turnRef: "t", decidedBy: "Ada", channel: "c", decidedAt: 1 },
    });
    const one = stubView();
    one.versions = [mk(1, STATEMENT)];
    mockHost(one);
    const first = render(<LiveCourse />);
    expect(await screen.findByText("Nothing to compare yet: this is version 1.")).toBeInTheDocument();
    first.unmount();

    const two = stubView();
    two.versions = [mk(1, STATEMENT), mk(2, "Students can explain an algorithm.")];
    const { calls } = mockHost(two);
    render(<LiveCourse />);
    expect(await screen.findByRole("heading", { name: "What changed between versions" })).toBeInTheDocument();
    expect(screen.getByText("Reworded")).toBeInTheDocument();
    expect(screen.getByText("Students can explain an algorithm.")).toBeInTheDocument();
    expect(calls.filter((c) => c.body !== undefined)).toEqual([]);   // computing a diff writes nothing
  });
});
