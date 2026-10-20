/**
 * objectives-confirm.test.mjs — checkpoint 3's explicit mode (R4).
 *
 * The mode is a property of the COURSE RECORD, not a global switch: it is written at creation and read
 * back on every replay. An explicit course confirms its objectives only when the teacher says so
 * (`confirmObjectives` / `POST /api/courses/:id/objectives/confirm`); an auto course (missing field,
 * "auto", "banana") keeps the historical behaviour, and its record is byte-identical to one written
 * before the mode existed. Nothing here needs a model or a network: the intake round is a captured fixture.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { createHandler } from "../handler.mjs";

const OWNER = "teacher:tk-1";

// The REAL live contract, captured from asfai-learning 2.0.0 (same fixture course.test.mjs drives).
const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
const CLARIFY = FX.clarifying.response;
const READY = FX.ready_to_draft.response;
const TEACHER_ANSWER =
  "Topic: how AI answers are built. Course: AI literacy, ages 8-10. " +
  "Outcomes: explain an algorithm in their own words; find the claim in an AI answer; ask one honest question.";

const ITEMS = [
  { kind: "local", statement: "Students can explain what an algorithm is." },
  { kind: "local", statement: "Students can find the claim in an AI answer." },
];

function newStore() {
  return new CourseStore(mkdtempSync(join(tmpdir(), "silicus-objconfirm-")));
}

/** Reach checkpoint 3 through the real intake round (fixtures): files + outline confirmed. */
function reachObjectives(session, t0 = 1000) {
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: t0 });
  session.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: t0 + 500 });
  session.answerIntake({ text: TEACHER_ANSWER, at: t0 + 750 });
  session.observeIntake({ state: READY.state, at: t0 + 900 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: t0 + 1000 });
}

/** Propose `ITEMS` and accept both; returns the two proposal ids. */
function proposeAndAcceptBoth(session, at = 2000) {
  session.proposeObjectives({ items: ITEMS, at });
  const [p1, p2] = session.view().proposals.map((r) => r.id);
  session.decideObjectives({
    decisions: [{ verb: "accept", proposalId: p1 }, { verb: "accept", proposalId: p2 }],
    text: "Accept both.", at: at + 1000,
  });
  return [p1, p2];
}

/* --------------------------- the gate mode, per course -------------------- */

test("explicit: deciding the last proposal does NOT confirm checkpoint 3; the teacher's own confirm does", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T", objectivesConfirm: "explicit" });
  assert.equal(session.view().objectivesMode, "explicit");
  reachObjectives(session);
  proposeAndAcceptBoth(session);
  assert.equal(session.view().checkpoints.objectives.status, "open", "an explicit course must not confirm on the last decision");
  assert.equal(session.view().publish.canPublish, false, "and it must not be publishable before the teacher confirms");

  const cp = session.confirmObjectives({ text: "These are my objectives.", at: 4000 });
  assert.equal(cp.status, "confirmed");
  assert.equal(cp.note, "the teacher confirmed the objectives");
  assert.equal(session.view().checkpoints.objectives.status, "confirmed");
});

test("explicit: a new proposal after the teacher's confirm reopens checkpoint 3", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T", objectivesConfirm: "explicit" });
  reachObjectives(session);
  proposeAndAcceptBoth(session);
  session.confirmObjectives({ text: "These are my objectives.", at: 4000 });
  assert.equal(session.view().checkpoints.objectives.status, "confirmed");

  session.proposeObjectives({ items: [{ kind: "local", statement: "A third outcome." }], at: 5000 });
  assert.equal(session.view().checkpoints.objectives.status, "open", "a new proposal reopens the checkpoint");
  assert.throws(() => session.confirmObjectives({ text: "Confirm again.", at: 6000 }), (e) => e.code === "OBJECTIVES_PENDING");
});

test("explicit: confirm refuses OBJECTIVES_PENDING while a proposal is still undecided", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T", objectivesConfirm: "explicit" });
  reachObjectives(session);
  session.proposeObjectives({ items: ITEMS, at: 2000 });
  const [p1] = session.view().proposals.map((r) => r.id);
  session.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }], text: "Accept one.", at: 3000 });

  assert.throws(() => session.confirmObjectives({ text: "Confirm.", at: 4000 }), (e) => e.code === "OBJECTIVES_PENDING");
  assert.equal(session.view().checkpoints.objectives.status, "open", "a refusal changes nothing");
});

