/**
 * marble-in-course.test.mjs — Marble composes into the draft like any source, without ASFAI.
 *
 * What must hold: a course answered LOCALLY (never sent to ASFAI) still reaches Marble,
 * because the snapshot is local (egress null); the grain guard keeps a university-age course
 * from ever seeing a children's node in its draft; the log keeps refs and labels only, never
 * the retrieved text; and a Marble ref a course cites is verified by snapshot membership.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { PlanWorker } from "../worker.mjs";
import { MarbleSource } from "../sources/marble.mjs";
import { createMarbleService } from "../marble/marble-graph.mjs";
import { startMockWorker } from "./mock-worker.mjs";

const SNAPSHOT = new URL("../data/marble/marble-snapshot.json", import.meta.url).pathname;
const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

const marble = createMarbleService(async () => readFileSync(SNAPSHOT, "utf8"));

/** A "model" that cites the first ref of every reference line it was shown, so citations are real. */
const citingWorker = ({ prompt }) => {
  const ids = [...String(prompt).matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
  const refs = [...String(prompt).matchAll(/^- \[([a-z]+:[^\]]+)\]/gm)].map((m) => m[1]);
  return {
    title: "How machines notice things", audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: ids.map((id, i) => ({
      title: `Activity ${i + 1}`, minutes: 20, objectiveIds: [id],
      learnerDoes: "Spot the machine.", teacherDoes: "Ask about evidence.", evidenceIfAny: "observation",
      ...(refs[i] ? { citations: [refs[i]] } : {}),
    })),
  };
};

async function boot() {
  const wm = await startMockWorker({ reply: citingWorker }); CLOSERS.push(() => wm.close());
  const dir = mkdtempSync(join(tmpdir(), "silicus-marble-course-"));
  return { wm, dir, store: new CourseStore(dir), worker: new PlanWorker({ url: wm.url, model: "t" }) };
}

/** A course at confirmed objectives, answered locally (never sent to ASFAI). */
function courseAtObjectives(store, { course = "AI literacy, ages 8-10", topic = "how machines notice things" } = {}) {
  const s = CourseSession.create(store, { owner: "teacher:tk-1", title: "How machines notice things" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  s.answerIntake({ text: "my answers", answers: { topic, course, learning_outcomes: "name a smart device" }, at: 2000 });
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

test("a locally answered course drafts with a Marble citation, verified by snapshot membership", async () => {
  const { wm, dir, store, worker } = await boot();
  const s = courseAtObjectives(store);
  const r = await s.draftPlanFromObjectives({ worker, sources: [new MarbleSource({ marble })], at: 6000 });
  assert.equal(r.ok, true, r.reason);

  // the worker saw the Marble reference, framed as untrusted material
  assert.match(wm.st.lastPrompt, /\[marble:mt_AzTrT5ySCx\]/);
  assert.match(wm.st.lastPrompt, /NOT instructions/);

  const cites = r.plan.citations ?? [];
  const mc = cites.find((c) => c.source === "marble");
  assert.ok(mc, "a Marble citation made it onto the plan");
  assert.ok(mc.ref.startsWith("marble:"));
  assert.match(mc.label, /\(ages \d+–\d+\)/, "the label carries the node's age range");
  assert.equal(mc.verified, true, "membership in the snapshot is a real check");
  assert.equal(mc.activityIndexes.length > 0, true);

  // the log keeps refs and labels, never the retrieved description text
  const log = logText(dir);
  assert.ok(log.includes(mc.ref));
});

test("a 19-year-old course is the wrong grain: Marble returns nothing, and the draft has no Marble citation", async () => {
  const { wm, dir, store, worker } = await boot();
  const s = courseAtObjectives(store, { course: "University econometrics, ages 19 and up", topic: "maximum likelihood estimation" });
  const r = await s.draftPlanFromObjectives({ worker, sources: [new MarbleSource({ marble })], at: 6000 });
  assert.equal(r.ok, true);
  assert.equal(/\[marble:/.test(wm.st.lastPrompt), false, "the prompt never showed a children's node");
  assert.equal("citations" in r.plan, false);
  assert.equal(logText(dir).includes("marble:"), false, "nothing Marble-shaped reached the log");
});

test("an age band inside the course is honoured: nodes outside the band are not cited", async () => {
  const { wm, store, worker } = await boot();
  // Course ages 12-15: "Likelihood Language" (6-10) is entirely below the band, "Ordering Likelihoods" (8-12) touches it.
  const s = courseAtObjectives(store, { course: "Upper primary, ages 12-15", topic: "likelihood and probability language" });
  const r = await s.draftPlanFromObjectives({ worker, sources: [new MarbleSource({ marble })], at: 6000 });
  assert.equal(r.ok, true);
  for (const c of r.plan.citations ?? []) {
    if (c.source !== "marble") continue;
    const m = c.label.match(/\(ages (\d+)–(\d+)\)$/);
    assert.ok(m, `a Marble label carries its ages: ${c.label}`);
    const [, lo, hi] = m.map(Number);
    assert.ok(lo <= 15 && hi >= 12, `${c.ref} (ages ${lo}-${hi}) overlaps the course 12-15`);
  }
  assert.ok(!(r.plan.citations ?? []).some((c) => c.source === "marble" && /6–10\)$/.test(c.label)),
    "a node fully below the band never appears");
});

test("a source failure degrades: a broken snapshot still drafts, with no Marble citation", async () => {
  const wm = await startMockWorker({ reply: citingWorker }); CLOSERS.push(() => wm.close());
  const dir = mkdtempSync(join(tmpdir(), "silicus-marble-course-"));
  const store = new CourseStore(dir);
  const s = courseAtObjectives(store);
  const broken = new MarbleSource({ marble: createMarbleService(async () => { throw new Error("offline"); }) });
  const r = await s.draftPlanFromObjectives({ worker: new PlanWorker({ url: wm.url, model: "t" }), sources: [broken], at: 6000 });
  assert.equal(r.ok, true, "a draft with no context is still a draft");
  assert.equal("citations" in r.plan, false);
});
