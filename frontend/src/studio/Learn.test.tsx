/**
 * Learn.test.tsx — the student space: a grounded answer shows where it came
 * from in kid words, a refusal shows nothing extra, and NOTHING a student
 * types or reads is ever written to web storage (the conversation is use,
 * never evidence; it lives in memory and is gone on reload).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostView, StudentAnswer } from "../gate/transport";
import { Learn } from "./Learn";

const COURSE_ID = "urn:uuid:11111111-2222-3333-4444-555555555555";
const TITLE = "How plants eat";
const ANSWER = "A plant uses light, water and air to make sugar.";

const ok = (o: unknown) => ({ ok: true, status: 200, json: async () => o }) as unknown as Response;

function stubView(): HostView {
  return {
    course: { courseId: COURSE_ID, owner: "Ms. Lovelace", title: TITLE, description: "", materials: [], createdAt: 1 },
    checkpoints: {},
    proposals: [],
    intake: {
      courseId: COURSE_ID,
      guardState: "ready",
      observedState: null,
      questionsFrom: "local",
      roundOpened: false,
      roundAnswered: false,
      questions: [],
      draftAuthorization: false,
      outlineAuthorized: false,
      mayCallPrepareOutline: false,
      refusal: null,
    },
    objectives: [],
    decisions: [],
    plan: null,
    invalidation: { invalidated: false, gaps: [] },
    publish: { canPublish: false, blockers: [] },
    versions: [
      {
        courseId: COURSE_ID,
        version: 1,
        previousVersion: null,
        title: TITLE,
        owner: "Ms. Lovelace",
        status: "published",
        objectiveRefs: [{ id: "o-1", kind: "public", statement: "students can explain why leaves are green." }],
        lessonPlan: null,
        publishedAt: 1,
        note: null,
        provenance: { turnRef: "t-1", decidedBy: "teacher:tl-1", channel: "remote", decidedAt: 1 },
      },
    ],
    timeline: [],
    ledger: [],
    integrity: { events: 1, head: "h" },
  };
}

/** The host stub: getCourse answers with the view, askStudent with the reply supplied per test. */
function mockHost(reply: StudentAnswer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/student/ask")) return ok(reply);
      if (url.startsWith("/api/courses/")) return ok(stubView());
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/** Ask one question as a student would and wait for the assistant's answer. */
async function ask(user: ReturnType<typeof userEvent.setup>, question = "What do plants need?") {
  const input = await screen.findByPlaceholderText("Ask about today’s lesson");
  await user.type(input, question);
  await user.click(screen.getByRole("button", { name: "Ask" }));
  return await screen.findByText(ANSWER, undefined, { timeout: 2000 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Learn — the student space", () => {
  it("renders the ribbon's honest preview line and no 'soon' badge", async () => {
    mockHost({ answer: ANSWER, grounded: true, cites: [], note: "", basis: "plan" });
    render(<Learn courseId={COURSE_ID} />);
    expect(
      await screen.findByText("Preview on this device. Students can’t open this link yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/soon/i)).not.toBeInTheDocument();
  });

  it("shows a grounded answer's source below the answer, in kid words", async () => {
    mockHost({
      answer: ANSWER,
      grounded: true,
      cites: [
        { id: "o-1", label: "Why leaves are green" },
        { id: "a-1", label: "What plants need" },
      ],
      note: "",
      basis: "plan",
    });
    render(<Learn courseId={COURSE_ID} />);
    const user = userEvent.setup();
    const answer = await ask(user);
    expect(answer).toBeInTheDocument();
    expect(
      screen.getByText("From the lesson: Why leaves are green · What plants need"),
    ).toBeInTheDocument();
    // The raw cite id (urn:uuid…) is never shown.
    expect(screen.queryByText(/urn:/u)).not.toBeInTheDocument();
  });

  it("adds the explanation sentence when the basis is 'explanation'", async () => {
    mockHost({
      answer: ANSWER,
      grounded: true,
      cites: [{ id: "o-1", label: "Why leaves are green" }],
      note: "",
      basis: "explanation",
    });
    render(<Learn courseId={COURSE_ID} />);
    const user = userEvent.setup();
    await ask(user);
    expect(screen.getByText("From the lesson: Why leaves are green")).toBeInTheDocument();
    expect(
      screen.getByText("Silicus is explaining an idea your lesson names."),
    ).toBeInTheDocument();
  });

  it("shows no source line for a refusal, and no cite line when there are no cites", async () => {
    mockHost({
      answer: "That isn’t part of this lesson. Ask your teacher.",
      grounded: false,
      cites: [],
      note: "",
      refusal: "off_topic",
    });
    render(<Learn courseId={COURSE_ID} />);
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("Ask about today’s lesson");
    await user.type(input, "What’s your favourite game?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("That isn’t part of this lesson. Ask your teacher.", undefined, { timeout: 2000 });
    expect(screen.queryByText(/From the lesson/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Silicus is explaining/u)).not.toBeInTheDocument();
  });

  it("shows the existing plain sentence when the ask fails", async () => {
    mockHost({ answer: ANSWER, grounded: true, cites: [], note: "", basis: "plan" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("/api/courses/") && !url.endsWith("/student/ask")) return ok(stubView());
        return { ok: false, status: 502, json: async () => ({ message: "upstream failed" }) } as unknown as Response;
      });
    render(<Learn courseId={COURSE_ID} />);
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("Ask about today’s lesson");
    await user.type(input, "What do plants need?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(
      await screen.findByText("Silicus couldn’t answer just now. Try again in a moment.", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("never writes the question or answer to localStorage or sessionStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockHost({
      answer: ANSWER,
      grounded: true,
      cites: [{ id: "o-1", label: "Why leaves are green" }],
      note: "",
      basis: "plan",
    });
    render(<Learn courseId={COURSE_ID} />);
    const user = userEvent.setup();
    await ask(user);
    expect(setItem).not.toHaveBeenCalled();
  });
});