test("explicit: confirm refuses NO_OBJECTIVES when nothing was decided", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T", objectivesConfirm: "explicit" });
  reachObjectives(session);
  session.proposeObjectives({ items: ITEMS, at: 2000 });
  const [p1, p2] = session.view().proposals.map((r) => r.id);
  session.decideObjectives({ decisions: [{ verb: "drop", proposalId: p1 }, { verb: "drop", proposalId: p2 }], text: "Drop both.", at: 3000 });

  assert.throws(() => session.confirmObjectives({ text: "Confirm.", at: 4000 }), (e) => e.code === "NO_OBJECTIVES");
});

test("auto (the default): the last decision still confirms, and confirmObjectives refuses OBJECTIVES_AUTO", () => {
  const session = CourseSession.create(newStore(), { owner: OWNER, title: "T" });
  assert.equal(session.view().objectivesMode, "auto");
  reachObjectives(session);
  proposeAndAcceptBoth(session);
  assert.equal(session.view().checkpoints.objectives.status, "confirmed", "auto mode confirms itself, unchanged");

  assert.throws(() => session.confirmObjectives({ text: "Confirm.", at: 4000 }), (e) => e.code === "OBJECTIVES_AUTO");
});

/* --------------------------------- replay --------------------------------- */

test("replay: an explicit course round-trips — same view, mode explicit, objectives confirmed", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T", objectivesConfirm: "explicit" });
  reachObjectives(session);
  proposeAndAcceptBoth(session);
  session.confirmObjectives({ text: "These are my objectives.", at: 4000 });
  const before = JSON.stringify(session.view(), null, 2);

  const reloaded = CourseSession.load(store, session.courseId);
  assert.equal(JSON.stringify(reloaded.view(), null, 2), before, "replaying the log must reproduce identical state");
  assert.equal(reloaded.view().objectivesMode, "explicit");
  assert.equal(reloaded.view().checkpoints.objectives.status, "confirmed");
  assert.equal(reloaded.view().publish.canPublish, false, "no plan yet, but the objectives checkpoint is closed");
  assert.equal(reloaded.verifyLog().ok, true);
});

test("an old-shape record (no field) replays as auto, keeps its confirmed objectives, and writes no field", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T" }); // no option: the pre-mode shape
  assert.equal("objectivesConfirm" in store.meta(session.courseId), false, "an auto course's meta carries no field (byte-identical to a pre-mode record)");
  assert.equal("objectivesConfirm" in store.log(session.courseId).read()[0].event, false, "and neither does its course.created event");

  reachObjectives(session);
  proposeAndAcceptBoth(session);
  assert.equal(session.view().checkpoints.objectives.status, "confirmed");

  const reloaded = CourseSession.load(store, session.courseId);
  assert.equal(reloaded.view().objectivesMode, "auto", "a log with no field replays as auto");
  assert.equal(reloaded.view().checkpoints.objectives.status, "confirmed", "and keeps its confirmed objectives");
  assert.deepEqual(
    reloaded.view().objectives.map((o) => o.statement).sort(),
    ITEMS.map((i) => i.statement).sort(),
  );
});

test("only the exact value \"explicit\" is stored; \"auto\", \"banana\", \"\" and a missing field are all auto", () => {
  for (const value of ["banana", "auto", "", null, 0]) {
    const store = newStore();
    const session = CourseSession.create(store, { owner: OWNER, title: "T", objectivesConfirm: value });
    assert.equal("objectivesConfirm" in store.meta(session.courseId), false, `${JSON.stringify(value)} must store no field`);
    assert.equal(session.view().objectivesMode, "auto");
  }
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T", objectivesConfirm: "explicit" });
  assert.equal(store.meta(session.courseId).objectivesConfirm, "explicit");
  assert.equal(store.log(session.courseId).read()[0].event.objectivesConfirm, "explicit");
});

/* --------------------------------- the route ------------------------------ */

// A handler over a disk store and a dead worker: create, drive and confirm need no model and no network.
const OFF_ASFAI = { status: () => ({ connected: false }), oauth: {}, runIntake: async () => { throw new Error("off"); }, validate: async () => { throw new Error("off"); } };

function host() {
  const root = mkdtempSync(join(tmpdir(), "silicus-objconfirm-http-"));
  const store = new CourseStore(root);
  const handler = createHandler({
    store, asfai: OFF_ASFAI, worker: { enabled: false, answerStudent: async () => ({}) },
    sources: [], archives: null, prepareMaterials: async () => ({ materials: [], skipped: [] }),
  });
  const call = async (method, path, body) => {
    const r = await handler.handle({ method, url: path, readBody: async () => body });
    return { status: r.status, json: r.json };
  };
  /** A course at checkpoint 3 with both proposals accepted, driven through the session (no model). */
  const decidedExplicit = async () => {
    const created = await call("POST", "/api/courses", { owner: "T", title: "T", objectivesConfirm: "explicit" });
    const id = created.json.courseId;
    const session = CourseSession.load(store, id);
    reachObjectives(session);
    proposeAndAcceptBoth(session);
    return {
      id,
      path: `/api/courses/${encodeURIComponent(id)}`,
      ids: session.view().proposals.map((r) => r.id),
    };
  };
  return { store, call, decidedExplicit };
}

