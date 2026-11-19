/**
 * scripted-plans.test.mjs — H2b: the scripted v2 plans the smokes and the screenshot scripts show
 * (scripted-course.mjs, scriptedPlanV2). Test-fixture content, run through the REAL PlanWorker and the
 * host's validator, so what the screenshots show is what the host keeps.
 *
 *   AI in Daily Life, ages 5-12 (stage 1): 45 minutes (K2: the wizard default), 3 activities over phases 1, 2 and 3-4, an
 *     opening bet on the hard prerequisite, one session evidence line, two spaced reviews, objectives
 *     cited from the course's own, and nothing for the host to adjust.
 *   A stage-3 Computing course, ages 12-14: one activity asks for AI with no first try, and the host's
 *     clamp turns it into "forbidden" with a note the teacher sees under "Silicus adjusted".
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { modelReply, scriptedPlanV2, staleStage3PlanV2 } from "./scripted-course.mjs";

const MOCKS = [];
after(() => MOCKS.forEach((m) => m.close()));

const OBJECTIVES = [
  { id: "urn:uuid:11111111-1111-4111-8111-111111111111", statement: "Students can identify at least five examples of AI in their daily life." },
  { id: "urn:uuid:22222222-2222-4222-8222-222222222222", statement: "Students can explain that these technologies use patterns and data, not magic." },
];
const SMART = { id: "mt_WRRv1ABECC", name: "Smart Versus Not-Smart Devices", evidence: ["Sort devices into smart and not-smart"] };

async function draftWith(input) {
  const mock = await startMockWorker({ reply: ({ prompt }) => scriptedPlanV2(prompt) });
  MOCKS.push(mock);
  return new PlanWorker({ url: mock.url, model: "test-model" }).draft({ objectives: OBJECTIVES, ...input });
}
const minutes = (spec) => spec.activities.reduce((n, a) => n + a.minutes, 0);
const ids = new Set(OBJECTIVES.map((o) => o.id));

test("AI in Daily Life (5-12): a coherent stage-1 plan the host keeps without adjusting", async () => {
  const spec = await draftWith({ topic: "AI in daily life", ages: { min: 5, max: 12 }, anchorPrereqs: [SMART] });
  assert.equal(spec.title, "Spotting AI in daily life");
  assert.doesNotMatch(JSON.stringify(spec), /plant|leaf|sugar/i, "nothing from the v1 plants story");
  assert.equal(spec.activities.length, 3);
  assert.equal(minutes(spec), 45, "K2: the scripted activities add up to the wizard's default 45-minute lesson");
  assert.deepEqual(spec.activities.map((a) => [a.phase, a.supportingPhase ?? null]), [[1, null], [2, null], [3, 4]]);
  assert.match(spec.activities[0].learnerDoes, /^Opening bet on the hard prerequisite, Smart Versus Not-Smart Devices\./);
  assert.ok(spec.activities[0].learnerFirst, "the bet is the learner's first try");
  assert.equal(spec.sessions.length, 1);
  assert.equal(spec.spacedReviews.length, 2);
  for (const a of spec.activities) {
    assert.equal(a.aiStatus, "forbidden");
    assert.ok(a.objectiveIds.length > 0 && a.objectiveIds.every((id) => ids.has(id)), "cites only the course's own objectives");
  }
  assert.deepEqual(new Set(spec.activities.flatMap((a) => a.objectiveIds)), ids, "every objective is cited");
  assert.match(spec.aiPolicy, /^AI in this course: learners do not use AI at all/);
  assert.equal(spec.notes, undefined, "nothing for Silicus to adjust");
});

test("stage-3 Computing (12-14): the AI-with-no-first-try activity is clamped, with a visible note naming it", async () => {
  const spec = await draftWith({ topic: "Searching and sorting", ages: { min: 12, max: 14 } });
  assert.equal(spec.title, "How a computer finds things fast");
  assert.equal(spec.activities.length, 3);
  assert.equal(minutes(spec), 45, "K2: the scripted activities add up to the wizard's default 45-minute lesson");
  assert.deepEqual(spec.activities.map((a) => a.aiStatus), ["forbidden", "permitted", "forbidden"]);
  assert.equal(spec.activities[2].learnerFirst, undefined, "the third activity has no first try");
  // H3 C2: the clamp note names the activity (number and title), and the activity carries the
  // clamped flag with the reason, so the UI never has to match note text.
  assert.deepEqual(spec.notes, ['aiStatus "permitted" clamped to "forbidden" in activity 3 "Explain it in your own words": at this stage AI may follow only an attempt the teacher has watched.']);
  assert.deepEqual(spec.activities[2].clamped, { from: "permitted", to: "forbidden", reason: "at this stage AI may follow only an attempt the teacher has watched" });
  assert.equal(spec.aiPolicy, undefined, "stage 3 carries no plan-level line");
  for (const a of spec.activities) assert.ok(a.objectiveIds.every((id) => ids.has(id)));
});

test("stage-3 fixture (unit only): when the clamped activity's prose still mentions AI, the host keeps the prose and the marker flag still shows", async () => {
  // H3 C2: the host never rewrites an activity's prose. One fixture case keeps the old wording —
  // a learner text that still mentions a chatbot — to prove the clamp marker does not depend on it.
  const mock = await startMockWorker({ reply: ({ prompt }) => staleStage3PlanV2(prompt) });
  MOCKS.push(mock);
  const spec = await new PlanWorker({ url: mock.url, model: "test-model" }).draft({ objectives: OBJECTIVES, topic: "Searching and sorting", ages: { min: 12, max: 14 } });
  assert.equal(spec.activities[2].aiStatus, "forbidden");
  assert.match(spec.activities[2].learnerDoes, /chatbot/, "stale prose survives the clamp unchanged");
  assert.equal("clamped" in spec.activities[2], true, "the marker flag is set on the clamped activity");
  assert.ok(spec.notes.some((n) => n.startsWith('aiStatus "permitted" clamped to "forbidden" in activity 3 "Explain it in your own words"')));
});

test("the v1 scripted plan is unchanged for the v1 tests", () => {
  const reply = modelReply(`Draft one lesson plan\n- ${OBJECTIVES[0].id}: x`);
  assert.equal(reply.title, "How plants eat");
  assert.equal("sessions" in reply, false);
});
