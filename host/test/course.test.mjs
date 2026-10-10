/**
 * course.test.mjs — the host session: flow, restart-by-replay, tamper detection,
 * and the structural anti-fabrication property.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";

const OWNER = "teacher:tk-1";

// The REAL live contract, captured from asfai-learning 2.0.0. Checkpoint 2 is
// bound to it: the clarifying round issues no receipt, ready_to_draft carries no
// draftAuthorization, so authorization is the OBSERVED outcome plus a teacher turn.
const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
const CLARIFY = FX.clarifying.response;
const READY = FX.ready_to_draft.response;
const TEACHER_ANSWER =
  "Topic: how AI answers are built. Course: AI literacy, ages 8-10. " +
  "Outcomes: explain an algorithm in their own words; find the claim in an AI answer; ask one honest question.";

function newStore() {
  return new CourseStore(mkdtempSync(join(tmpdir(), "silicus-host-test-")));
}

const ITEMS = [
  { kind: "local", statement: "Students can explain what an algorithm is." },
  { kind: "public", publicId: "mt_alpha", statement: "Learners can find the claim in an AI answer." },
];
const RENAME = "Learners can find the claim in an AI answer and name what evidence would back it up.";
const ADD = "Students can ask one honest question about how an AI tool works.";
const planSpec = (p1, p2, addedId) => ({
  title: "Seeing the claim: how AI answers are built",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    { title: "Spotting the claim", minutes: 20, objectiveIds: [p1, p2],
      learnerDoes: "Mark the sentence that makes a claim.", teacherDoes: "Ask what would back it up.",
      evidenceIfAny: "observation" },
    { title: "Ask one honest question", minutes: 20, objectiveIds: [addedId],
      learnerDoes: "Write one question.", teacherDoes: "Collect the questions.",
      evidenceIfAny: "work-product" },
  ],
});

/** Drive the whole one-teacher flow at fixed timestamps. Returns useful ids. */
function drive(session, t0 = 1000) {
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: t0 });
  // Checkpoint 2 needs the real intake round: the runtime reports what the MCP
  // returned, the teacher answers, then the intake is authorized.
  session.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: t0 + 500 });
  session.answerIntake({ text: TEACHER_ANSWER, at: t0 + 750 });
  session.observeIntake({ state: READY.state, at: t0 + 900 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: t0 + 1000 });
  session.proposeObjectives({ items: ITEMS, sources: ["from your slides p.4", "suggested match"],
    assistantText: "Proposed 2 objectives.", at: t0 + 2000 });
  const [p1, p2] = session.view().proposals.map((r) => r.id);
  session.decideObjectives({
    decisions: [
      { verb: "accept", proposalId: p1 },
      { verb: "rename", proposalId: p2, statement: RENAME },
      { verb: "add", statement: ADD },
    ],
    text: "Decide the proposals.", at: t0 + 3000,
  });
  const addedId = session.view().decisions.find((d) => d.verb === "add").targetId;
  session.proposeLessonPlan({ spec: planSpec(p1, p2, addedId), assistantText: "Drafted a plan.", at: t0 + 4000 });
  session.confirmLessonPlan({ text: "Confirm the lesson plan.", at: t0 + 5000 });
  session.publish({ text: "Publish the course package.", note: "first version", at: t0 + 6000 });
  return { p1, p2, addedId };
}

test("create -> confirm -> propose -> decide -> plan -> publish", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "Lesson 3 | AI literacy" });
  const ids = drive(session);
  const v = session.view();

  assert.equal(v.checkpoints.files.status, "confirmed");
  assert.equal(v.checkpoints.outline.status, "confirmed");
  assert.equal(v.checkpoints.objectives.status, "confirmed");
  assert.equal(v.checkpoints.plan.status, "confirmed");
  assert.equal(v.checkpoints.publish.status, "confirmed");
  assert.equal(v.proposals.length, 3, "2 AI proposals + 1 teacher-added objective");
  assert.deepEqual(v.proposals.map((r) => r.status), ["accepted", "renamed", "added"]);
  assert.equal(v.versions.length, 1);
  assert.equal(v.versions[0].version, 1);
  assert.deepEqual(v.versions[0].objectiveRefs.map((o) => o.id).sort(), [ids.p1, ids.p2, ids.addedId].sort());
  assert.equal(v.publish.canPublish, true);
  assert.equal(v.integrity.events, 11, "course.created + files + 3 intake + outline + 5 later events");
});

