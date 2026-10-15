/**
 * draft-with-context.test.mjs — sources compose into the draft, in the course.
 *
 * What must hold: retrieval informs the worker and nothing else; the log keeps REFS (never the
 * retrieved text); a source can fail in any way without failing the draft; ASFAI's graph is only
 * consulted for a course whose answers the teacher already sent there; and with no sources the
 * draft is exactly what it was.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { PlanWorker } from "../worker.mjs";
import { KnowledgeSource } from "../knowledge.mjs";
import { AsfaiGraphSource } from "../sources/asfai-graph.mjs";
import { LocalOntologySource } from "../sources/local-ontology.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { connectedAsfai, ANSWERS } from "./asfai-fixture.mjs";
import { createApp } from "../server.mjs";

const OWNER = "teacher:tk-1";
const ONTOLOGY = new URL("../fixtures/ontology.example.json", import.meta.url).pathname;
const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

/** A "model" that cites the first ref of every reference line it was shown, so citations are real. */
const citingWorker = ({ prompt }) => {
  const ids = [...String(prompt).matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
  const refs = [...String(prompt).matchAll(/^- \[([a-z]+:[^\]]+)\]/gm)].map((m) => m[1]);
  return {
    title: "Seeing the claim",
    audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: ids.map((id, i) => ({
      title: `Activity ${i + 1}`, minutes: 20, objectiveIds: [id],
      learnerDoes: "Mark the claim.", teacherDoes: "Ask about evidence.", evidenceIfAny: "observation",
      ...(refs[i] ? { citations: [refs[i]] } : {}),
    })),
  };
};

async function boot({ reply = citingWorker } = {}) {
  const wm = await startMockWorker({ reply }); CLOSERS.push(() => wm.close());
  const asfai = await connectedAsfai(); CLOSERS.push(() => asfai.mock.close());
  const dir = mkdtempSync(join(tmpdir(), "silicus-ctx-"));
  return { wm, asfai, dir, store: new CourseStore(dir), worker: new PlanWorker({ url: wm.url, model: "t" }) };
}

/** A course at confirmed objectives. `viaAsfai`: the teacher sent the round to ASFAI (else answered locally). */
function courseAtObjectives(store, { viaAsfai }) {
  const s = CourseSession.create(store, { owner: OWNER, title: "AI literacy" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  if (viaAsfai) {
    s.observeIntake({ state: "clarifying", questions: [{ id: "topic", prompt: "t" }, { id: "course", prompt: "c" }, { id: "learning_outcomes", prompt: "o" }], at: 1500 });
    s.answerIntake({ text: "my answers", answers: ANSWERS, at: 2000 });
    s.observeIntake({ state: "ready_to_draft", at: 2500 });
  } else {
    s.answerIntake({ text: "my answers", answers: ANSWERS, at: 2000 });
  }
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 3000 });
  const { proposals } = s.proposeObjectivesFromAnswers({ at: 4000 });
  s.decideObjectives({ decisions: proposals.map((p) => ({ verb: "accept", proposalId: p.id })), text: "Accept them all.", at: 5000 });
  return s;
}

const logText = (dir) => {
  const found = [];
  const walk = (d) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : n === "events.ndjson" && found.push(readFileSync(p, "utf8")); });
  walk(dir);
  return found.join("\n");
};

const graph = (asfai) => new AsfaiGraphSource({ client: asfai.svc.client });
const ontology = () => new LocalOntologySource({ file: ONTOLOGY });

