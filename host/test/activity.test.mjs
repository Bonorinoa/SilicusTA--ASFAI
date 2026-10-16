/**
 * activity.test.mjs — view.activity: what each actor did, derived from the verified event log.
 * Pure and replay-exact; facts are counts, names and flags only, never material text.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { activityOf } from "../activity.mjs";
import { createApp } from "../server.mjs";
import { PlanWorker } from "../worker.mjs";
import { MATERIAL, MATERIAL_SECRET, runScriptedCourse, chatCompletion } from "./scripted-course.mjs";

const OWNER = "teacher:tk-1";
const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
const CLARIFY = FX.clarifying.response;
const READY = FX.ready_to_draft.response;
const newStore = () => new CourseStore(mkdtempSync(join(tmpdir(), "silicus-activity-")));

const ITEMS = [
  { kind: "local", statement: "Students can explain what an algorithm is." },
  { kind: "local", statement: "Students can find the claim in an AI answer." },
];
const planSpec = (ids) => ({
  title: "A plan", audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    { title: "Spot it", minutes: 20, objectiveIds: ids, learnerDoes: "Mark the claim.", teacherDoes: "Ask why.", evidenceIfAny: "observation" },
    { title: "Say it", minutes: 10, objectiveIds: ids, learnerDoes: "Explain.", teacherDoes: "Listen.", evidenceIfAny: "observation" },
  ],
});

/** One course through every mapped event kind, at fixed times. */
function drive(session, t0 = 1000) {
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: t0 });
  session.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: t0 + 100 });
  session.answerIntake({ text: "Topic: algorithms.", answers: { topic: "algorithms", course: "AI literacy", learning_outcomes: "Explain an algorithm." }, at: t0 + 200 });
  session.observeIntake({ state: READY.state, sent: ["topic", "course", "learning_outcomes"], at: t0 + 300 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: t0 + 400 });
  session.proposeObjectives({ items: ITEMS, assistantText: "Proposed 2 objectives.", at: t0 + 500 });
  const [p1, p2] = session.view().proposals.map((r) => r.id);
  session.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }, { verb: "rename", proposalId: p2, statement: "Students can name the claim." }, { verb: "add", statement: "Students can ask one question." }], text: "Decide.", at: t0 + 600 });
  session.proposeLessonPlan({ spec: planSpec([p1, p2]), assistantText: "Drafted a plan.", at: t0 + 700 });
  session.recordValidation({ planId: session.view().plan.id, valid: true, issues: [], at: t0 + 750 });
  session.confirmLessonPlan({ text: "Confirm the lesson plan.", at: t0 + 800 });
  session.publish({ text: "Publish the course package.", note: "first version", at: t0 + 900 });
}

test("one row per mapped event: oldest first, seq strictly increasing, the right actor, action and artifact", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T", materials: [{ name: "Slides" }] });
  drive(session);
  const rows = session.view().activity;
  assert.deepEqual(rows.map((r) => [r.actor, r.action, r.artifact]), [
    ["teacher", "course.created", "record"],
    ["teacher", "checkpoint.confirmed", "record"],
    ["asfai", "intake.asked", "outline"],
    ["teacher", "intake.answered", "outline"],
    ["asfai", "intake.sent", "outline"],
    ["teacher", "checkpoint.confirmed", "outline"],
    ["worker", "objectives.drafted", "objectives"],
    ["teacher", "objectives.decided", "objectives"],
    ["worker", "plan.drafted", "plan"],
    ["asfai", "plan.checked", "plan"],
    ["teacher", "plan.confirmed", "plan"],
    ["teacher", "package.sealed", "package"],
  ]);
  assert.equal(rows.length, session.view().integrity.events, "every logged event here maps to a row");
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].seq > rows[i - 1].seq, "seq strictly increasing");
  // Order is the log's order (seq). `at` is the event's own timestamp, not a sort key: a test course is created on the wall clock.
  for (const r of rows) assert.equal(typeof r.at, "number");
  for (const r of rows) for (const v of Object.values(r.facts)) assert.ok(["string", "number", "boolean"].includes(typeof v));

  const f = (action) => rows.find((r) => r.action === action).facts;
  assert.deepEqual(f("course.created"), { materials: 1 });
  assert.deepEqual(f("intake.asked"), { questions: 3 });
  assert.deepEqual(f("intake.answered"), { answers: 3 });
  assert.deepEqual(f("intake.sent"), { fields: 3 });
  assert.deepEqual(f("objectives.drafted"), { count: 2 });
  assert.deepEqual(f("objectives.decided"), { decisions: 3, accept: 1, rename: 1, add: 1 });
  assert.deepEqual(f("plan.drafted"), { activities: 2 });
  assert.deepEqual(f("plan.checked"), { valid: true, issues: 0 });
  assert.deepEqual(rows.filter((r) => r.action === "checkpoint.confirmed").map((r) => r.facts.checkpoint), ["files", "outline"]);
  assert.deepEqual(f("package.sealed"), { version: 1 });
});

