/**
 * CourseStudio.decisions.test.tsx — lane A3: the decision pill counts real teacher decisions, never
 * bookkeeping. Saving answers (intake.answered) records the teacher's words; creating the course is
 * a record event. Neither is a decision. A decision is a real choice: confirming any checkpoint or
 * the plan, deciding objectives (one row can carry several verbs — facts.decisions), or publishing.
 */
import { describe, expect, it } from "vitest";
import type { ActivityItem } from "../gate/types";
import { decisionCount, decisionPillLabel } from "./CourseStudio";

const row = (actor: string, action: ActivityItem["action"], facts: Record<string, unknown> = {}) =>
  ({ seq: 1, at: 1, actor, action, artifact: "record", facts } as ActivityItem);

const TEACHER_WALK = [
  // Bookkeeping: the record opens and the answers are saved — no decisions here.
  row("teacher", "course.created", { materials: 0 }),
  row("teacher", "intake.answered", { answers: 3 }),
  row("teacher", "intake.answered", { answers: 1 }),
  // Real decisions:
  row("teacher", "checkpoint.confirmed", { checkpoint: "files" }),
  row("teacher", "checkpoint.confirmed", { checkpoint: "outline" }),
  row("teacher", "objectives.decided", { decisions: 3, accept: 2, add: 1 }),   // two accepts + one add = 3 choices in one act
  row("teacher", "plan.confirmed"),
  row("teacher", "package.sealed", { version: 1 }),
  // Everyone else's work is not the teacher deciding:
  row("worker", "objectives.drafted", { count: 3 }),
  row("worker", "plan.drafted", { activities: 4 }),
  row("asfai", "intake.sent", { fields: 3 }),
];

describe("decisionCount", () => {
  it("counts only real decisions, not bookkeeping turns", () => {
    // 8 teacher rows, 7 of which are decisions (2 checkpoints + 3 objective verbs + plan + publish).
    expect(decisionCount(TEACHER_WALK)).toBe(7);
  });

  it("a decide act with several verbs counts each", () => {
    expect(decisionCount([row("teacher", "objectives.decided", { decisions: 2, accept: 1, rename: 1 })])).toBe(2);
    expect(decisionCount([row("teacher", "objectives.decided", { decisions: 4, accept: 4 })])).toBe(4);
  });

  it("saving answers is never a decision", () => {
    expect(decisionCount([row("teacher", "intake.answered", { answers: 4 })])).toBe(0);
    expect(decisionCount([row("teacher", "course.created", { materials: 1 })])).toBe(0);
  });

  it("ignores the worker's and the model's rows", () => {
    expect(decisionCount([
      row("worker", "objectives.drafted", { count: 3 }),
      row("worker", "plan.drafted", { activities: 4 }),
      row("asfai", "plan.checked", { valid: true, issues: 0 }),
      row("teacher", "plan.confirmed"),
    ])).toBe(1);
  });

  it("survives an empty or absent activity list", () => {
    expect(decisionCount([])).toBe(0);
    expect(decisionCount(undefined as unknown as readonly ActivityItem[])).toBe(0);
  });
});

describe("decisionPillLabel", () => {
  it("says 'No decisions yet' with zero", () => {
    expect(decisionPillLabel(0)).toBe("No decisions yet");
  });
  it("counts through plural, never '1 decisions'", () => {
    expect(decisionPillLabel(1)).toBe("1 decision recorded");
    expect(decisionPillLabel(4)).toBe("4 decisions recorded");
    expect(decisionPillLabel(1)).not.toBe("1 decisions recorded");
  });
});