/**
 * g2-course.test.mjs — the structured course record (G2a), over HTTP and in the session.
 *
 * The host accepts `ages: {min, max}` (whole years 3..99, min <= max) and an optional
 * `marbleAnchor` (an mt_* id that exists in the pinned snapshot) at creation. They ride the
 * course.created event exactly like objectivesConfirm; bad values are a 400 with a plain
 * message; legacy courses (no ages) keep working and their view carries no ages/stage/anchor.
 * The anchor is a POINTER, never an identity: it must not appear in a sealed package's
 * objective list.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { createMarbleService } from "../marble/marble-graph.mjs";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";

const SNAPSHOT = new URL("../data/marble/marble-snapshot.json", import.meta.url).pathname;
const ANCHOR = "mt_AzTrT5ySCx"; // AI in Daily Life — Computing / Artificial Intelligence
const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

const marble = createMarbleService(async () => readFileSync(SNAPSHOT, "utf8"));

async function boot({ withMarble = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "silicus-g2a-course-"));
  const app = createApp({ dataDir: dir, sources: [], marble: withMarble ? marble : null });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const req = async (path, opts = {}) => {
    const r = await fetch(base + path, opts);
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, ...(ct.includes("json") ? { json: await r.json() } : {}) };
  };
  const post = (p, body) => req(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const get = (p) => req(p);
  return { get, post, dir };
}

const created = (dir) => {
  const dirs = readdirSync(dir).filter((n) => n !== "archives");
  assert.equal(dirs.length, 1, "exactly one course was written");
  const log = readFileSync(join(dir, dirs[0], "events.ndjson"), "utf8").split("\n").filter(Boolean);
  return JSON.parse(log[0]).event; // the course.created event (the chain record wraps it in {seq, prev, digest, event})
};

test("creation stores ages and the anchor on course.created, and the view derives the stage", async () => {
  const { get, post, dir } = await boot();
  const r = await post("/api/courses", { owner: "teacher:t", title: "AI in daily life", ages: { min: 8, max: 10 }, marbleAnchor: ANCHOR });
  assert.equal(r.status, 201);
  const view = r.json.view;
  assert.deepEqual(view.course.ages, { min: 8, max: 10 });
  assert.equal(view.course.marbleAnchor, ANCHOR);
  assert.equal(view.course.stage, 2, "youngest age 8 -> stage 2 (8-11)");
  assert.equal(view.integrity.events, 1);

  const event = created(dir);
  assert.equal(event.kind, "course.created");
  assert.deepEqual(event.ages, { min: 8, max: 10 });
  assert.equal(event.marbleAnchor, ANCHOR);
  assert.equal(event.objectivesConfirm, undefined, "no objectivesConfirm field is invented");

  // the view serves the same record after a replay from the log (a fresh session)
  const again = CourseSession.load(new CourseStore(dir), view.course.courseId).view();
  assert.deepEqual(again.course.ages, { min: 8, max: 10 });
  assert.equal(again.course.stage, 2);
  assert.equal(again.course.marbleAnchor, ANCHOR);
});

test("a legacy course without ages keeps working and its view carries no ages/stage/anchor", async () => {
  const { get, post, dir } = await boot();
  const r = await post("/api/courses", { owner: "teacher:t", title: "Old course" });
  assert.equal(r.status, 201);
  const view = r.json.view;
  assert.equal("ages" in view.course, false);
  assert.equal("stage" in view.course, false);
  assert.equal("marbleAnchor" in view.course, false);
  assert.equal(view.objectivesMode, "auto");

  const event = created(dir);
  assert.deepEqual(Object.keys(event).sort(), ["at", "courseId", "description", "kind", "materials", "owner", "seed", "title"],
    "a legacy course.created event is byte-identical in shape to a pre-G2a record");

  // it still drafts and publishes like any course (spell-checked by the view shape alone is not enough)
  const s = CourseSession.load(new CourseStore(dir), view.course.courseId);
  assert.equal(s.view().course.title, "Old course");
});

test("bad ages are a 400 with a plain message; the anchor is checked against the snapshot", async () => {
  const { post } = await boot();
  const bad = [
    { ages: { min: 10, max: 8 } },          // min older than max
    { ages: { min: 2, max: 10 } },          // below 3
    { ages: { min: 8, max: 100 } },         // above 99
    { ages: { min: 8 } },                   // missing max
    { ages: { min: 8.5, max: 10 } },        // not a whole year
    { ages: "8-10" },                       // not an object at all (free text must stay free text)
    { ages: [8, 10] },
  ];
  for (const ages of bad) {
    const r = await post("/api/courses", { owner: "teacher:t", title: "T", ages });
    assert.equal(r.status, 400, JSON.stringify(ages));
    assert.equal(r.json.code, "BAD_AGES");
    assert.equal(typeof r.json.message, "string");
    assert.equal(r.json.message.length > 0, true);
  }
  // the anchor must be an mt_* id that exists in the snapshot
  const notMt = await post("/api/courses", { owner: "teacher:t", title: "T", ages: { min: 8, max: 10 }, marbleAnchor: "urn:uuid:abc" });
  assert.equal(notMt.status, 400);
  assert.equal(notMt.json.code, "BAD_ANCHOR");
  const ghost = await post("/api/courses", { owner: "teacher:t", title: "T", ages: { min: 8, max: 10 }, marbleAnchor: "mt_GHOST" });
  assert.equal(ghost.status, 400);
  assert.equal(ghost.json.code, "UNKNOWN_ANCHOR");
  // HV C1 (merge gate): an anchor whose ages do not overlap the course's, and a non-string
  // marbleAnchor, are both a 400 with code BAD_ANCHOR (the anchor stays a pointer to what fits).
  const noOverlap = await post("/api/courses", { owner: "teacher:t", title: "T", ages: { min: 19, max: 22 }, marbleAnchor: ANCHOR });
  assert.equal(noOverlap.status, 400, `19-22 with the 5-12 anchor: ${JSON.stringify(noOverlap.json)}`);
  assert.equal(noOverlap.json.code, "BAD_ANCHOR");
  const numericAnchor = await post("/api/courses", { owner: "teacher:t", title: "T", ages: { min: 8, max: 10 }, marbleAnchor: 123 });
  assert.equal(numericAnchor.status, 400, `marbleAnchor: 123: ${JSON.stringify(numericAnchor.json)}`);
  assert.equal(numericAnchor.json.code, "BAD_ANCHOR");
  // missing ages + missing anchor is still a legacy course, not a refusal
  const plain = await post("/api/courses", { owner: "teacher:t", title: "T" });
  assert.equal(plain.status, 201);
});

test("an anchor cannot be accepted when the Marble graph is not wired (fail closed)", async () => {
  const { post } = await boot({ withMarble: false });
  const r = await post("/api/courses", { owner: "teacher:t", title: "T", ages: { min: 8, max: 10 }, marbleAnchor: ANCHOR });
  assert.equal(r.status, 501);
  assert.equal(r.json.code, "MARBLE_NOT_CONFIGURED");
});

/** Drive the one-teacher flow to a published version (course.test.mjs's drive, in miniature). */
function drive(s, t0 = 1000) {
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: t0 });
  s.observeIntake({ state: "clarifying", questions: [{ id: "q1" }], at: t0 + 500 });
  s.answerIntake({ text: "Topic: AI. Course: AI literacy.", at: t0 + 750 });
  s.observeIntake({ state: "ready_to_draft", at: t0 + 900 });
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: t0 + 1000 });
  s.proposeObjectives({
    items: [{ kind: "local", statement: "Students can spot AI in daily life." }],
    sources: ["from the slides"], at: t0 + 2000,
  });
  const [p1] = s.view().proposals.map((p) => p.id);
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }], text: "Accept.", at: t0 + 3000 });
  s.proposeLessonPlan({
    spec: { title: "Spotting AI", audience: { ageRangeStart: 8, ageRangeEnd: 10 }, activities: [{ title: "Spot", minutes: 20, objectiveIds: [p1], learnerDoes: "Look around.", teacherDoes: "Ask.", evidenceIfAny: "observation" }] },
    assistantText: "Drafted.", at: t0 + 4000,
  });
  s.confirmLessonPlan({ text: "Confirm the plan.", at: t0 + 5000 });
  s.publish({ text: "Publish.", at: t0 + 6000 });
  return p1;
}

