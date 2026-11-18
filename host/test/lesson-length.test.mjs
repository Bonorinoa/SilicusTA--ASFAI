/**
 * lesson-length.test.mjs — K2 (owner, 17 Nov): the teacher sets the lesson length; the plan fits it.
 *
 *   1. The course record carries `lessonMinutes` (a whole number 10-180) on BOTH stores, read from the
 *      hash-chained course.created event. Absent is a legacy course: unset, behaves as before.
 *   2. The plan prompt states the length; without one the prompt is unchanged.
 *   3. After the model returns, the host sums activity minutes. Outside ±10% it keeps the plan as written and
 *      adds a teacher-visible note; it never rescales numbers. Spaced reviews are outside the session.
 *   5. Runaway output is bounded in the schema: at most 8 activities, each text field cut to a fixed length.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanWorker } from "../worker.mjs";
import { CourseSession } from "../course.mjs";
import { CourseStore } from "../store.mjs";
import { RecordStore } from "../record-store.mjs";
import { lessonMinutesError, lengthNotes, MAX_ACTIVITIES, TEXT_LIMITS } from "../lesson-length.mjs";
import { startMockWorker } from "./mock-worker.mjs";

const MOCKS = [];
after(() => MOCKS.forEach((m) => m.close()));

const OBJ = [{ id: "urn:uuid:aaa", statement: "Students can explain what an algorithm is." }];
const act = (minutes, extra = {}) => ({
  title: `Step ${minutes}`, ...(minutes === undefined ? {} : { minutes }), objectiveIds: ["urn:uuid:aaa"],
  learnerDoes: "Sort the cards.", teacherDoes: "Ask why.", evidenceIfAny: "observation", ...extra,
});
const planOf = (mins, extra = {}) => ({ title: "Algorithms", activities: mins.map((m) => act(m)), ...extra });

async function workerWith(reply) {
  const mock = await startMockWorker({ reply });
  MOCKS.push(mock);
  return { mock, worker: new PlanWorker({ url: mock.url, model: "test-model" }) };
}
const promptOf = (mock) => mock.st.lastPrompt;

/* ---- the length rule itself ---- */

test("lessonMinutes: absent is unset; whole numbers 10-180 pass; anything else is a plain refusal", () => {
  assert.equal(lessonMinutesError(undefined), null);
  assert.equal(lessonMinutesError(null), null);
  for (const ok of [10, 20, 45, 90, 180]) assert.equal(lessonMinutesError(ok), null, String(ok));
  for (const bad of [9, 181, 45.5, "45", 0, -5, NaN, {}]) assert.match(String(lessonMinutesError(bad)), /whole number of minutes from 10 to 180/, String(bad));
});

test("length check: exact and within ±10% add no note; over and under name both numbers; nothing is rescaled", () => {
  assert.deepEqual(lengthNotes([{ minutes: 15 }, { minutes: 15 }, { minutes: 15 }], 45), []);           // exact
  assert.deepEqual(lengthNotes([{ minutes: 20 }, { minutes: 29 }], 45), []);                            // 49 ≤ 49.5
  assert.deepEqual(lengthNotes([{ minutes: 20 }, { minutes: 21 }], 45), []);                            // 41 ≥ 40.5
  assert.deepEqual(lengthNotes([{ minutes: 40 }, { minutes: 30 }], 45), ["Activities add up to 70 min; you asked for 45. Trim or edit."]);
  assert.deepEqual(lengthNotes([{ minutes: 10 }, { minutes: 20 }], 45), ["Activities add up to 30 min; you asked for 45. Lengthen or edit."]);
  assert.deepEqual(lengthNotes([{ minutes: 20 }, { minutes: 30 }], 45), ["Activities add up to 50 min; you asked for 45. Trim or edit."]); // 50 > 49.5
  assert.deepEqual(lengthNotes([{ minutes: 70 }], null), [], "no length set: behaves as today, no check");
});

test("length check: an activity with no minutes is named, counted as 0, and the total is still checked", () => {
  const notes = lengthNotes([{ title: "Warm up", minutes: 0, minutesMissing: true }, { title: "Main", minutes: 30 }], 45);
  assert.deepEqual(notes, [
    'Activity 1 "Warm up" gives no minutes; it counts as 0.',
    "Activities add up to 30 min; you asked for 45. Lengthen or edit.",
  ]);
});

/* ---- the worker: prompt and host check ---- */

test("the prompt states the length and the ±10% rule; spaced reviews are outside it; no length = old prompt", async () => {
  const { mock, worker } = await workerWith(planOf([15, 15, 15]));
  await worker.draft({ objectives: OBJ, topic: "algorithms", lessonMinutes: 45 });
  const p = promptOf(mock);
  assert.match(p, /The lesson is 45 minutes long\. Activity minutes must add up to 45, within 10% \(41 to 49\)\./);
  assert.match(p, /spacedReviews happen after the lesson and do not count/);
  await worker.draft({ objectives: OBJ, topic: "algorithms" });
  assert.doesNotMatch(promptOf(mock), /minutes long/);
});

