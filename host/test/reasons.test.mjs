/**
 * reasons.test.mjs — every publish blocker the gate can produce is classified into a code, so a UI can
 * say it in plain words. The real-session test is the teeth: if the gate's wording changes, it fails here
 * instead of the UI quietly showing "OTHER".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { classifyBlocker, reasonsOf } from "../reasons.mjs";

const OWNER = "teacher:tk-1";
const newStore = () => new CourseStore(mkdtempSync(join(tmpdir(), "silicus-reasons-")));

test("every gate blocker form gets a code; unknown text is kept, never dropped", () => {
  assert.deepEqual(classifyBlocker('checkpoint "files" is not teacher-confirmed'), { code: "CHECKPOINT_UNCONFIRMED", checkpoint: "files" });
  assert.deepEqual(classifyBlocker('checkpoint "outline" is not teacher-confirmed'), { code: "CHECKPOINT_UNCONFIRMED", checkpoint: "outline" });
  assert.deepEqual(classifyBlocker('checkpoint "objectives" is not teacher-confirmed'), { code: "CHECKPOINT_UNCONFIRMED", checkpoint: "objectives" });
  assert.deepEqual(classifyBlocker("undecided proposals await teacher decisions: urn:uuid:a, urn:uuid:b, urn:uuid:c"), { code: "UNDECIDED_PROPOSALS", count: 3 });
  assert.deepEqual(classifyBlocker("no teacher-confirmed lesson plan"), { code: "NO_CONFIRMED_PLAN" });
  assert.deepEqual(classifyBlocker("lesson plan urn:uuid:p is invalidated (objective dropped) and needs teacher re-confirmation"), { code: "PLAN_INVALIDATED" });
  assert.deepEqual(classifyBlocker("lesson plan has no activities"), { code: "PLAN_EMPTY" });
  assert.deepEqual(classifyBlocker("objective urn:uuid:x is not confirmed (status: proposed) — unconfirmed objectives must not appear on a published lesson plan"), { code: "PLAN_CITES_UNCONFIRMED", count: 1 });
  assert.deepEqual(classifyBlocker("a brand new rule"), { code: "OTHER", text: "a brand new rule" });
  assert.deepEqual(reasonsOf(["a brand new rule", "lesson plan has no activities"]), [{ code: "OTHER", text: "a brand new rule" }, { code: "PLAN_EMPTY" }]);
});

const ITEMS = [
  { kind: "local", statement: "Students can explain what an algorithm is." },
  { kind: "local", statement: "Students can find the claim in an AI answer." },
];
const spec = (ids) => ({
  title: "A plan", audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [{ title: "Spot it", minutes: 20, objectiveIds: ids, learnerDoes: "Mark the claim.", teacherDoes: "Ask why.", evidenceIfAny: "observation" }],
});

/** Assert the reasons mirror the blockers one for one, in order, and none fell through to OTHER. */
function check(session, expectCodes) {
  const { publish } = session.view();
  assert.ok(publish.blockers.length > 0, "this state must have blockers");
  assert.equal(publish.reasons.length, publish.blockers.length, `reasons mirror blockers: ${JSON.stringify(publish.blockers)}`);
  assert.deepEqual(publish.reasons.filter((r) => r.code === "OTHER"), [], `unclassified: ${JSON.stringify(publish.blockers)}`);
  assert.deepEqual(publish.reasons.map((r) => r.code), expectCodes);
}

test("a real session: every blocker state the gate produces is classified, none is OTHER", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T" });

  // Fresh course: three checkpoints open, no plan.
  check(session, ["CHECKPOINT_UNCONFIRMED", "CHECKPOINT_UNCONFIRMED", "CHECKPOINT_UNCONFIRMED", "NO_CONFIRMED_PLAN"]);
  assert.deepEqual(session.view().publish.reasons.slice(0, 3).map((r) => r.checkpoint), ["files", "outline", "objectives"]);

  // Proposals waiting: UNDECIDED_PROPOSALS counts the ids.
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  session.answerIntake({ text: "all", answers: { topic: "t", course: "c", learning_outcomes: "Students can explain what an algorithm is." }, at: 1100 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 1200 });
  session.proposeObjectives({ items: ITEMS, assistantText: "Proposed 2.", at: 1300 });
  const [p1, p2] = session.view().proposals.map((r) => r.id);
  check(session, ["CHECKPOINT_UNCONFIRMED", "UNDECIDED_PROPOSALS", "NO_CONFIRMED_PLAN"]);
  assert.equal(session.view().publish.reasons[1].count, 2);

  // Objectives decided, no plan yet.
  session.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }, { verb: "accept", proposalId: p2 }], text: "Decide.", at: 1400 });
  check(session, ["NO_CONFIRMED_PLAN"]);

  // A drafted-but-unconfirmed plan is still NO_CONFIRMED_PLAN.
  session.proposeLessonPlan({ spec: spec([p1, p2]), assistantText: "Drafted.", at: 1500 });
  check(session, ["NO_CONFIRMED_PLAN"]);

  // Confirmed then invalidated by revoking an objective it cites.
  session.confirmLessonPlan({ text: "Confirm the lesson plan.", at: 1600 });
  assert.equal(session.view().publish.canPublish, true);
  assert.deepEqual(session.view().publish.reasons, [], "no blockers, no reasons");
  session.decideObjectives({ decisions: [{ verb: "drop", proposalId: p2 }], text: "Revoke the second.", at: 1700 });
  const v = session.view();
  assert.equal(v.plan.status, "invalidated");
  check(session, ["PLAN_INVALIDATED"]);
  assert.match(v.publish.blockers[0], /^lesson plan \S+ is invalidated \(objective \S+ was dropped by the teacher\)/);
});
