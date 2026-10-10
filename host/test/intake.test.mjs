/**
 * intake.test.mjs — checkpoint 2's host-side gate against the REAL captured contract.
 *
 * The contract finding these tests pin down: asfai-learning 2.0.0 returns
 * `clarifying` with NO clarificationReceipt and `ready_to_draft` with NO
 * draftAuthorization. Binding checkpoint 2 to a server token would make the flow
 * permanently unconfirmable, so it binds to the OBSERVED outcome plus a real
 * teacher turn — and reporting `ready_to_draft` without that answer must not
 * authorize anything.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";

const OWNER = "teacher:tk-1";
const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
const CLARIFY = FX.clarifying.response;
const READY = FX.ready_to_draft.response;
const ANSWER = "Topic: how AI answers are built. Course: AI literacy, ages 8-10. Outcomes: explain an algorithm; find the claim; ask one honest question.";

const newStore = () => new CourseStore(mkdtempSync(join(tmpdir(), "silicus-intake-")));
const sessionWithFiles = () => {
  const s = CourseSession.create(newStore(), { owner: OWNER, title: "T" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  return s;
};

test("the captured fixtures are the live contract: no receipt, no draftAuthorization", () => {
  assert.equal(CLARIFY.state, "clarifying");
  assert.deepEqual(CLARIFY.questions.map((q) => q.id), ["topic", "course", "learning_outcomes"]);
  assert.equal(CLARIFY.clarificationReceipt, undefined, "the clarifying round issues no receipt");
  assert.equal(READY.state, "ready_to_draft");
  assert.equal(READY.draftAuthorization, undefined, "ready_to_draft carries no draftAuthorization");
});

test("checkpoint 2 refuses until the intake is authorized", () => {
  const s = sessionWithFiles();
  const st = s.intakeStatus();
  assert.equal(st.observedState, null);
  assert.equal(st.outlineAuthorized, false);
  assert.throws(
    () => s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 2000 }),
    (e) => e.code === "MISSING_DRAFT_AUTHORIZATION",
  );
});

test("BYSS: reporting ready_to_draft with no teacher answer does NOT authorize checkpoint 2", () => {
  const s = sessionWithFiles();
  s.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 2000 });
  // The bypass the residual rule exists to block: claim the round finished.
  s.observeIntake({ state: READY.state, at: 3000 });

  const st = s.intakeStatus();
  assert.equal(st.roundOpened, true);
  assert.equal(st.roundAnswered, false);
  assert.equal(st.outlineAuthorized, false, "an unanswered round must not authorize the outline");
  assert.equal(st.mayCallPrepareOutline, false);
  assert.equal(st.refusal.code, "AWAITING_TEACHER_REPLY");
  assert.throws(
    () => s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 4000 }),
    (e) => e.code === "MISSING_DRAFT_AUTHORIZATION",
  );
});

test("the real round (clarifying -> teacher answer -> ready_to_draft) authorizes checkpoint 2", () => {
  const s = sessionWithFiles();
  s.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 2000 });
  assert.equal(s.intakeStatus().mayCallPrepareOutline, false, "no second call before the teacher answers");

  s.answerIntake({ text: ANSWER, at: 3000 });
  assert.equal(s.intakeStatus().mayCallPrepareOutline, true, "the answer arms the round");
  assert.equal(s.intakeStatus().outlineAuthorized, false, "armed is not yet authorized");

  s.observeIntake({ state: READY.state, at: 4000 });
  const st = s.intakeStatus();
  assert.equal(st.outlineAuthorized, true);
  assert.equal(st.roundAnswered, true);
  const cp = s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 5000 });
  assert.equal(cp.status, "confirmed");
});

test("a teacher can state everything upfront: a direct ready_to_draft needs no answer", () => {
  const s = sessionWithFiles();
  s.observeIntake({ state: READY.state, at: 2000 });
  assert.equal(s.intakeStatus().outlineAuthorized, true);
  assert.equal(s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 3000 }).status, "confirmed");
});

test("a draftAuthorization, when a server does emit one, authorizes on its own", () => {
  const s = sessionWithFiles();
  s.observeIntake({ state: READY.state, draftAuthorization: "draft-auth:demo", at: 2000 });
  const st = s.intakeStatus();
  assert.equal(st.draftAuthorization, true);
  assert.equal(st.outlineAuthorized, true);
});

test("the intake survives a restart (it is part of the log)", () => {
  const store = newStore();
  const s = CourseSession.create(store, { owner: OWNER, title: "T" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  s.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 2000 });
  s.answerIntake({ text: ANSWER, at: 3000 });
  s.observeIntake({ state: READY.state, at: 4000 });
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 5000 });

  const reloaded = CourseSession.load(store, s.courseId);
  assert.equal(reloaded.intakeStatus().roundAnswered, true);
  assert.equal(reloaded.intakeStatus().outlineAuthorized, true);
  assert.equal(reloaded.view().checkpoints.outline.status, "confirmed");
});