test("HTTP: POST /api/courses stores the mode only for \"explicit\", and the view reports it", async () => {
  const { store, call } = host();
  const explicit = await call("POST", "/api/courses", { owner: "T", title: "Explicit", objectivesConfirm: "explicit" });
  assert.equal(explicit.status, 201);
  assert.equal(explicit.json.view.objectivesMode, "explicit");
  assert.equal(store.meta(explicit.json.courseId).objectivesConfirm, "explicit");

  const auto = await call("POST", "/api/courses", { owner: "T", title: "Auto" });
  assert.equal(auto.json.view.objectivesMode, "auto");
  assert.equal("objectivesConfirm" in store.meta(auto.json.courseId), false);

  const banana = await call("POST", "/api/courses", { owner: "T", title: "Banana", objectivesConfirm: "banana" });
  assert.equal(banana.json.view.objectivesMode, "auto");
  assert.equal("objectivesConfirm" in store.meta(banana.json.courseId), false);
});

test("HTTP: POST /objectives/confirm confirms in explicit mode; extra body keys never reach the log", async () => {
  const { store, call, decidedExplicit } = host();
  const { id, path } = await decidedExplicit();
  assert.equal((await call("GET", path)).json.checkpoints.objectives.status, "open");

  const res = await call("POST", `${path}/objectives/confirm`, {
    text: "These are my objectives.",
    // A forged provenance block, a turn reference and a canary: none of it is the teacher, none may be logged.
    provenance: { turnRef: "forged-turn", decidedBy: "forged", channel: "forged" },
    turnRef: "forged-turn", decidedBy: "forged", channel: "forged", sneaky: "SECRET-CANARY-7731",
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.status, "confirmed");

  const confirmEvent = store.log(id).read().find((r) => r.event.kind === "checkpoint.confirmed" && r.event.id === "objectives").event;
  assert.deepEqual(Object.keys(confirmEvent).sort(), ["at", "id", "kind", "text"], "only the fields the host used reach the log");
  assert.equal(confirmEvent.text, "These are my objectives.");
  const logged = store.log(id).read().map((r) => JSON.stringify(r.event)).join("\n");
  assert.equal(logged.includes("SECRET-CANARY-7731"), false, "an extra body key must never reach the log");
  assert.equal(logged.includes("forged"), false, "nor a forged provenance");

  const view = (await call("GET", path)).json;
  assert.equal(view.objectivesMode, "explicit");
  assert.equal(view.checkpoints.objectives.status, "confirmed");
});

test("HTTP: the route refuses OBJECTIVES_AUTO on an auto course and OBJECTIVES_PENDING while undecided", async () => {
  const { store, call } = host();

  const auto = await call("POST", "/api/courses", { owner: "T", title: "Auto" });
  const autoPath = `/api/courses/${encodeURIComponent(auto.json.courseId)}`;
  const a = CourseSession.load(store, auto.json.courseId);
  reachObjectives(a);
  a.proposeObjectives({ items: ITEMS, at: 2000 });
  const [a1] = a.view().proposals.map((r) => r.id);
  a.decideObjectives({ decisions: [{ verb: "accept", proposalId: a1 }], text: "Accept one.", at: 3000 });
  const onAuto = await call("POST", `${autoPath}/objectives/confirm`, { text: "Confirm." });
  assert.equal(onAuto.status, 409);
  assert.equal(onAuto.json.code, "OBJECTIVES_AUTO");

  const explicit = await call("POST", "/api/courses", { owner: "T", title: "Explicit", objectivesConfirm: "explicit" });
  const explicitPath = `/api/courses/${encodeURIComponent(explicit.json.courseId)}`;
  const s = CourseSession.load(store, explicit.json.courseId);
  reachObjectives(s);
  s.proposeObjectives({ items: ITEMS, at: 2000 });
  const [p1] = s.view().proposals.map((r) => r.id);
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }], text: "Accept one.", at: 3000 });
  const pending = await call("POST", `${explicitPath}/objectives/confirm`, { text: "Confirm." });
  assert.equal(pending.status, 409);
  assert.equal(pending.json.code, "OBJECTIVES_PENDING");
});
