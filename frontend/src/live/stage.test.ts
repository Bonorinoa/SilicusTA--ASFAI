/**
 * stage.test.ts — stageOf(view) decides only which stage the page SHOWS. One test per row of the ladder.
 * Every rule about what is allowed stays in the host; these tests build views, they never decide anything.
 */
import { describe, expect, it } from "vitest";
import type { HostView } from "../gate/transport";
import { stageOf, STAGE_ORDER } from "./stage";

type Cp = "pending" | "open" | "confirmed";

const COURSE_ID = "urn:uuid:11111111-2222-3333-4444-555555555555";

/** A view at the very start: nothing confirmed. Each test moves it one step along. */
function stubView(over: { files?: Cp; outline?: Cp; objectives?: Cp; plan?: Cp; publish?: Cp } = {}): HostView {
  const s = (id: string, status: Cp) => [id, { id, status, provenance: null, note: null }] as const;
  return {
    course: { courseId: COURSE_ID, owner: "Ada", title: "Fractions", description: "", materials: [], createdAt: 1 },
    checkpoints: Object.fromEntries([
      s("files", over.files ?? "pending"), s("outline", over.outline ?? "pending"), s("objectives", over.objectives ?? "pending"),
      s("plan", over.plan ?? "pending"), s("publish", over.publish ?? "pending"),
    ]),
    proposals: [],
    intake: {
      courseId: COURSE_ID, guardState: "ready", observedState: null, questionsFrom: "local", roundOpened: false, roundAnswered: false,
      questions: [], draftAuthorization: null, outlineAuthorized: false, mayCallPrepareOutline: true, refusal: null,
    } as unknown as HostView["intake"],
    objectives: [], decisions: [], plan: null, invalidation: { invalidated: false, gaps: [] },
    publish: { canPublish: false, blockers: [] }, versions: [], timeline: [], ledger: [], integrity: { events: 1, head: "h" },
  } as unknown as HostView;
}

const PLAN = (status: "draft" | "confirmed" | "invalidated") =>
  ({ id: "p", courseId: COURSE_ID, courseVersion: 1, title: "Plan", status, proposedBy: "ai", proposedAt: 1, activities: [] }) as unknown as HostView["plan"];
const VERSION = { version: 1 } as unknown as HostView["versions"][number];
const PROPOSAL = { id: "o1", kind: "local", status: "proposed", statement: "S", originalStatement: "S", source: null, alignment: null, by: "ai" } as unknown as HostView["proposals"][number];

describe("stageOf: the stage the page shows expanded", () => {
  it("files not confirmed -> intake", () => {
    expect(stageOf(stubView())).toBe("intake");
    expect(stageOf(stubView({ files: "open" }))).toBe("intake");
  });

  it("files confirmed, outline not -> intake", () => {
    expect(stageOf(stubView({ files: "confirmed" }))).toBe("intake");
    expect(stageOf(stubView({ files: "confirmed", outline: "open" }))).toBe("intake");
  });

  it("outline confirmed, no proposals, outcomes asked of the materials -> material", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed" });
    v.intake = { ...v.intake, answers: { topic: "t", course: "c", outcomes_from: "materials" } };
    expect(stageOf(v)).toBe("material");
  });

  it("outline confirmed, no proposals, outcomes from the teacher's own answers -> objectives", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed" });
    v.intake = { ...v.intake, answers: { topic: "t", course: "c", learning_outcomes: ["o"] } };
    expect(stageOf(v)).toBe("objectives");
  });

  it("proposals waiting for a decision -> objectives (even when they came from materials)", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "open" });
    v.intake = { ...v.intake, answers: { outcomes_from: "materials" } };
    v.proposals = [PROPOSAL];
    expect(stageOf(v)).toBe("objectives");
  });

  it("objectives confirmed, no plan -> plan", () => {
    expect(stageOf(stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed" }))).toBe("plan");
  });

  it("a draft plan -> plan", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed" });
    v.plan = PLAN("draft");
    expect(stageOf(v)).toBe("plan");
  });

  it("an invalidated plan -> plan (a plan that cites a revoked objective is not done)", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed" });
    v.plan = PLAN("invalidated");
    expect(stageOf(v)).toBe("plan");
  });

  it("a confirmed plan the host will seal, nothing sealed yet -> publish", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed", plan: "confirmed" });
    v.plan = PLAN("confirmed");
    v.publish = { canPublish: true, blockers: [] };
    expect(stageOf(v)).toBe("publish");
  });

  it("a confirmed plan the host will NOT yet seal is still the publish stage: it is where the reasons are said", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed", plan: "confirmed" });
    v.plan = PLAN("confirmed");
    v.publish = { canPublish: false, blockers: ["no teacher-confirmed lesson plan"] };
    expect(stageOf(v)).toBe("publish");
  });

  it("a version exists and nothing is pending -> published", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed", plan: "confirmed", publish: "confirmed" });
    v.plan = PLAN("confirmed");
    v.versions = [VERSION];
    expect(stageOf(v)).toBe("published");
  });

  it("a version exists and the host says the publish checkpoint is pending again -> publish (drafting the next version)", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed", plan: "confirmed", publish: "pending" });
    v.plan = PLAN("confirmed");
    v.versions = [VERSION];
    v.publish = { canPublish: true, blockers: [] };
    expect(stageOf(v)).toBe("publish");
  });

  it("a version exists and the host reports a revision in progress -> publish, not published", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed", plan: "confirmed", publish: "confirmed" });
    v.plan = PLAN("confirmed");
    v.versions = [VERSION];
    v.revision = { sealedVersion: 1, nextVersion: 2, drafting: true, changes: null, notInPlan: [] } as unknown as HostView["revision"];
    expect(stageOf(v)).toBe("publish");
  });

  it("a revision that invalidated the plan sends the page back to the plan, even though a version is sealed", () => {
    const v = stubView({ files: "confirmed", outline: "confirmed", objectives: "confirmed", plan: "confirmed", publish: "confirmed" });
    v.plan = PLAN("invalidated");
    v.versions = [VERSION];
    expect(stageOf(v)).toBe("plan");
  });

  it("STAGE_ORDER lists the stages in the order a teacher meets them", () => {
    expect(STAGE_ORDER).toEqual(["intake", "material", "objectives", "plan", "publish", "published"]);
  });
});