test("restart: a fresh session rebuilt from the event log is identical", () => {
  const store = newStore();
  const first = CourseSession.create(store, { owner: OWNER, title: "Lesson 3 | AI literacy" });
  drive(first);
  const before = JSON.stringify(first.view(), null, 2);

  // A NEW process/host would do exactly this: read the log and replay it.
  const reloaded = CourseSession.load(store, first.courseId);
  const after = JSON.stringify(reloaded.view(), null, 2);

  assert.equal(after, before, "replaying the log must reproduce identical state");
  assert.equal(reloaded.view().publish.canPublish, true);
  assert.equal(reloaded.verifyLog().ok, true);
});

test("the log is hash-chained: tampering with a past event is detected", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T" });
  drive(session);
  assert.equal(session.verifyLog().ok, true);

  const p = join(store.root, session.courseId.replace(/[^A-Za-z0-9._-]/g, "_"), "events.ndjson");
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  lines[1].event.text = "a decision the teacher never made";  // forge record 1's message
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const ver = store.log(session.courseId).verify();
  assert.equal(ver.ok, false);
  assert.match(ver.reason, /digest mismatch at record 2/);
});

test("the public API takes intents, never provenance; recorded decisions cite the host's own turn", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T" });
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  session.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 1500 });
  session.answerIntake({ text: TEACHER_ANSWER, at: 1700 });
  session.observeIntake({ state: READY.state, at: 1900 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 2000 });
  session.proposeObjectives({ items: ITEMS, at: 3000 });
  const [p1] = session.view().proposals.map((r) => r.id);

  // A caller tries to hand in fabricated provenance. The API has no such field,
  // so it is ignored — the host records its own turn and cites that.
  session.decideObjectives({
    decisions: [{ verb: "accept", proposalId: p1 }],
    text: "Accept the first objective.",
    at: 4000,
    provenance: { turnRef: "urn:turn:999", decidedBy: OWNER, channel: "silicus-ui", decidedAt: 1 },
  });

  const decision = session.view().decisions[0];
  assert.notEqual(decision.provenance.turnRef, "urn:turn:999");
  const turn = session.turn(decision.provenance.turnRef);
  assert.equal(turn.role, "teacher");
  assert.equal(turn.actorId, OWNER);
  assert.equal(turn.text, "Accept the first objective.");
  assert.equal(turn.origin, "inbound-user-message");
  assert.ok(session.isTeacherTurn(decision.provenance.turnRef));
  // And no assistant turn can ever satisfy a confirmation.
  assert.equal(session.turns().some((t) => t.role === "assistant" && t.text === turn.text), false);
});

test("publish is blocked until the plan is confirmed", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T" });
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  session.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 1500 });
  session.answerIntake({ text: TEACHER_ANSWER, at: 1700 });
  session.observeIntake({ state: READY.state, at: 1900 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 2000 });
  session.proposeObjectives({ items: ITEMS, at: 3000 });
  const [p1, p2] = session.view().proposals.map((r) => r.id);
  session.decideObjectives({ decisions: [
    { verb: "accept", proposalId: p1 }, { verb: "accept", proposalId: p2 },
  ], text: "Accept both.", at: 4000 });
  session.proposeLessonPlan({ spec: planSpec(p1, p2, p1), at: 5000 });

  assert.throws(
    () => session.publish({ text: "Publish the course package.", at: 6000 }),
    (e) => e.name === "PublishBlockedError" && /no teacher-confirmed lesson plan/.test(e.message),
  );
  session.confirmLessonPlan({ text: "Confirm the lesson plan.", at: 7000 });
  const v = session.publish({ text: "Publish the course package.", at: 8000 });
  assert.equal(v.version, 1);
});

test("a tampered event log is REFUSED at load (fail closed)", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T" });
  drive(session);
  const p = join(store.root, session.courseId.replace(/[^A-Za-z0-9._-]/g, "_"), "events.ndjson");
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  lines[1].event.text = "TAMPERED: I confirmed nothing of the sort";
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  assert.throws(() => CourseSession.load(store, session.courseId), (e) => e.code === "LOG_INTEGRITY");
});

test("the ledger object is not reachable, so a caller cannot mint a teacher turn", () => {
  const store = newStore();
  const session = CourseSession.create(store, { owner: OWNER, title: "T" });
  // A red-team pass minted a TeacherChannel off session.ledger and published a
  // package with zero real teacher messages. The getters are gone.
  assert.equal(session.ledger, undefined);
  assert.equal(session.gate, undefined);

  drive(session);
  const first = session.view().decisions[0];
  assert.equal(session.turn(first.provenance.turnRef).role, "teacher");
  assert.ok(session.isTeacherTurn(first.provenance.turnRef));
  assert.ok(session.turns().some((t) => t.role === "assistant"));
});
