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
import type { HostView } from "../gate/transport";
import { LiveCourse } from "./LiveCourse";
import { parseMaterials } from "./OnboardingChat";

const COURSE_ID = "urn:uuid:11111111-2222-3333-4444-555555555555";
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

interface Call { url: string; body: Record<string, unknown> | undefined }

function mockHost(view: HostView | null, { workerConfigured = true }: { workerConfigured?: boolean } = {}): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (url === "/api/courses") {
      return ok({ courses: view ? [{ courseId: COURSE_ID, owner: view.course.owner, title: view.course.title, createdAt: 1 }] : [] });
    }
    if (url === "/api/asfai/status") return ok({ connected: true, expiresAt: 9, scope: "asfai", canRefresh: true });
    if (url === "/api/worker/status") return ok({ configured: workerConfigured });
    if (url.endsWith("/decisions")) return ok({ decisions: [] });
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
    expect(screen.getByText(/host · teacher:tk-1/)).toBeInTheDocument();
    // The proposal row comes straight from the host view.
    expect(screen.getByRole("heading", { name: STATEMENT })).toBeInTheDocument();
    // A checkpoint chip reflects the host's status, not local state.
    expect(screen.getByText(/log 3 events/)).toBeInTheDocument();
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
    expect(screen.getByText(/clarifying questions and the teacher has not answered/i)).toBeInTheDocument();

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
    const fresh = stubView();
    fresh.checkpoints.outline.status = "pending";
    fresh.intake = { ...fresh.intake, roundOpened: false, roundAnswered: false, observedState: null, questions: [], refusal: null, mayCallPrepareOutline: true };
    const { calls } = mockHost(fresh);
    const user = userEvent.setup();
    render(<LiveCourse />);
    await user.click(await screen.findByRole("button", { name: "Ask ASFAI for the questions" }));
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
    await user.type(await screen.findByLabelText("What label should your copy of this record carry?"), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Record the label" }));
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
    const { calls } = mockHost(fresh);
    const user = userEvent.setup();
    render(<LiveCourse />);

    await user.click(await screen.findByRole("button", { name: /draft the plan from your confirmed objectives/i }));
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
});
