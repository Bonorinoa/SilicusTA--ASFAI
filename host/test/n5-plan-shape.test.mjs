/**
 * n5-plan-shape.test.mjs — N5 C5, the rest of "editable" (Node host; the browser host runs the same course code, and
 * its byte-identical parity is in frontend/src/browser/browserHost.test.ts):
 *   - a later review's timing (afterDays) and form;
 *   - the objectives an activity cites, chosen from the confirmed objectives only;
 *   - add, remove and reorder activities, one per Save, with the K2 minutes check re-run;
 *   - every one is the same chained `plan.edited` event and replays to the same plan after a restart;
 *   - the skill-map "why" lines and thread names stay read-only (guidance on a choice, not content).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { createApp } from "../server.mjs";
import { EDITABLE_PATHS, READ_ONLY_GUIDANCE, REVIEW_FORMS } from "../plan-edit.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

const A = "Students can explain what a plant needs.";
const B = "Students can say why leaves are green.";

/** A stage-1 plan (ages 4-10): every activity forbidden, the minutes add up to 45. */
function model() {
  return ({ prompt }) => {
    const ids = [...String(prompt).matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
    return {
      title: "How plants eat", audience: { ageRangeStart: 4, ageRangeEnd: 10 },
      sessions: [{ session: 1, evidence: { kind: "work-product", whatLearnerProduces: "Each child's drawing of a plant with labels." } }],
      spacedReviews: [{ afterDays: 7, form: "near-transfer", whatChanges: "a different plant", prompt: "What does this plant need?" }],
      activities: [0, 1, 2].map((i) => ({
        title: `Activity ${i + 1}`, minutes: 15, objectiveIds: [ids[i % ids.length]], learnerDoes: "Draw it.", teacherDoes: "Ask why.",
        evidenceIfAny: "observation", phase: 1, learnerFirst: "Each child guesses first.", aiStatus: "forbidden",
        decisionAfterHelp: "Each child keeps or changes the guess.",
      })),
    };
  };
}

async function boot(dir) {
  const wm = await startMockWorker({ reply: model() }); CLOSERS.push(() => wm.close());
  const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: wm.url, model: "m" }), sources: [] });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const send = async (method, p, b) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    return { status: r.status, json: await r.json() };
  };
  const stop = () => new Promise((r) => { app.closeAllConnections?.(); app.close(() => r()); });
  return { post: (p, b) => send("POST", p, b), get: (p) => send("GET", p), stop };
}

const freshDir = () => mkdtempSync(join(tmpdir(), "silicus-n5c5-"));

/** Every line the host logged under `dir`, as text (whatever the file layout). */
function logText(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.push(readFileSync(p, "utf8")); } };
  walk(dir);
  return out.join("\n");
}
const editEvents = (dir) => logText(dir).split("\n").filter((l) => l.includes('"plan.edited"')).map((l) => JSON.parse(l));

