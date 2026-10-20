/**
 * materials-rounds.test.mjs — R3 (sprint 2026-10-19): writing your own objectives never blocks proposing from
 * sources, and an explicit-mode course may take another material round once the earlier one is decided.
 *
 * Auto-mode courses keep the historical rule exactly (any earlier proposal round refuses ALREADY_PROPOSED), so the
 * change is additive: it lives only behind the per-course explicit mode (R4). Written by the orchestrator (silicus-ta)
 * at merge time, test-first; the lane A engineer stopped on R3 by the stop-signal rule and reported why.
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
const NOTES = { name: "growth-notes.txt", text: "Capital accumulates; saving raises the steady-state level.", chars: 56, digest: "sha256:test-notes" };

function reachObjectives(session, t0 = 1000) {
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: t0 });
  session.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: t0 + 500 });
  session.answerIntake({ text: "Topic: growth. Course: econ 101. Outcomes: explain the steady state.", at: t0 + 750 });
  session.observeIntake({ state: READY.state, at: t0 + 900 });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: t0 + 1000 });
}

/** A stand-in worker that records what it was asked and proposes the given statements from NOTES. */
function stubWorker(...rounds) {
  const calls = [];
  return {
    calls,
    async draftObjectives(input) {
      calls.push(input);
      const statements = rounds[Math.min(calls.length - 1, rounds.length - 1)];
      return statements.map((statement) => ({ statement, from: [NOTES.name] }));
    },
  };
}

const course = (mode, store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-rounds-")))) => {
  const s = CourseSession.create(store, {
    owner: OWNER, title: "econ 101", ...(mode ? { objectivesConfirm: mode } : {}),
  });
  reachObjectives(s);
  return s;
};
const pending = (s) => s.view().proposals.filter((r) => r.status === "proposed");

test("explicit: an objective you wrote first does not block proposing from sources, and the worker sees it", async () => {
  const s = course("explicit");
  s.decideObjectives({ decisions: [{ verb: "add", statement: "Students can explain the steady state." }], text: "Add my own.", at: 3000 });
  assert.equal(s.view().checkpoints.objectives.status, "open", "an explicit course is still open after an add");

  const w = stubWorker(["Students can derive the golden rule.", "Students can explain convergence."]);
  const r = await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 4000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(pending(s).length, 2);
  assert.ok(s.view().proposals.some((p) => p.statement === "Students can explain the steady state."), "the teacher's own objective is still there");
  assert.ok(w.calls[0].existing.some((e) => e.statement === "Students can explain the steady state." && e.by === "teacher"), "R2: the worker was told about the teacher's own objective");
});

test("explicit: a second material round is refused while the first waits, and allowed once it is decided", async () => {
  const s = course("explicit");
  const w = stubWorker(["Students can derive the golden rule."], ["Students can compare two saving rates."]);
  assert.equal((await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 3000 })).ok, true);

  const early = await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 3500 });
  assert.equal(early.ok, false);
  assert.equal(early.code, "ALREADY_PROPOSED", "a round still waiting refuses with the existing code");
  assert.equal(w.calls.length, 1, "and the worker was not called");

  const [p] = pending(s);
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p.id }], text: "Accept.", at: 4000 });
  const again = await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 5000 });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(pending(s).length, 1);
  assert.ok(w.calls[1].existing.some((e) => e.statement === "Students can derive the golden rule." && e.by === "accepted"), "the second round sees the accepted one");
});

test("explicit: after the teacher confirms the objectives, another material round is refused OBJECTIVES_CONFIRMED", async () => {
  const s = course("explicit");
  const w = stubWorker(["Students can derive the golden rule."]);
  await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 3000 });
  const [p] = pending(s);
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p.id }], text: "Accept.", at: 4000 });
  s.confirmObjectives({ text: "These are my objectives.", at: 4500 });
  const r = await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "OBJECTIVES_CONFIRMED");
  assert.equal(w.calls.length, 1);
});

test("explicit: the rounds survive a reload (replay is exact)", async () => {
  const store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-rounds-")));
  const s = course("explicit", store);
  const w = stubWorker(["Students can derive the golden rule."], ["Students can compare two saving rates."]);
  await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 3000 });
  const [p] = pending(s);
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p.id }], text: "Accept.", at: 4000 });
  assert.equal((await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 5000 })).ok, true, "the second round happened");
  assert.equal(s.view().proposals.length, 2);
  const before = JSON.stringify(s.view());
  const reloaded = CourseSession.load(store, s.courseId);
  assert.equal(JSON.stringify(reloaded.view()), before);
});

test("auto (historical): any earlier round still refuses ALREADY_PROPOSED, even when it is fully decided", async () => {
  const s = course(undefined);
  const w = stubWorker(["Students can derive the golden rule."], ["Students can compare two saving rates."]);
  await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 3000 });
  const [p] = pending(s);
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p.id }], text: "Accept.", at: 4000 });
  const r = await s.proposeObjectivesFromMaterials({ worker: w, materials: [NOTES], at: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "ALREADY_PROPOSED");
  assert.equal(w.calls.length, 1);
});