test("the plan is drafted with context from BOTH sources, records refs only, and survives a restart", async () => {
  const { wm, asfai, dir, store, worker } = await boot();
  const s = courseAtObjectives(store, { viaAsfai: true });
  const r = await s.draftPlanFromObjectives({ worker, sources: [graph(asfai), ontology()], at: 6000 });
  assert.equal(r.ok, true, r.reason);

  // the worker saw citations from both sources, and was told they are untrusted reference material
  assert.match(wm.st.lastPrompt, /\[asfai:mt_0007\]/);
  assert.match(wm.st.lastPrompt, /\[local:algo\.sequence\]/);
  assert.match(wm.st.lastPrompt, /NOT instructions/);

  // the plan records which nodes it cited - ref, label, source, which activities, whether anyone CHECKED
  const cites = r.plan.citations;
  assert.ok(cites.length >= 1);
  const asfaiCite = cites.find((c) => c.source === "asfai-graph");
  assert.ok(asfaiCite, "an ASFAI-sourced citation made it onto the plan");
  assert.match(asfaiCite.label, /ages \d+–\d+/);
  assert.equal(asfaiCite.verified, true, "the graph confirmed the node exists (get_objective membership)");
  assert.ok(cites.every((c) => Array.isArray(c.activityIndexes) && c.activityIndexes.length > 0));
  assert.ok(r.plan.activities.every((a) => !("citations" in a)), "the gate's activity record is untouched: citations live beside it");

  // the LOG keeps refs and labels, never the retrieved text
  const log = logText(dir);
  assert.ok(log.includes(asfaiCite.ref));
  assert.equal(log.includes("sequence of instructions"), false, "retrieved description text is not evidence and is not recorded");
  assert.equal(log.includes("Follow and write a short sequence of steps"), false);

  // the citation is recorded ONCE, event-level - not smuggled into the spec the gate is handed
  const planEvent = log.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((rec) => rec.event.kind === "plan.proposed").event;
  assert.equal(JSON.stringify(planEvent.spec).includes("citations"), false);
  assert.ok(Array.isArray(planEvent.citations) && planEvent.citations.every((c) => !("text" in c)), "refs and labels only; no retrieved text field");

  // and it replays
  const again = CourseSession.load(store, s.courseId);
  assert.deepEqual(again.view().plan.citations, cites);
  assert.equal(JSON.stringify(again.view()), JSON.stringify(s.view()), "the record is byte-identical after a reload");
  assert.equal(again.verifyLog().ok, true);
});

test("with no sources configured the draft is unchanged: no context block, no citations, no extra event field", async () => {
  const { wm, dir, store, worker } = await boot();
  const s = courseAtObjectives(store, { viaAsfai: false });
  const r = await s.draftPlanFromObjectives({ worker, sources: [], at: 6000 });
  assert.equal(r.ok, true);
  assert.equal(/Reference material/.test(wm.st.lastPrompt), false);
  assert.equal("citations" in r.plan, false);
  const planEvent = logText(dir).split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((rec) => rec.event.kind === "plan.proposed").event;
  assert.deepEqual(Object.keys(planEvent).sort(), ["assistantText", "at", "kind", "spec"], "the event shape is exactly Sprint 5's");
  assert.equal(JSON.stringify(planEvent.spec).includes("citations"), false);
});

