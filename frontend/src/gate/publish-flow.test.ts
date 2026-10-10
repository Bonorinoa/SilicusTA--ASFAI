/**
 * publish-flow.test.ts — the checkpoint-5 law, tested through the REAL gate:
 *  - the teacher publishes, never the AI: any forged provenance is rejected
 *    with FabricatedConfirmationError, and the harness's publishCourse always
 *    records a real teacher turn first;
 *  - versions bump and are never overwritten;
 *  - publish is idempotent when nothing changed (MCP retry semantics);
 *  - a post-publish change binds to the NEXT version and the old version
 *    record stays frozen.
 */
import { describe, expect, it } from "vitest";
import { buildPlanScenario } from "./demo";
import { FabricatedConfirmationError } from "../../../confirm-gate/confirm-gate.mjs";

describe("publish (checkpoint 5) through the harness", () => {
  it("publishCourse records a real teacher turn, then seals version 1", () => {
    const scenario = buildPlanScenario();
    const { harness } = scenario;

    const ledgerSizeBefore = harness.ledger.size;
    const result = harness.publishCourse("Ready for Monday.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe(1);
    // A publish is a genuine teacher turn in the ledger, never a silent action.
    expect(harness.ledger.size).toBe(ledgerSizeBefore + 1);

    expect(harness.gate.checkpoints().publish.status).toBe("confirmed");
    const versions = harness.publishedVersions();
    expect(versions.length).toBe(1);
    expect(versions[0]).toMatchObject({
      version: 1,
      previousVersion: null,
      note: "Ready for Monday.",
      status: "published",
    });
    expect(versions[0].objectiveRefs.length).toBeGreaterThan(0);
    expect(versions[0].lessonPlan).not.toBeNull();
  });

  it("rejects fabricated provenance — the AI structurally cannot publish", () => {
    const scenario = buildPlanScenario();
    const { harness } = scenario;

    // A REAL turn exists, but the provenance is tampered with: it no longer
    // matches the turn it claims to cite.
    const real = harness.recordTeacherTurn("Publish now.");
    const forged = { ...real, decidedBy: "assistant:model-1" };

    expect(() => harness.gate.publish({ provenance: forged })).toThrow(
      FabricatedConfirmationError,
    );
    expect(harness.publishedVersions().length).toBe(0);

    // A provenance that cites no recorded turn at all is also rejected.
    expect(() =>
      harness.gate.publish({
        provenance: {
          turnRef: "urn:turn:999",
          decidedBy: "teacher:tk-1",
          channel: "silicus-ui",
          decidedAt: Date.now(),
        },
      }),
    ).toThrow(FabricatedConfirmationError);
  });

  it("is idempotent when nothing changed since the last publish (retry semantics)", () => {
    const scenario = buildPlanScenario();
    const { harness } = scenario;

    const first = harness.publishCourse();
    if (!first.ok) throw new Error(first.message);
    const second = harness.publishCourse();
    if (!second.ok) throw new Error(second.message);

    expect(second.version).toBe(first.version);
    expect(harness.publishedVersions().length).toBe(1);
  });

  it("a post-publish change binds to the NEXT version; the old version stays frozen", () => {
    const scenario = buildPlanScenario();
    const { harness } = scenario;

    const pub1 = harness.publishCourse();
    if (!pub1.ok) throw new Error(pub1.message);
    const v1 = harness.publishedVersions()[0];
    const v1Count = v1.objectiveRefs.length;

    // The teacher adds an objective AFTER sealing version 1.
    const added = harness.dispatch({
      verb: "add",
      statement: "Students can say where their last answer came from.",
    });
    if (!added.ok) throw new Error(added.message);
    // Any change after a publish demotes checkpoint 5 back to pending.
    expect(harness.gate.checkpoints().publish.status).toBe("pending");

    const pub2 = harness.publishCourse("Second edition.");
    if (!pub2.ok) throw new Error(pub2.message);
    expect(pub2.version).toBe(2);

    const versions = harness.publishedVersions();
    expect(versions.length).toBe(2);
    expect(versions[1].previousVersion).toBe(1);
    // Version 1 is immutable: it still reflects exactly what was confirmed then.
    expect(versions[0].objectiveRefs.length).toBe(v1Count);
    expect(versions[1].objectiveRefs.length).toBe(v1Count + 1);
    // The new decision binds to version 2, not 1.
    const decisions = harness.gate.decisions();
    const last = decisions[decisions.length - 1];
    expect(last.verb).toBe("add");
    expect(last.boundCourseVersion).toBe(2);
  });

  it("planInvalidation() names the dropped citation and the activities citing it (D)", () => {
    const scenario = buildPlanScenario();
    const { harness, plan } = scenario;

    expect(harness.planInvalidation()).toEqual({ invalidated: false, gaps: [] });

    // Drop an objective the plan cites (the renamed one, cited by "Spotting the claim").
    const citedIds = new Set(plan.activities.flatMap((a) => a.objectiveIds));
    const dropped = harness.views().find((r) => r.status === "renamed" && citedIds.has(r.id));
    if (!dropped) throw new Error("demo scenario should have a renamed, cited objective");
    const result = harness.dispatch({ verb: "drop", proposalId: dropped.id });
    if (!result.ok) throw new Error(result.message);

    const invalidation = harness.planInvalidation();
    expect(invalidation.invalidated).toBe(true);
    expect(invalidation.gaps.length).toBe(1);
    expect(invalidation.gaps[0].id).toBe(dropped.id);
    expect(invalidation.gaps[0].statement).toContain("Learners can find the claim");
    expect(invalidation.gaps[0].citedIn).toContain("Spotting the claim");
    // Plan status reflects the invalidation; the original first confirmation is gone.
    expect(harness.gate.currentPlan()?.status).toBe("invalidated");

    // Re-confirm is legal (post-invalidation repair) — but publish stays blocked
    // while the citation is broken: unconfirmed proposals must not ship.
    harness.confirmPlan("Re-confirm this lesson plan after invalidation.");
    expect(harness.gate.currentPlan()?.status).toBe("confirmed");
    expect(harness.planInvalidation().invalidated).toBe(false);
    const publish = harness.gate.publishStatus();
    expect(publish.canPublish).toBe(false);
    expect(publish.blockers.join(" ")).toMatch(/not confirmed/);
  });

  it("versionChanges() diffs sealed versions against their predecessor (D)", () => {
    const scenario = buildPlanScenario();
    const { harness } = scenario;
    harness.publishCourse("v1.");
    harness.dispatch({ verb: "add", statement: "Students can say where their last answer came from." });
    harness.publishCourse("v2.");

    const changes = harness.versionChanges();
    expect(changes.length).toBe(2);
    // A FIRST seal's predecessor is nothing, so everything ships as "added" —
    // that is what v1 introduced, which is the useful review fact.
    expect(changes[0]).toMatchObject({ version: 1, previousVersion: null, removed: [] });
    expect(changes[0].added.length).toBeGreaterThan(0);
    expect(changes[1].previousVersion).toBe(1);
    expect(changes[1].added).toEqual([
      "Students can say where their last answer came from.",
    ]);
    expect(changes[1].removed).toEqual([]);
  });

  it("timeline() merges decisions, checkpoints, and seals in real order", () => {
    const scenario = buildPlanScenario();
    const { harness } = scenario;
    harness.publishCourse("Ship it.");
    harness.dispatch({ verb: "add", statement: "A follow-up objective." });
    harness.publishCourse();

    const events = harness.timeline();
    const kinds = events.map((e) => e.kind);
    // Chronological: the last event is the second seal.
    expect(events[events.length - 1]).toMatchObject({ kind: "publish", version: 2 });
    expect(kinds.filter((k) => k === "publish").length).toBe(2);
    expect(kinds.filter((k) => k === "decision").length).toBeGreaterThanOrEqual(5);
    expect(kinds).toContain("checkpoint");
  });
});