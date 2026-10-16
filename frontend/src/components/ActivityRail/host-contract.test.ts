/**
 * host-contract.test.ts — the seam between the HOST's activity rows and the RAIL's sentences.
 *
 * Each side had its own tests and both were green, yet twice in one evening the host emitted a facts key the
 * rail does not read (`materials` as names, then `accept` instead of `accepted`). The rail correctly drops a
 * clause it cannot fill, so the defect is silent: the row just says less. This test runs real host rows
 * (host/activity.mjs over event records shaped like host/course.mjs writes them) through the real copy table
 * and fails if any fact-bearing row renders the same sentence it would with NO facts at all.
 */
import { describe, expect, it } from "vitest";
// Plain ES module from the host (the browser host imports host/*.mjs the same way).
import { activityOf } from "../../../../host/activity.mjs";
import type { ActivityItem } from "../../gate/types";
import { sentenceOf } from "./copy";

const RECORDS = [
  { seq: 1, event: { kind: "course.created", title: "T", materials: [{ name: "Unit 4 slides" }], at: 1 } },
  { seq: 2, event: { kind: "checkpoint.confirmed", id: "files", text: "Confirm.", at: 2 } },
  { seq: 3, event: { kind: "intake.observed", state: "clarifying", questions: [{ id: "topic" }, { id: "course" }, { id: "learning_outcomes" }], at: 3 } },
  { seq: 4, event: { kind: "objectives.proposed", items: [{ kind: "local", statement: "a" }, { kind: "local", statement: "b" }], sources: ["from your answer"], at: 4 } },
  { seq: 5, event: { kind: "objectives.proposed", items: [{ kind: "local", statement: "c" }], assistantText: "Proposed 1.", materials: [{ name: "Unit 4 notes", digest: "d", chars: 120 }], at: 5 } },
  { seq: 6, event: { kind: "objectives.decided", decisions: [{ verb: "accept" }, { verb: "rename" }, { verb: "drop" }, { verb: "add" }], text: "Decide.", at: 6 } },
  { seq: 7, event: { kind: "plan.proposed", spec: { activities: [{}, {}, {}] }, assistantText: "Drafted.", at: 7 } },
  { seq: 8, event: { kind: "plan.validated", planId: "p", valid: false, issues: ["x", "y"], at: 8 } },
  { seq: 9, event: { kind: "objectives.proposed", items: [{ kind: "local", statement: "d" }, { kind: "local", statement: "e" }, { kind: "local", statement: "f" }], sources: ["suggested by Silicus", "suggested by Silicus", "suggested by Silicus"], assistantText: "Suggested 3.", at: 9 } },
  { seq: 10, event: { kind: "package.published", text: "Publish.", at: 10 } },
];

/** Actions whose sentence is built from facts; every one must actually use them. */
const FACT_BEARING = new Set<ActivityItem["action"]>([
  "checkpoint.confirmed", "intake.asked", "objectives.derived", "objectives.drafted",
  "objectives.suggested", "objectives.decided", "plan.drafted", "plan.checked", "package.sealed",
]);

describe("host activity rows -> rail sentences (the seam)", () => {
  const rows = activityOf(RECORDS) as ActivityItem[];

  it("covers every fact-bearing action at least once", () => {
    const seen = new Set(rows.map((r) => r.action));
    for (const a of FACT_BEARING) expect(seen.has(a), a).toBe(true);
  });

  it("no fact-bearing row renders the same as it would with no facts (no silently dropped clause)", () => {
    for (const r of rows.filter((x) => FACT_BEARING.has(x.action))) {
      expect(sentenceOf(r), `${r.action} ${JSON.stringify(r.facts)}`).not.toBe(sentenceOf({ ...r, facts: {} }));
    }
  });

  it("says the counts the host sent, in words", () => {
    const by = (a: string) => sentenceOf(rows.find((r) => r.action === a)!);
    expect(by("objectives.decided")).toMatch(/1 accepted, 1 renamed, 1 dropped, 1 added/);
    expect(by("objectives.drafted")).toMatch(/1 objective from 1 material/);
    expect(by("objectives.suggested")).toBe("Suggested 3 objectives to round out yours");
    expect(sentenceOf({ ...rows.find((r) => r.action === "objectives.suggested")!, facts: { count: 1 } })).toBe("Suggested 1 objective to round out yours");
    expect(by("plan.drafted")).toMatch(/3 activities/);
    expect(by("package.sealed")).toMatch(/version 1/);
  });
});
