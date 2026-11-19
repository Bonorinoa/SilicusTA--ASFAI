/**
 * n1-typed-objectives.test.mjs — N1 item 1 (L1 finding 1): objectives the teacher TYPES in the wizard ("One per
 * line. Each becomes a proposal you accept, edit or drop.") must reach the objectives page as the teacher's own
 * proposals. The live walk lost them: with "propose from my sources" ticked, the source round ran first, and the
 * derive route then refused (ALREADY_PROPOSED), so the lines stayed only in the brief's answers.
 *
 * The round trip is the wizard's own intent sequence over HTTP (create explicit → answers → files → outline), then
 * either the source round (sources ticked) or the derive (no sources). The browser host runs the same
 * host/handler.mjs + host/course.mjs, so this pins both hosts.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { createApp } from "../server.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

const MINE = ["Students can say why the Moon seems to change shape.", "Students can order the phases on a card strip."];
const FROM_SOURCE = "Students can show where the Sun, Earth and Moon are at full moon.";

async function boot({ worker = true, status = 200 } = {}) {
  const wm = await startMockWorker({ status, reply: () => ({ objectives: [{ statement: FROM_SOURCE, from: ["M1"] }] }) });
  CLOSERS.push(() => wm.close());
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "silicus-n1-")), worker: worker ? new PlanWorker({ url: wm.url, model: "m" }) : new PlanWorker({}), sources: [] });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const send = async (method, p, b) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    return { status: r.status, json: await r.json() };
  };
  return { post: (p, b) => send("POST", p, b), get: (p) => send("GET", p), wm };
}

/** Exactly what NewCourseWizard sends from its review step. */
async function wizard(t, { fromSources }) {
  const { json: { courseId } } = await t.post("/api/courses", { owner: "Ms. Rivera", title: "Moon", materials: [], objectivesConfirm: "explicit" });
  const c = `/api/courses/${encodeURIComponent(courseId)}`;
  const answers = { topic: "Why the Moon changes shape", course: "Ages 8–9", learning_outcomes: MINE.join("\n"), ...(fromSources ? { outcomes_from: "materials" } : {}) };
  await t.post(`${c}/intake/answer`, { text: "all", answers });
  await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the source list." });
  await t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm the brief." });
  return c;
}

const mine = (proposals) => proposals.filter((p) => MINE.includes(p.statement));

test("sources ticked: the source round puts the typed lines on the page first, as the teacher's own, then the model's", async () => {
  const t = await boot();
  const c = await wizard(t, { fromSources: true });
  const r = await t.post(`${c}/materials/propose`, { materials: [{ name: "notes.txt", text: "The Moon reflects sunlight; half is always lit." }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const view = (await t.get(c)).json;
  assert.deepEqual(view.proposals.map((p) => p.statement), [...MINE, FROM_SOURCE]);
  for (const p of mine(view.proposals)) {
    assert.equal(p.status, "proposed", "a proposal the teacher accepts, edits or drops");
    assert.equal(p.source, "from your answer", "labelled as the teacher's own words, never a model's");
  }
  // A second source round does not repeat the teacher's lines; the derive route now refuses (already on the page).
  for (const p of view.proposals) await t.post(`${c}/decisions`, { decisions: [{ verb: "accept", proposalId: p.id }], text: "ok" });
  await t.post(`${c}/materials/propose`, { materials: [{ name: "more.txt", text: "Something new about the Moon." }] });
  assert.equal(mine((await t.get(c)).json.proposals).length, MINE.length);
  assert.equal((await t.post(`${c}/objectives`, {})).json.code, "ALREADY_PROPOSED");
});

test("sources ticked but the model fails: the teacher's own lines are still on the page", async () => {
  const t = await boot({ status: 500 });
  const c = await wizard(t, { fromSources: true });
  const r = await t.post(`${c}/materials/propose`, { materials: [{ name: "notes.txt", text: "The Moon reflects sunlight." }] });
  assert.notEqual(r.status, 200);
  assert.deepEqual((await t.get(c)).json.proposals.map((p) => p.statement), MINE);
});

test("no sources: the derive route makes each typed line a proposal (what the wizard now calls on confirm)", async () => {
  const t = await boot();
  const c = await wizard(t, { fromSources: false });
  const r = await t.post(`${c}/objectives`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.proposals.map((p) => p.statement), MINE);
});

test("explicit course with no typed lines: a source round derives nothing, and the derive route says nothing of the teacher's is on record", async () => {
  const t = await boot();
  const { json: { courseId } } = await t.post("/api/courses", { owner: "o", title: "Moon", materials: [], objectivesConfirm: "explicit" });
  const c = `/api/courses/${encodeURIComponent(courseId)}`;
  await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm." });
  // A round before any outcomes exist (the teacher wrote none yet) …
  await t.post(`${c}/intake/answer`, { text: "all", answers: { topic: "t", course: "c", outcomes_from: "materials" } });
  await t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm." });
  await t.post(`${c}/materials/propose`, { materials: [{ name: "notes.txt", text: "Moon text." }] });
  assert.deepEqual((await t.get(c)).json.proposals.map((p) => p.statement), [FROM_SOURCE]);
  // … so nothing of the teacher's is derived, and the derive route says so.
  assert.equal((await t.post(`${c}/objectives`, {})).json.code, "NO_TEACHER_OUTCOMES");
});
