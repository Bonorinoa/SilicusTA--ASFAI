/**
 * reword-flow.test.ts — the `reword` verb through the harness and the REAL gate (the same core the host
 * runs): the id and the plan's citations survive, the plan is flagged rather than pretended current, a
 * sealed version never changes, and publishing after a reword seals the next version with the new wording.
 */
import { describe, expect, it } from "vitest";
import { buildPlanScenario } from "./demo";

describe("reword through the harness and the real gate", () => {
  it("keeps the id, the confirmed plan and publishability; flags the plan; leaves v1 untouched; v2 carries the new wording", () => {
    const { harness, plan } = buildPlanScenario();
    const v1 = harness.publishCourse("first");
    if (!v1.ok) throw new Error(v1.message);
    const sealed1 = JSON.stringify(harness.publishedVersions()[0]);
    const row = harness.views().find((r) => r.status === "accepted")!;

    const r = harness.dispatch({ verb: "reword", proposalId: row.id, statement: "Students can explain what an algorithm is, with an example." });
    expect(r.ok).toBe(true);

    expect(harness.gate.getObjective(row.id)?.statement).toBe("Students can explain what an algorithm is, with an example.");
    expect(harness.gate.currentPlan()?.id).toBe(plan.id);
    expect(harness.gate.currentPlan()?.status).toBe("confirmed");
    expect(harness.gate.publishStatus().canPublish).toBe(true);
    expect(harness.gate.rewordedSincePlan().map((x) => x.objectiveId)).toEqual([row.id]);
    expect(JSON.stringify(harness.publishedVersions()[0])).toBe(sealed1);

    const view = harness.views().find((x) => x.id === row.id)!;
    expect(view.reworded).toBe(true);
    expect(view.statement).toBe("Students can explain what an algorithm is, with an example.");
    expect(view.originalStatement).toBe(row.originalStatement);
    expect(harness.timeline().at(-1)).toMatchObject({ verb: "reword", label: "Reworded", before: row.statement });

    const v2 = harness.publishCourse("reworded");
    if (!v2.ok) throw new Error(v2.message);
    expect(v2.version).toBe(2);
    expect(harness.publishedVersions()[1].objectiveRefs.find((o) => o.id === row.id)?.statement).toBe("Students can explain what an algorithm is, with an example.");
    expect(JSON.stringify(harness.publishedVersions()[0])).toBe(sealed1);
  });

  it("refuses a reword of a proposal, a dropped objective and an unknown id with the gate's own codes", () => {
    const { harness } = buildPlanScenario();
    const dropped = harness.views().find((r) => r.status === "dropped")!;
    expect(harness.dispatch({ verb: "reword", proposalId: dropped.id, statement: "Back." })).toMatchObject({ ok: false, code: "OBJECTIVE_REVOKED" });
    expect(harness.dispatch({ verb: "reword", proposalId: "urn:uuid:nope", statement: "x" })).toMatchObject({ ok: false, code: "UNKNOWN_OBJECTIVE" });
    const [fresh] = harness.propose([{ statement: "A new proposal." }]);
    expect(harness.dispatch({ verb: "reword", proposalId: fresh.id, statement: "x" })).toMatchObject({ ok: false, code: "NOT_CONFIRMED" });
    const same = harness.views().find((r) => r.status === "accepted")!;
    expect(harness.dispatch({ verb: "reword", proposalId: same.id, statement: same.statement })).toMatchObject({ ok: false, code: "STATEMENT_UNCHANGED" });
  });
});