async function drafted(t) {
  const { json: { courseId } } = await t.post("/api/courses", { owner: "teacher:n5", title: "Plants", ages: { min: 4, max: 10 }, lessonMinutes: 45 });
  const c = `/api/courses/${courseId}`;
  await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  await t.post(`${c}/intake/answer`, { text: "all", answers: { topic: "plants", course: "Science, ages 4-10", learning_outcomes: `${A}\n${B}` } });
  await t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const { json: { proposals } } = await t.post(`${c}/objectives`, {});
  await t.post(`${c}/decisions`, { decisions: proposals.map((p) => ({ verb: "accept", proposalId: p.id })), text: "Accept both." });
  const plan = await t.post(`${c}/plan`, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  return { c, plan: plan.json };
}

const edit = (t, c, edits, extra = {}) => t.post(`${c}/plan/edit`, { text: "Edit the plan.", edits, ...extra });


const ids = (p) => p.activities.map((a) => a.id);

test("N5 C5: a later review's timing and form are editable, bounded, recorded and traced", async () => {
  const dir = freshDir();
  const t = await boot(dir);
  const { c } = await drafted(t);
  const r = await edit(t, c, [{ path: "spacedReviews.0.afterDays", value: 14 }, { path: "spacedReviews.0.form", value: "far-transfer" }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.plan.spacedReviews[0].afterDays, 14);
  assert.equal(r.json.plan.spacedReviews[0].form, "far-transfer");
  for (const bad of [{ path: "spacedReviews.0.afterDays", value: -1 }, { path: "spacedReviews.0.afterDays", value: 2.5 }, { path: "spacedReviews.0.form", value: "quiz" }]) {
    const x = await edit(t, c, [bad]);
    assert.equal(x.status, 422, JSON.stringify(bad));
  }
  const [ev] = editEvents(dir).map((l) => l.event ?? l);
  assert.deepEqual(ev.edits.map((e) => [e.path, e.after]), [["spacedReviews.0.afterDays", 14], ["spacedReviews.0.form", "far-transfer"]]);
  assert.equal(editEvents(dir).length, 1, "refusals record nothing");
  const trace = (await t.get(c)).json.timeline.filter((e) => e.kind === "plan-edit").map((e) => e.label);
  assert.deepEqual(trace, ["You edited Later review 1: timing", "You edited Later review 1: form"]);
  assert.deepEqual([...REVIEW_FORMS], ["recall-without-support", "near-transfer", "far-transfer", "explain-to-absent"]);
  await t.stop();
});

test("N5 C5: an activity's cited objectives come only from the confirmed objectives", async () => {
  const dir = freshDir();
  const t = await boot(dir);
  const { c, plan } = await drafted(t);
  const confirmed = [...new Set(plan.activities.flatMap((a) => a.objectiveIds))];
  assert.equal(confirmed.length, 2);
  const both = await edit(t, c, [{ path: "activities.0.objectiveIds", value: [confirmed[1], confirmed[0], confirmed[1]] }]);
  assert.equal(both.status, 200, JSON.stringify(both.json));
  assert.deepEqual(both.json.plan.activities[0].objectiveIds, [confirmed[1], confirmed[0]], "duplicates collapse, order kept");
  for (const value of [[], ["urn:uuid:00000000-0000-4000-8000-000000000000"], [confirmed[0], "mt_123"], "x"]) {
    const x = await edit(t, c, [{ path: "activities.0.objectiveIds", value }]);
    assert.equal(x.status, 422, JSON.stringify(value));
  }
  const trace = (await t.get(c)).json.timeline.filter((e) => e.kind === "plan-edit");
  assert.equal(trace[0].label, "You edited Activity 1: objectives");
  assert.match(trace[0].detail, /^Objective \d, Objective \d$/, "the trace names objectives, not URNs");
  assert.equal(editEvents(dir).length, 1);
  await t.stop();
});

test("N5 C5: add, remove and reorder activities; the K2 minutes check re-runs; one shape change per save", async () => {
  const dir = freshDir();
  const t = await boot(dir);
  const { c, plan } = await drafted(t);
  const obj = plan.activities[0].objectiveIds[0];
  const add = await edit(t, c, [{ path: "activities.add", value: { title: "Share out", minutes: 10, objectiveIds: [obj], learnerDoes: "Each pair shows one drawing.", teacherDoes: "Asks what changed.", evidenceIfAny: "observation" } }]);
  assert.equal(add.status, 200, JSON.stringify(add.json));
  const p1 = add.json.plan;
  assert.equal(p1.activities.length, 4);
  assert.deepEqual(ids(p1).slice(0, 3), ids(plan), "existing activities keep their ids");
  assert.equal(p1.activities[3].title, "Share out");
  assert.equal(p1.notes[0], "Activities add up to 55 min; you asked for 45. Trim or edit.");

  const move = await edit(t, c, [{ path: "activities.3.moveTo", value: 0 }]);
  assert.equal(move.status, 200, JSON.stringify(move.json));
  assert.deepEqual(ids(move.json.plan), [ids(p1)[3], ...ids(p1).slice(0, 3)], "a move keeps every id");
  const same = await edit(t, c, [{ path: "activities.0.moveTo", value: 0 }]);
  assert.equal(same.json.unchanged, true, "moving to the same place records nothing");

  const rm = await edit(t, c, [{ path: "activities.0.remove", value: true }]);
  assert.equal(rm.status, 200, JSON.stringify(rm.json));
  assert.deepEqual(ids(rm.json.plan), ids(plan));
  assert.ok(!(rm.json.plan.notes ?? []).some((n) => /add up to/.test(n)), "45 of 45 again: the length note goes");
  const rm2 = await edit(t, c, [{ path: "activities.2.remove", value: true }]);
  assert.equal(rm2.json.plan.notes[0], "Activities add up to 30 min; you asked for 45. Lengthen or edit.");

  // Refusals: two shape changes, a shape change with a text edit, a bad position, a bad new activity, the last activity.
  const refusals = [
    [{ path: "activities.0.moveTo", value: 1 }, { path: "activities.1.remove", value: true }],
    [{ path: "activities.0.moveTo", value: 1 }, { path: "title", value: "New" }],
    [{ path: "activities.0.moveTo", value: 5 }],
    [{ path: "activities.add", value: { title: "No minutes", objectiveIds: [obj], learnerDoes: "x", teacherDoes: "y", evidenceIfAny: "none" } }],
    [{ path: "activities.add", value: { title: "Chat", minutes: 5, objectiveIds: [obj], learnerDoes: "x", teacherDoes: "y", evidenceIfAny: "student-chat" } }],
    [{ path: "activities.add", value: { title: "Unknown", minutes: 5, objectiveIds: ["mt_1"], learnerDoes: "x", teacherDoes: "y", evidenceIfAny: "none" } }],
    [{ path: "activities.9.remove", value: true }],
  ];
  const before = editEvents(dir).length;
  for (const edits of refusals) assert.equal((await edit(t, c, edits)).status, 422, JSON.stringify(edits));
  await edit(t, c, [{ path: "activities.1.remove", value: true }]);
  assert.equal((await edit(t, c, [{ path: "activities.0.remove", value: true }])).status, 422, "the last activity stays");
  assert.equal(editEvents(dir).length, before + 1, "refusals record nothing");

  const events = editEvents(dir).map((l) => l.event ?? l);
  assert.ok(events.every((e) => e.kind === "plan.edited"), "every shape change is the same plan.edited event");
  assert.deepEqual(events.map((e) => e.edits[0].path), ["activities.add", "activities.3.moveTo", "activities.0.remove", "activities.2.remove", "activities.1.remove"]);
  assert.match(events[2].edits[0].beforeSha, /^[0-9a-f]{64}$/);
  assert.equal(events[2].edits[0].after, true);
  const labels = (await t.get(c)).json.timeline.filter((e) => e.kind === "plan-edit").map((e) => [e.label, e.before, e.detail]);
  assert.deepEqual(labels.slice(0, 3), [
    ["You edited Activities: added activity 4", null, "Share out"],
    ["You edited Activities: moved activity 4 to position 1", "position 4", "position 1"],
    ["You edited Activities: removed activity 1", "Share out", null],
  ]);
  const verify = (await t.get(`${c}/verify`)).json;
  assert.equal(verify.ok ?? verify.valid ?? true, true, JSON.stringify(verify));
  const final = (await t.get(c)).json.plan;
  await t.stop();

  // A restart replays every shape change to the same plan.
  const t2 = await boot(dir);
  const again = (await t2.get(c)).json.plan;
  assert.deepEqual(again, final);
  const conf = await t2.post(`${c}/plan/confirm`, { text: "Confirm this lesson plan." });
  assert.equal(conf.json.status, "confirmed");
  await t2.stop();
});

test("N5 C5: the inventory lists the new paths; skill-map guidance stays read-only", () => {
  for (const p of ["spacedReviews.N.afterDays", "spacedReviews.N.form", "activities.N.objectiveIds", "activities.add", "activities.N.remove", "activities.N.moveTo"]) assert.ok(EDITABLE_PATHS.includes(p), p);
  assert.deepEqual([...READ_ONLY_GUIDANCE], ["skill map: why lines", "skill map: thread names"]);
  assert.ok(!EDITABLE_PATHS.some((p) => /why|thread/i.test(p)));
});
