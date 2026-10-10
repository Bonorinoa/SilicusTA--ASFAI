/**
 * demo.ts — honest demo scenarios for the workbench and tests.
 *
 * Everything here drives the REAL confirm-gate through the harness: genuine
 * recorded teacher turns behind every decision, `confirmedByEducator` flipped
 * only by the gate. Nothing is pre-confirmed — a scenario starts from the AI's
 * proposals and ends wherever the recorded teacher decisions took it.
 */
import { ConfirmGateHarness } from "./harness";
import type { GateObjectiveRecord, HarnessSummary } from "./harness";
import type { LessonPlanView, ObjectiveCiteView, PackageVersionView, TimelineEvent } from "./types";

/** The AI's three proposals for the demo course (checkpoint 3 open). */
export function seedProposals(harness: ConfirmGateHarness): readonly GateObjectiveRecord[] {
  return harness.propose([
    {
      statement:
        "Students can explain what an algorithm is, in their own words, with an example from everyday life.",
      source: "from your slides p.4",
      publicId: "mt_K6qtan847r",
      relationship: "closeMatch",
    },
    {
      statement:
        "Students can spot the claim in an AI-generated answer and say what evidence would support it.",
      source: "from Tuesday's planning note",
      publicId: "mt_Qp2Ln0aVn7",
      relationship: "relatedTo",
    },
    {
      statement: "Students can list three facts about machine learning.",
      source: "from your handout, p.1",
    },
  ]);
}

export interface PlanScenario {
  harness: ConfirmGateHarness;
  plan: LessonPlanView;
  objectives: ObjectiveCiteView[];
  summary: HarnessSummary;
}

/**
 * A complete, real run: proposals → teacher decisions (accept / rename / drop /
 * add, each a recorded teacher turn) → a proposed lesson plan → teacher plan
 * confirmation. The returned plan record is the gate's own confirmed
 * `LessonPlanRecord`, ready for PlanCard.
 */
export function buildPlanScenario(): PlanScenario {
  const harness = new ConfirmGateHarness({ courseTitle: "Lesson 3 · How AI answers are built" });
  const [p1, p2] = seedProposals(harness);

  harness.dispatch({ verb: "accept", proposalId: p1.id });
  harness.dispatch({
    verb: "rename",
    proposalId: p2.id,
    statement:
      "Learners can find the claim in an AI answer and name what evidence would back it up.",
  });
  const third = harness.views().find((r) => r.status === "proposed");
  if (third) harness.dispatch({ verb: "drop", proposalId: third.id });

  const added = harness.dispatch({
    verb: "add",
    statement: "Students can ask one honest question about how an AI tool works.",
  });
  const addedId = added.ok ? added.targetIds?.[0] : undefined;
  if (!addedId) throw new Error("demo scenario: add objective did not mint an id");

  harness.gate.proposeLessonPlan({
    title: "Seeing the claim: how AI answers are built",
    audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: [
      {
        title: "Warm-up: three answers, one question",
        minutes: 8,
        objectiveIds: [p1.id],
        learnerDoes:
          "Read three short answers to the same question and mark the one that shows where it got its facts.",
        teacherDoes: "Read the answers aloud and ask the room which one they would trust, and why.",
        evidenceIfAny: "none",
        notEvidence: "A learner asking the assistant for the answer.",
      },
      {
        title: "Spotting the claim",
        minutes: 15,
        objectiveIds: [p2.id],
        learnerDoes:
          "Underline the claim in a short AI-written paragraph, then write what evidence would support it.",
        teacherDoes:
          "Circulate and ask two learners to justify an underline out loud before they write.",
        evidenceIfAny: "observation",
      },
      {
        title: "Build a better answer",
        minutes: 17,
        objectiveIds: [p1.id, addedId],
        learnerDoes:
          "Rewrite one answer so it shows its sources, then write one honest question about how the tool works.",
        teacherDoes:
          "Model one rewrite on the board, then collect the questions for next lesson's opener.",
        evidenceIfAny: "work-product",
      },
    ],
  });

  const confirmedPlan = harness.confirmPlan("Confirm this lesson plan.");

  const objectives: ObjectiveCiteView[] = harness.gate.confirmedObjectives().map((o) => ({
    id: o.id,
    kind: o.kind,
    statement: o.statement ?? o.publicId ?? "",
    publicId: o.publicId,
    alignment: o.alignment
      ? { publicId: o.alignment.publicId, relationship: o.alignment.relationship }
      : undefined,
  }));

  return { harness, plan: confirmedPlan, objectives, summary: harness.summary() };
}

export interface AuditedScenario {
  harness: ConfirmGateHarness;
  plan: LessonPlanView;
  objectives: ObjectiveCiteView[];
  /** The latest sealed version (2 after a post-publish revision). */
  published: PackageVersionView;
  /** The full append-only trail, in real order. */
  events: TimelineEvent[];
  summary: HarnessSummary;
}

/**
 * A complete run WITH a seal history: the buildPlanScenario flow, then a
 * first publish, a post-publish teacher revision (a new objective), and a
 * second publish. Everything is recorded through the REAL gate — the audit
 * trail is the gate's own records, not a re-creation.
 */
export function buildAuditedScenario(): AuditedScenario {
  const scenario = buildPlanScenario();
  const { harness, plan, objectives } = scenario;

  const pub1 = harness.publishCourse("Ready for class next week.");
  if (!pub1.ok) throw new Error(`audited scenario: first publish failed (${pub1.code}) ${pub1.message}`);

  // A teacher revision AFTER the seal: any change ships as version 2.
  const revision = harness.dispatch({
    verb: "add",
    statement: "Students can say where their last answer came from.",
  });
  if (!revision.ok) throw new Error(`audited scenario: revision failed (${revision.code}) ${revision.message}`);

  const pub2 = harness.publishCourse("After one in-class revision.");
  if (!pub2.ok) throw new Error(`audited scenario: second publish failed (${pub2.code}) ${pub2.message}`);

  const published = harness.publishedVersions()[1];
  return {
    harness,
    plan,
    objectives,
    published,
    events: harness.timeline(),
    summary: harness.summary(),
  };
}
