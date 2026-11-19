/**
 * A reworded-then-published version shows as "Reworded" in the version diff. Built with the REAL gate,
 * so the sealed records are exactly what a host seals: same objective id, new statement, same plan.
 */
import { describe, expect, it } from "vitest";
import { buildPlanScenario } from "../gate/demo";
import { diffVersions } from "./versionDiff";

describe("diffVersions over a real reword", () => {
  it("v1 against a v2 sealed after rewording one objective: that objective is Reworded, everything else unchanged", () => {
    const { harness } = buildPlanScenario();
    expect(harness.publishCourse("v1").ok).toBe(true);
    const target = harness.views().find((r) => r.status === "accepted")!;
    const wording = "Students can explain what an algorithm is, in their own words, with a worked example.";
    expect(harness.dispatch({ verb: "reword", proposalId: target.id, statement: wording }).ok).toBe(true);
    expect(harness.publishCourse("v2").ok).toBe(true);

    const [v1, v2] = harness.publishedVersions();
    const d = diffVersions(v1, v2);
    expect(d.identical).toBe(false);
    const row = d.objectives.find((o) => o.id === target.id)!;
    expect(row.status).toBe("reworded");
    expect(row.before?.statement).toBe(target.statement);
    expect(row.after?.statement).toBe(wording);
    expect(d.objectives.filter((o) => o.id !== target.id).every((o) => o.status === "unchanged")).toBe(true);
    expect(d.counts.objectives).toMatchObject({ reworded: 1, added: 0, removed: 0, changed: 0 });
    // The plan is the same plan with the same citations: nothing to report there.
    expect(d.activities.every((a) => a.status === "unchanged")).toBe(true);
  });
});
