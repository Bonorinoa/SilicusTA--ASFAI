/**
 * useCourse.status.test.ts — B2/B4: the one status line's words are a pure function of the host view
 * (plus the waiting state), and a step transition is one spoken sentence.
 *
 * Nothing here renders: these are the derivations the status line (StepStatus) and the studio's step
 * change (CourseStudio) compose. Counts are words through lib/plural; the transition sentence is
 * announced exactly once through the status line's single polite live region.
 */
import { describe, expect, it } from "vitest";
import type { HostCheckpoint, HostView } from "../gate/transport";
import type { ProposalView } from "../gate/types";
import { stepTransition, turnPhrase } from "./useCourse";

function checkpoint(status: HostCheckpoint["status"], id = "x"): HostCheckpoint {
  return { id, status, provenance: {}, note: null };
}

const VIEW: HostView = {
  course: { courseId: "urn:uuid:x", owner: "Ada", title: "How plants eat", description: "", materials: [{ name: "Lesson notes" }], createdAt: 0 },
  checkpoints: { files: checkpoint("pending", "files"), outline: checkpoint("pending", "outline"), objectives: checkpoint("pending", "objectives") },
  intake: { courseId: "urn:uuid:x", guardState: "open", observedState: null, questionsFrom: "local", roundOpened: false, roundAnswered: false, questions: [{ id: "topic", prompt: "Topic", reason: null }], draftAuthorization: false, outlineAuthorized: false, mayCallPrepareOutline: false, refusal: null },
  proposals: [],
  objectives: [],
  decisions: [],
  plan: null,
  invalidation: { invalidated: false, gaps: [] },
  publish: { canPublish: false, blockers: [] },
  versions: [],
  timeline: [],
  ledger: [],
  integrity: { events: 0, head: "genesis" },
};

function view(over: Partial<HostView> = {}): HostView {
  return { ...structuredClone(VIEW) as HostView, ...over };
}

function confirmed(v: HostView, ...ids: string[]): HostView {
  return { ...v, checkpoints: Object.fromEntries(Object.entries(v.checkpoints).map(([k, c]) => [k, ids.includes(k) ? { ...c, status: "confirmed" as const } : c])) as HostView["checkpoints"] };
}

const proposal = (status: ProposalView["status"]): ProposalView => ({
  id: "urn:uuid:p", kind: "public", status, statement: "Students can explain it.", originalStatement: null,
  source: null, alignment: null, by: "ai",
});

const draft = { id: "urn:uuid:pl", courseId: "urn:uuid:x", courseVersion: 0, title: "A plan", status: "draft" as const, activities: [], proposedBy: "ai" as const, proposedAt: 0 };

describe("turnPhrase — the status line when the teacher must act", () => {
  it("the brief: confirm the sources first, then answer the three questions", () => {
    expect(turnPhrase(view())).toBe("Your turn: confirm the source list");
    expect(turnPhrase(confirmed(view(), "files"))).toBe("Your turn: answer the three questions");
  });

  it("the objectives: choose where the first proposals come from, or decide each proposal", () => {
    const open = confirmed(view(), "files", "outline");
    expect(turnPhrase(open)).toBe("Your turn: choose where the first proposals come from");
    expect(turnPhrase({ ...open, proposals: [proposal("proposed")] })).toBe("Your turn: accept, edit or drop each proposal");
  });

  it("the plan: no plan, a draft, or an invalidated one each has its own turn", () => {
    const base = confirmed(view(), "files", "outline", "objectives");
    expect(turnPhrase(base)).toBe("Your turn: draft the lesson plan");
    expect(turnPhrase({ ...base, plan: draft })).toBe("Your turn: read the plan, then confirm it");
    expect(turnPhrase({ ...base, plan: { ...draft, status: "invalidated" } })).toBe("Your turn: draft a new plan");
  });

  it("publishing: review and publish", () => {
    const base = confirmed(view(), "files", "outline", "objectives");
    expect(turnPhrase({ ...base, plan: { ...draft, status: "confirmed" } })).toBe("Your turn: review and publish");
  });
});

describe("stepTransition — one spoken sentence per jump", () => {
  it("covers the three auto-advances", () => {
    expect(stepTransition("brief", "objectives")).toBe("The brief is confirmed. On to the objectives.");
    expect(stepTransition("objectives", "plan")).toBe("Objectives confirmed. On to the plan.");
    expect(stepTransition("plan", "publish")).toBe("The plan is confirmed. On to publish.");
  });

  it("says nothing for a step that did not actually change, or a jump that cannot happen in one move", () => {
    expect(stepTransition("brief", "brief")).toBe("");
    expect(stepTransition("brief", "plan")).toBe("");
    expect(stepTransition("plan", "brief")).toBe("");
    expect(stepTransition("publish", "publish")).toBe("");
  });
});