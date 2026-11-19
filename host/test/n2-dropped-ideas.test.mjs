/**
 * N2 · L1 item 5: dropped ideas come back reworded. What the teacher dropped goes to the next proposal call as
 * "the teacher dropped these; do not propose them or close variants", on both the material path and the
 * suggestion path, through the shared CourseSession (so both hosts), and a verbatim repeat is filtered.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DROPPED_LEAD, PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";

const MOCKS = [];
after(() => MOCKS.forEach((m) => m.close()));
async function workerWith(reply) {
  const mock = await startMockWorker({ reply });
  MOCKS.push(mock);
  return { mock, worker: new PlanWorker({ url: mock.url, model: "test-model" }) };
}
const MATS = [{ name: "notes.txt", text: "The Moon orbits the Earth. Its lit half faces the Sun." }];

test("N2: the objectives prompt names the dropped ones, and a verbatim repeat of one is filtered", async () => {
  const { mock, worker } = await workerWith({ objectives: [
    { statement: "Students can name the eight Moon phases.", from: ["M1"] },
    { statement: "Students can explain why the lit half faces the Sun.", from: ["M1"] },
  ] });
  const out = await worker.draftObjectives({ materials: MATS, dropped: ["Students can name the eight Moon phases.", "  ", "Students can name the eight Moon phases."] });
  assert.deepEqual(out.map((o) => o.statement), ["Students can explain why the lit half faces the Sun."]);
  assert.ok(mock.st.lastPrompt.includes(`${DROPPED_LEAD}\n- Students can name the eight Moon phases.\n`), mock.st.lastPrompt);
  assert.equal(mock.st.lastPrompt.split("eight Moon phases").length - 1, 1, "deduplicated: listed once");
  assert.match(DROPPED_LEAD, /The teacher dropped these; do not propose them or close variants/);
});

test("N2: no dropped ones means no block", async () => {
  const { mock, worker } = await workerWith({ objectives: [{ statement: "Students can do y.", from: ["M1"] }] });
  await worker.draftObjectives({ materials: MATS });
  assert.equal(mock.st.lastPrompt.includes(DROPPED_LEAD), false);
});

test("N2: the suggestion prompt names the dropped ones as dropped, not as 'already listed'", async () => {
  const { mock, worker } = await workerWith({ objectives: [{ statement: "Students can draw the Moon at four points of its orbit." }] });
  await worker.suggestObjectives({ outcomes: ["Students can explain moon phases."], existing: ["Students can trace the orbit."], dropped: ["Students can recite the phase names."] });
  const p = mock.st.lastPrompt;
  assert.ok(p.includes(`${DROPPED_LEAD}\n- Students can recite the phase names.`), p);
  const listed = p.slice(p.indexOf("Already listed"), p.indexOf(DROPPED_LEAD));
  assert.equal(listed.includes("recite the phase names"), false, "a dropped one is not 'already listed'");
});

const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
function reachObjectives(s, t0 = 1000) {
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: t0 });
  s.observeIntake({ state: FX.clarifying.response.state, questions: FX.clarifying.response.questions, at: t0 + 100 });
  s.answerIntake({ text: "Topic: the Moon.", at: t0 + 200 });
  s.observeIntake({ state: FX.ready_to_draft.response.state, at: t0 + 300 });
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: t0 + 400 });
}

test("N2: through the course, a dropped proposal reaches the next material round and the suggestion round", async () => {
  const s = CourseSession.create(new CourseStore(mkdtempSync(join(tmpdir(), "silicus-n2-"))), { owner: "teacher-a", title: "Moon", objectivesConfirm: "explicit" });
  reachObjectives(s);
  // Suggestions round out the teacher's own words, so the teacher writes one first.
  s.decideObjectives({ decisions: [{ verb: "add", statement: "Students can explain why the Moon seems to change shape." }], text: "Add my own.", at: 1800 });
  const calls = [];
  const w = {
    async draftObjectives(input) { calls.push(["draft", input]); return calls.length === 1
      ? [{ statement: "Students can name the eight Moon phases.", from: ["notes.txt"] }, { statement: "Students can explain the lit half.", from: ["notes.txt"] }]
      : [{ statement: "Students can model the orbit with a lamp.", from: ["notes.txt"] }]; },
    async suggestObjectives(input) { calls.push(["suggest", input]); return ["Students can sketch tonight's Moon."]; },
  };
  assert.equal((await s.proposeObjectivesFromMaterials({ worker: w, materials: MATS, at: 2000 })).ok, true);
  const rows = s.view().proposals;
  const named = rows.find((r) => r.statement.includes("eight Moon phases"));
  const kept = rows.find((r) => r.statement.includes("lit half"));
  s.decideObjectives({ decisions: [{ verb: "drop", proposalId: named.id }, { verb: "accept", proposalId: kept.id }], text: "Drop one, keep one.", at: 3000 });
  assert.equal((await s.proposeObjectivesFromMaterials({ worker: w, materials: MATS, at: 4000 })).ok, true);
  assert.deepEqual(calls[1][1].dropped, ["Students can name the eight Moon phases."], "the second round is told what was dropped");
  assert.equal(calls[1][1].existing.some((e) => e.statement.includes("eight Moon phases")), false);
  const fresh = s.view().proposals.find((r) => r.status === "proposed");
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: fresh.id }], text: "Accept.", at: 4500 });
  const r = await s.suggestObjectives({ worker: w, at: 5000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const sug = calls.find((c) => c[0] === "suggest")[1];
  assert.deepEqual(sug.dropped, ["Students can name the eight Moon phases."]);
  assert.equal(sug.existing.includes("Students can name the eight Moon phases."), false, "a dropped one is passed as dropped, not as existing");
});