test("the host check after the model: within tolerance no note; over keeps the plan's own numbers and adds a note", async () => {
  const fits = await (await workerWith(planOf([15, 15, 14]))).worker.draft({ objectives: OBJ, lessonMinutes: 45 });
  assert.equal(fits.notes, undefined);
  const over = await (await workerWith(planOf([40, 30], {
    spacedReviews: [{ afterDays: 7, form: "near-transfer", whatChanges: "a new setting", prompt: "Do it again." }],
  }))).worker.draft({ objectives: OBJ, lessonMinutes: 45 });
  assert.deepEqual(over.activities.map((a) => a.minutes), [40, 30], "never rescaled");
  assert.deepEqual(over.notes, ["Activities add up to 70 min; you asked for 45. Trim or edit."]);
  const missing = await (await workerWith(planOf([undefined, 45]))).worker.draft({ objectives: OBJ, lessonMinutes: 45 });
  assert.deepEqual(missing.notes, ['Activity 1 "Step undefined" gives no minutes; it counts as 0.']);
  const unset = await (await workerWith(planOf([40, 30]))).worker.draft({ objectives: OBJ });
  assert.equal(unset.notes, undefined, "a course with no length behaves as today");
});

/* ---- item 5: the runaway bound ---- */

test("runaway bound: the prompt caps activities and text; the host keeps the first 8 activities with a note", async () => {
  const { mock, worker } = await workerWith(planOf([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]));
  const out = await worker.draft({ objectives: OBJ });
  assert.match(promptOf(mock), new RegExp(`At most ${MAX_ACTIVITIES} activities`));
  assert.equal(out.activities.length, MAX_ACTIVITIES);
  assert.ok(out.notes.includes(`Kept the first ${MAX_ACTIVITIES} of 10 activities; a lesson plan holds at most ${MAX_ACTIVITIES}.`), JSON.stringify(out.notes));
});

test("runaway bound: every free-text field is cut to its limit by the host's clean()", async () => {
  const long = "word ".repeat(2000);
  const { worker } = await workerWith({
    title: long,
    spacedReviews: [{ afterDays: 7, form: "near-transfer", whatChanges: long, prompt: long }],
    sessions: [{ session: 1, evidence: { kind: "observation", whatLearnerProduces: long } }],
    activities: [act(45, { title: long, learnerDoes: long, teacherDoes: long, targetOperation: long, learnerFirst: long, decisionAfterHelp: long })],
  });
  const out = await worker.draft({ objectives: OBJ });
  const a = out.activities[0];
  assert.ok(out.title.length <= TEXT_LIMITS.planTitle);
  assert.ok(a.title.length <= TEXT_LIMITS.activityTitle);
  assert.ok(a.learnerDoes.length <= TEXT_LIMITS.does && a.teacherDoes.length <= TEXT_LIMITS.does);
  assert.ok(a.targetOperation.length <= 200 && a.learnerFirst.length <= 300 && a.decisionAfterHelp.length <= 300);
  assert.ok(out.sessions[0].evidence.whatLearnerProduces.length <= 400);
  assert.ok(out.spacedReviews[0].prompt.length <= 400 && out.spacedReviews[0].whatChanges.length <= 300);
  assert.ok(JSON.stringify(out).length < 6000, `bounded plan size: ${JSON.stringify(out).length}`);
});

/* ---- item 1: both stores carry it ---- */

test("the course record carries lessonMinutes on the disk store and the record store, byte-identically", () => {
  const at = 1_700_000_000_000;
  const disk = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-k2-")));
  const mem = new RecordStore();
  const args = { courseId: "urn:uuid:k2", owner: "t", title: "T", seed: "urn:uuid:seed", at, ages: { min: 8, max: 10 }, lessonMinutes: 45 };
  disk.initCourse(args);
  mem.initCourse(args);
  const memSnap = mem.snapshot()[0];
  assert.match(memSnap.metaText, /"lessonMinutes": 45/);
  assert.equal(JSON.parse(memSnap.lines[0]).event.lessonMinutes, 45);
  const diskLog = disk.log("urn:uuid:k2").read();
  assert.equal(diskLog[0].event.lessonMinutes, 45);
  assert.deepEqual(JSON.parse(memSnap.metaText), JSON.parse(JSON.stringify(disk.meta("urn:uuid:k2"))));
});

test("CourseSession: lessonMinutes is stored, replayed and shown; a bad value is refused; a legacy course is unset", () => {
  const store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-k2s-")));
  const s = CourseSession.create(store, { owner: "t", title: "T", lessonMinutes: 60 });
  assert.equal(s.view().course.lessonMinutes, 60);
  assert.equal(CourseSession.load(store, s.courseId).view().course.lessonMinutes, 60, "replayed from the chained event");
  assert.throws(() => CourseSession.create(store, { owner: "t", title: "T", lessonMinutes: 200 }), (e) => e.code === "BAD_LESSON_MINUTES");
  const old = CourseSession.create(store, { owner: "t", title: "Old" });
  assert.equal("lessonMinutes" in old.view().course, false);
  const created = store.log(old.courseId).read()[0].event;
  assert.equal("lessonMinutes" in created, false, "legacy record stays byte-identical: no field written");
});