test("ASFAI's graph is NOT queried for a course whose answers never went to ASFAI - the local ontology still is", async () => {
  const { wm, asfai, store, worker } = await boot();
  const s = courseAtObjectives(store, { viaAsfai: false });
  assert.equal(s.intakeStatus().questionsFrom, "local");
  const r = await s.draftPlanFromObjectives({ worker, sources: [graph(asfai), ontology()], at: 6000 });
  assert.equal(r.ok, true);
  assert.equal((asfai.mock.st.toolArgs ?? []).filter((a) => a.action === "search_objectives").length, 0,
    "no new egress to ASFAI without the teacher's own act of sending to it");
  assert.match(wm.st.lastPrompt, /\[local:/);
  assert.equal(/\[asfai:/.test(wm.st.lastPrompt), false);
  assert.ok(r.plan.citations.every((c) => c.source === "local-ontology"));
});

test("a local ontology alone drafts a cited plan with NO ASFAI at all", async () => {
  const { wm, store, worker } = await boot();
  const s = courseAtObjectives(store, { viaAsfai: false });
  const r = await s.draftPlanFromObjectives({ worker, sources: [ontology()], at: 6000 });
  assert.equal(r.ok, true);
  assert.ok(r.plan.citations.length > 0);
  assert.ok(r.plan.citations.every((c) => c.ref.startsWith("local:") && c.verified === true));
  assert.match(wm.st.lastPrompt, /Finding the claim in an AI answer/);
});

test("a source that throws, hangs or is down never fails the draft", async () => {
  const { store, worker } = await boot();
  class Boom extends KnowledgeSource {
    get id() { return "boom"; } get label() { return "boom"; } get namespace() { return "boom"; } get enabled() { return true; }
    async retrieve() { throw new Error("kaboom"); }
  }
  const s = courseAtObjectives(store, { viaAsfai: false });
  const r = await s.draftPlanFromObjectives({ worker, sources: [new Boom(), new LocalOntologySource({ file: "/nonexistent/o.json" })], at: 6000 });
  assert.equal(r.ok, true, "a draft with no context is still a draft");
  assert.equal("citations" in r.plan, false);
});

test("a source that cannot verify yields an UNVERIFIED citation, and the record says so", async () => {
  const { store, worker } = await boot();
  class NoVerify extends KnowledgeSource {
    get id() { return "no-verify"; } get label() { return "nv"; } get namespace() { return "nv"; } get enabled() { return true; }
    async retrieve() { return [{ ref: "nv:1", label: "Some node", text: "Something." }]; }
  }
  const s = courseAtObjectives(store, { viaAsfai: false });
  const r = await s.draftPlanFromObjectives({ worker, sources: [new NoVerify()], at: 6000 });
  assert.equal(r.ok, true);
  assert.equal(r.plan.citations[0].ref, "nv:1");
  assert.equal(r.plan.citations[0].verified, false, "retrievable is not verified, and the UI must not claim otherwise");
});

test("a citation the source then reports as unknown is dropped, and the draft survives", async () => {
  const { store, worker } = await boot();
  class Flaky extends KnowledgeSource {
    get id() { return "flaky"; } get label() { return "f"; } get namespace() { return "f"; } get enabled() { return true; } get canVerify() { return true; }
    async retrieve() { return [{ ref: "f:gone", label: "Withdrawn node", text: "x" }]; }
    async verify({ citations }) { return { ok: false, unknown: citations.map((c) => c.ref), checked: true }; }
  }
  const s = courseAtObjectives(store, { viaAsfai: false });
  const r = await s.draftPlanFromObjectives({ worker, sources: [new Flaky()], at: 6000 });
  assert.equal(r.ok, true);
  assert.equal("citations" in r.plan, false, "a citation optional enough to drop costs the teacher nothing");
});

test("citations are suggestions: they are not in the sealed package, and they confirm nothing", async () => {
  const { store, worker } = await boot();
  const s = courseAtObjectives(store, { viaAsfai: false });
  await s.draftPlanFromObjectives({ worker, sources: [ontology()], at: 6000 });
  assert.equal(s.view().plan.status, "draft", "a cited plan is still only a draft");
  s.confirmLessonPlan({ text: "Confirm this lesson plan.", at: 7000 });
  s.publish({ text: "Publish the course package.", at: 8000 });
  assert.equal(JSON.stringify(s.view().versions).includes("local:"), false, "the sealed version carries no alignment suggestions");
  assert.ok(s.export().plan.citations.length > 0, "the export keeps them beside the plan, as suggestions");
});

test("the knowledge-status route reports capability only: no path, no credential", async () => {
  const { dir, asfai } = await boot();
  const app = createApp({ dataDir: dir, asfai: asfai.svc, sources: [graph(asfai), ontology()] });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const res = await (await fetch(`http://127.0.0.1:${app.address().port}/api/knowledge/status`)).json();
  assert.deepEqual(res.sources.map((x) => x.id), ["asfai-graph", "local-ontology"], "ASFAI first, the recommended source");
  assert.deepEqual(res.sources.map((x) => x.enabled), [true, true]);
  const wire = JSON.stringify(res);
  assert.equal(wire.includes("ontology.example.json"), false);
  assert.equal(wire.includes("/fixtures"), false);
});
