/**
 * derive-objectives.test.mjs — checkpoint 3's real path.
 *
 * The property: the host proposes the teacher's OWN sentences back to them, and
 * with nothing of the teacher's on record it refuses rather than inventing. This
 * is the seam that replaces the hardcoded demo seed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { ANSWERS } from "./asfai-fixture.mjs";

const OWNER = "teacher:tk-1";
const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
const CLARIFY = FX.clarifying.response;
const READY = FX.ready_to_draft.response;

const newStore = () => new CourseStore(mkdtempSync(join(tmpdir(), "silicus-derive-")));

/** Drive to the objectives checkpoint. `answers` omitted means the teacher never answered. */
function sessionAtObjectives(store = newStore(), { answers = ANSWERS, t0 = 1000 } = {}) {
  const s = CourseSession.create(store, { owner: OWNER, title: "T" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: t0 });
  s.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: t0 + 500 });
  s.answerIntake({ text: "here are my answers", ...(answers ? { answers } : {}), at: t0 + 750 });
  s.observeIntake({ state: READY.state, at: t0 + 900 });
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: t0 + 1000 });
  return s;
}

test("the host derives objectives from the teacher's recorded answers, not from the caller", () => {
  const s = sessionAtObjectives();
  const r = s.proposeObjectivesFromAnswers({ at: 3000 });

  assert.equal(r.ok, true);
  assert.equal(r.proposals.length, 2);
  assert.deepEqual(r.proposals.map((p) => p.statement), ANSWERS.learning_outcomes);
  assert.ok(r.proposals.every((p) => p.kind === "local"));
  assert.ok(r.proposals.every((p) => p.id.startsWith("urn:uuid:")));
  assert.equal(JSON.stringify(r.proposals).includes("mt_"), false, "no Marble id anywhere");
  assert.ok(r.proposals.every((p) => p.source === "from your answer to ASFAI"));
  assert.ok(r.proposals.every((p) => p.status === "proposed"), "a proposal is never pre-confirmed");
  assert.ok(r.proposals.every((p) => p.by === "ai"));
});

test("with nothing of the teacher's on record, the host refuses instead of inventing", () => {
  const s = sessionAtObjectives(newStore(), { answers: null });
  const r = s.proposeObjectivesFromAnswers({ at: 3000 });

  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_TEACHER_OUTCOMES");
  assert.equal(s.view().proposals.length, 0, "nothing was proposed");
  assert.equal(s.view().checkpoints.objectives.status, "pending", "the checkpoint did not move");
});

test("a second derive does not duplicate the teacher's objectives", () => {
  const s = sessionAtObjectives();
  s.proposeObjectivesFromAnswers({ at: 3000 });
  const again = s.proposeObjectivesFromAnswers({ at: 3100 });

  assert.equal(again.ok, false);
  assert.equal(again.code, "ALREADY_PROPOSED");
  assert.equal(s.view().proposals.length, 2, "still exactly the teacher's two sentences");
});

test("a derived proposal survives a restart with the same ids and wording", () => {
  const store = newStore();
  const s = sessionAtObjectives(store);
  const before = s.proposeObjectivesFromAnswers({ at: 3000 }).proposals;

  const reloaded = CourseSession.load(store, s.courseId);
  const after = reloaded.view().proposals;

  assert.deepEqual(after.map((p) => p.id), before.map((p) => p.id));
  assert.deepEqual(after.map((p) => p.statement), ANSWERS.learning_outcomes);
  assert.deepEqual(after.map((p) => p.source), before.map((p) => p.source));
});

test("a derived proposal records NO assistant turn — the system quoted, it did not author", () => {
  const s = sessionAtObjectives();
  const before = s.turns().filter((t) => t.role === "assistant").length;
  s.proposeObjectivesFromAnswers({ at: 3000 });
  const after = s.turns().filter((t) => t.role === "assistant").length;

  assert.equal(after, before, "no assistant turn was fabricated for a derived proposal");
});

test("the teacher still decides: a derived proposal is not a confirmed objective", () => {
  const s = sessionAtObjectives();
  const r = s.proposeObjectivesFromAnswers({ at: 3000 });
  const [p1, p2] = r.proposals.map((p) => p.id);

  assert.equal(s.view().objectives.length, 0, "nothing is confirmed until the teacher decides");
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }], text: "Accept it.", at: 4000 });
  assert.deepEqual(s.view().objectives.map((o) => o.id), [p1]);

  // and the second one is still awaiting a decision
  assert.equal(s.view().proposals.find((p) => p.id === p2).status, "proposed");
});

test("a locally-answered course does not claim ASFAI as the source", () => {
  // No observeIntake anywhere: the teacher answers the host's own questions.
  const s = CourseSession.create(newStore(), { owner: OWNER, title: "T" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  s.answerIntake({ text: "my answers", answers: ANSWERS, at: 2000 });
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 3000 });
  const r = s.proposeObjectivesFromAnswers({ at: 4000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.proposals.map((p) => p.statement), ANSWERS.learning_outcomes);
  assert.ok(r.proposals.every((p) => p.source === "from your answer"), "nothing left the machine, so nothing says it did");
});

test("the source label is frozen at proposal time: a later ASFAI consult does not rewrite it", () => {
  const store = newStore();
  const s = CourseSession.create(store, { owner: OWNER, title: "T" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  s.answerIntake({ text: "my answers", answers: ANSWERS, at: 2000 });
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 3000 });
  s.proposeObjectivesFromAnswers({ at: 4000 });
  s.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 5000 });
  const again = CourseSession.load(store, s.courseId).view().proposals;
  assert.ok(again.every((p) => p.source === "from your answer"));
});