test("a proposal the teacher's own answers produced is Silicus, not the drafting model", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T" });
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  session.answerIntake({ text: "all", answers: { topic: "t", course: "c", learning_outcomes: "Students can explain an algorithm." }, at: 1100 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 1200 });
  assert.equal(session.proposeObjectivesFromAnswers({ at: 1300 }).ok, true);
  const row = session.view().activity.at(-1);
  assert.deepEqual([row.actor, row.action, row.artifact], ["silicus", "objectives.derived", "objectives"]);
  assert.deepEqual(row.facts, { count: 1, source: "local" });
});

test("objectives drafted from material: count and material NAMES, never the material text", async () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T", materials: [{ name: MATERIAL.name }] });
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  session.answerIntake({ text: "x", answers: { topic: "t", course: "c", outcomes_from: "materials" }, at: 1100 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 1200 });
  const worker = { draftObjectives: async ({ materials }) => materials.map((m) => ({ statement: `Students can use ${m.name}.`, from: [m.name] })) };
  const r = await session.proposeObjectivesFromMaterials({ worker, materials: [{ name: MATERIAL.name, text: MATERIAL.text, chars: MATERIAL.text.length, digest: "d" }], at: 1300 });
  assert.equal(r.ok, true);
  const row = session.view().activity.at(-1);
  assert.deepEqual([row.actor, row.action], ["worker", "objectives.drafted"]);
  assert.deepEqual(row.facts, { count: 1, materials: MATERIAL.name, characters: MATERIAL.text.length });
  assert.equal(JSON.stringify(session.view().activity).includes(MATERIAL_SECRET), false);
});

test("replay: a session reloaded from the same log yields a byte-identical activity", () => {
  const store = newStore();
  const first = CourseSession.create(store, { owner: OWNER, title: "T" });
  drive(first);
  const reloaded = CourseSession.load(store, first.courseId);
  assert.equal(JSON.stringify(reloaded.view().activity), JSON.stringify(first.view().activity));
  assert.equal(JSON.stringify(activityOf(store.log(first.courseId).read())), JSON.stringify(first.view().activity), "pure over the records");
});

test("an event kind the table does not know is skipped, not an error", () => {
  const rows = activityOf([
    { seq: 1, event: { kind: "course.created", materials: [], at: 5 } },
    { seq: 2, event: { kind: "something.new", at: 6 } },
  ]);
  assert.deepEqual(rows.map((r) => r.seq), [1]);
});

test("the whole HTTP story (material in, decisions, plan, publish): the secret never appears in view.activity", async () => {
  const fakeModel = async (_url, init) => new Response(JSON.stringify(chatCompletion(JSON.parse(init.body))), { status: 200, headers: { "content-type": "application/json" } });
  const dir = mkdtempSync(join(tmpdir(), "silicus-activity-http-"));
  const noAsfai = { status: () => ({ connected: false }), runIntake: async () => { throw Object.assign(new Error("off"), { code: "OFF" }); }, validate: async () => null };
  const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: "http://127.0.0.1:9/v1/chat/completions", model: "m", fetchImpl: fakeModel }), sources: [], asfai: noAsfai });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const { transcript } = await runScriptedCourse(async (method, path, body) => {
      const r = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: r.status, json: await r.json() };
    });
    const views = transcript.filter((t) => t.method === "GET" && t.json?.activity);
    assert.ok(views.length > 0, "a course view carries activity");
    const activity = views.at(-1).json.activity;
    assert.ok(activity.some((r) => r.action === "objectives.drafted" && r.facts.materials === MATERIAL.name));
    for (const t of transcript) if (t.json?.activity) assert.equal(JSON.stringify(t.json.activity).includes(MATERIAL_SECRET), false);
  } finally {
    app.closeAllConnections?.();
    app.close();
  }
});
