/**
 * harness.test.ts — the binding's honesty tests.
 *
 * The harness plays the host transport: intents become recorded teacher turns
 * and only then gate confirmations. These tests prove that (a) the wire is
 * real — decisions carry teacher-turn provenance the gate validated — and
 * (b) fabricated provenance still cannot confirm anything (the gate refuses).
 */
import { describe, expect, it } from "vitest";
import { ConfirmGate } from "../../../confirm-gate/confirm-gate.mjs";
import { TurnLedger } from "../../../confirm-gate/host-guard.mjs";
import { ConfirmGateHarness } from "./harness";

describe("ConfirmGateHarness (UI ↔ confirm-gate binding)", () => {
  it("dispatching an intent records a real teacher turn behind the decision", () => {
    const harness = new ConfirmGateHarness();
    const [proposal] = harness.propose([{ statement: "Students can model one fraction." }]);

    const result = harness.dispatch({ verb: "accept", proposalId: proposal.id });
    expect(result.ok).toBe(true);

    const [decision] = harness.gate.decisions();
    expect(decision.verb).toBe("accept");
    const turn = harness.ledger.getTurn(decision.provenance.turnRef);
    expect(turn.role).toBe("teacher"); // a genuine recorded teacher turn
    expect(turn.actorId).toBe(harness.teacherId);
    expect(harness.gate.getObjective(proposal.id)?.confirmedByEducator).toBe(true);
  });

  it("rename keeps the objective id stable and versions the wording", () => {
    const harness = new ConfirmGateHarness();
    const [proposal] = harness.propose([
      { statement: "Students can model one fraction with a diagram." },
    ]);

    harness.dispatch({
      verb: "rename",
      proposalId: proposal.id,
      statement: "Learners can draw one fraction and explain it to a partner.",
    });

    const objective = harness.gate.getObjective(proposal.id);
    expect(objective?.id).toBe(proposal.id); // stable id
    expect(objective?.statement).toBe("Learners can draw one fraction and explain it to a partner.");
    expect(harness.gate.getProposal(proposal.id)?.statement).toBe(
      "Students can model one fraction with a diagram.", // the proposal record is never rewritten
    );
  });

  it("drops and adds reach the real confirmed set", () => {
    const harness = new ConfirmGateHarness();
    const [p1, p2] = harness.propose([
      { statement: "Students can count by twos." },
      { statement: "Students can count by fives." },
    ]);

    harness.dispatch({ verb: "drop", proposalId: p1.id });
    harness.dispatch({ verb: "accept", proposalId: p2.id });
    const added = harness.dispatch({ verb: "add", statement: "Students can skip-count together." });

    const confirmed = harness.gate.confirmedObjectives();
    expect(confirmed.map((o) => o.id)).not.toContain(p1.id);
    expect(confirmed.map((o) => o.id)).toContain(p2.id);
    expect(added.ok && added.targetIds?.[0]).toBe(confirmed.find(
      (o) => o.statement === "Students can skip-count together.",
    )?.id);
  });

  it("views() derives row state from real gate decisions", () => {
    const harness = new ConfirmGateHarness();
    const [p1, p2, p3] = harness.propose([
      { statement: "One", source: "from your slides p.4", publicId: "mt_K6qtan847r" },
      { statement: "Two" },
      { statement: "Three" },
    ]);
    expect(harness.views().map((r) => r.status)).toEqual(["proposed", "proposed", "proposed"]);
    expect(harness.views()[0].alignment?.suggested).toBe(true);

    harness.dispatch({ verb: "accept", proposalId: p1.id });
    harness.dispatch({ verb: "rename", proposalId: p2.id, statement: "Two, your words" });
    harness.dispatch({ verb: "drop", proposalId: p3.id });
    harness.dispatch({ verb: "add", statement: "Four, mine" });

    const views = harness.views();
    expect(views.map((r) => r.status)).toEqual(["accepted", "renamed", "dropped", "added"]);
    expect(views[0].alignment?.suggested).toBe(false); // decided alignment is no longer "suggested"
    expect(views[1].statement).toBe("Two, your words");
    expect(views[1].originalStatement).toBe("Two");
    expect(views[3].by).toBe("teacher");

    const summary = harness.summary();
    expect(summary).toMatchObject({ proposals: 3, decided: 3, awaiting: 0, allDecided: true });
    expect(summary.objectivesCheckpoint).toBe("confirmed"); // gate auto-confirmed checkpoint 3
  });

  it("the gate refuses fabricated provenance — nothing applies", () => {
    const harness = new ConfirmGateHarness();
    const [proposal] = harness.propose([{ statement: "Students can model one fraction." }]);
    // An assistant (model) turn can never back a confirmation.
    const turnRef = harness.ledger.recordAssistantTurn("I have decided this for you.");

    expect(() =>
      harness.gate.confirmObjectives({
        provenance: {
          turnRef,
          decidedBy: "assistant",
          channel: "model",
          decidedAt: Date.now(),
        },
        decisions: [{ verb: "accept", proposalId: proposal.id }],
      }),
    ).toThrowError(/model turn can never confirm/i);

    expect(harness.gate.confirmedObjectives()).toHaveLength(0);
    expect(harness.gate.decisions()).toHaveLength(0);
  });

  it("gate errors surface as refused dispatch results (no fabricated state)", () => {
    const harness = new ConfirmGateHarness();
    const [proposal] = harness.propose([{ statement: "Students can model one fraction." }]);
    harness.dispatch({ verb: "accept", proposalId: proposal.id });
    const again = harness.dispatch({ verb: "accept", proposalId: proposal.id });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("ALREADY_DECIDED");
  });

  it("a plan proposed through the gate reaches PlanCard as a real record", () => {
    const harness = new ConfirmGateHarness();
    const [proposal] = harness.propose([{ statement: "Students can model one fraction." }]);
    harness.dispatch({ verb: "accept", proposalId: proposal.id });

    harness.gate.proposeLessonPlan({
      title: "Fractions on the table",
      audience: { ageRangeStart: 7, ageRangeEnd: 9 },
      activities: [
        {
          title: "Fold and name",
          minutes: 10,
          objectiveIds: [proposal.id],
          learnerDoes: "Fold paper fractions and name them aloud.",
          teacherDoes: "Model one fold, then circulate and listen.",
          evidenceIfAny: "work-product",
        },
      ],
    });
    const plan = harness.confirmPlan();
    expect(plan.status).toBe("confirmed");
    expect(plan.activities).toHaveLength(1);
    expect(harness.gate.publishStatus().canPublish).toBe(true);
  });

  it("uses the unmodified confirm-gate core (constructor identity)", () => {
    const harness = new ConfirmGateHarness();
    expect(harness.gate).toBeInstanceOf(ConfirmGate);
    expect(harness.ledger).toBeInstanceOf(TurnLedger);
    expect(harness.gate.checkpoints().files.status).toBe("confirmed");
  });
});