test("the anchor is a pointer, not an identity: the sealed package's objective list carries no mt_", () => {
  const store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-g2a-seal-")));
  const s = CourseSession.create(store, { owner: "teacher:t", title: "AI", ages: { min: 8, max: 10 }, marbleAnchor: ANCHOR });
  drive(s);
  const v = s.view();
  assert.equal(v.versions.length, 1);
  const objectiveIds = v.versions[0].objectiveRefs.map((o) => o.id);
  assert.ok(objectiveIds.length > 0, "the anchored course really has objectives");
  assert.equal(objectiveIds.some((id) => /^mt_/.test(id)), false, `no mt_ id in objectives: ${objectiveIds.join(", ")}`);
  assert.match(objectiveIds[0], /^urn:uuid:/, "objective identity is the local URN, as the lock requires");
  // the anchor survives on the record and the view, distinctly from the objectives
  assert.equal(s.view().course.marbleAnchor, ANCHOR);
  assert.ok(v.versions[0].objectiveRefs[0].statement.length > 0, "the sealed objective keeps its statement");
});

test("a legacy course without ages still drives and seals the same way", () => {
  const store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-g2a-legacy-")));
  const s = CourseSession.create(store, { owner: "teacher:t", title: "Old" });
  drive(s);
  const v = s.view();
  assert.equal(v.versions.length, 1);
  assert.equal(v.versions[0].objectiveRefs.every((o) => !/^mt_/.test(o.id)), true);
  // replay reproduces the same view (legacy records stay replayable)
  const reloaded = CourseSession.load(store, s.courseId);
  assert.equal(JSON.stringify(reloaded.view()), JSON.stringify(v));
});
