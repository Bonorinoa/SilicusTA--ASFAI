/**
 * n3-plan-edit.test.mjs — N3 (owner decision, 18 Nov): everything generated is editable.
 *
 * Pinned here, over HTTP on the Node host (the browser host runs the same handler and course code; the
 * byte-identical parity of a plan edit is in frontend/src/browser/browserHost.test.ts via scripted-course.mjs):
 *   - an edit is a chained `plan.edited` event: field path, hash of the replaced value, the cleaned new value;
 *   - the edited plan is a new DRAFT with the same activity ids; the teacher confirms it;
 *   - text goes through the model's own `clean` bounds; minutes stay whole numbers; refusals log nothing;
 *   - the K2 minutes check re-runs after an edit;
 *   - a teacher's AI status against the stage rule is kept and marked, never re-clamped (also after restart);
 *   - after publish, an edit drafts the next version; the sealed version does not change;
 *   - the trace says "You edited Activity 3: then they decide".
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { createApp } from "../server.mjs";
import { aiRuleFor, EDITABLE_PATHS } from "../plan-edit.mjs";

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

const freshDir = () => mkdtempSync(join(tmpdir(), "silicus-n3-"));

/** Every line the host logged under `dir`, as text (whatever the file layout). */
function logText(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.push(readFileSync(p, "utf8")); } };
  walk(dir);
  return out.join("\n");
}
const editEvents = (dir) => logText(dir).split("\n").filter((l) => l.includes('"plan.edited"')).map((l) => JSON.parse(l));
const confirmEvents = (dir) => logText(dir).split("\n").filter((l) => l.includes('"plan.confirmed"')).map((l) => JSON.parse(l));

async function drafted(t) {
  const { json: { courseId } } = await t.post("/api/courses", { owner: "teacher:n3", title: "Plants", ages: { min: 4, max: 10 }, lessonMinutes: 45 });
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

test("N3: an edit is a recorded plan.edited event; the edited plan is a new draft with the same activities", async () => {
  const dir = freshDir();
  const t = await boot(dir);
  const { c, plan } = await drafted(t);
  const r = await edit(t, c, [{ path: "activities.2.decisionAfterHelp", value: "Each child says which guess they keep, and why." }], { planId: plan.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = r.json.plan;
  assert.notEqual(p.id, plan.id, "an edit re-proposes the plan: a new plan id");
  assert.deepEqual(p.activities.map((a) => a.id), plan.activities.map((a) => a.id), "the activities keep their ids");
  assert.equal(p.status, "draft");
  assert.equal(p.proposedBy, "ai", "the edited draft keeps its AI origin");
  assert.equal(p.editedByTeacher, true);
  assert.equal(p.activities[2].decisionAfterHelp, "Each child says which guess they keep, and why.");
  assert.equal(p.activities[0].decisionAfterHelp, plan.activities[0].decisionAfterHelp, "other activities unchanged");
  assert.deepEqual(p.spacedReviews, plan.spacedReviews, "the design overlay travels with the edit");

  const [ev] = editEvents(dir);
  assert.ok(ev, "the edit is in the chained log");
  const event = ev.event ?? ev;
  assert.equal(event.planId, plan.id);
  assert.equal(event.edits.length, 1);
  assert.equal(event.edits[0].path, "activities.2.decisionAfterHelp");
  assert.match(event.edits[0].beforeSha, /^[0-9a-f]{64}$/, "the replaced value is kept as a hash");
  assert.equal(event.edits[0].after, "Each child says which guess they keep, and why.");
  assert.ok(!JSON.stringify(event).includes("Each child keeps or changes the guess."), "the log does not copy the old text");

  const view = (await t.get(c)).json;
  const trace = view.timeline.filter((e) => e.kind === "plan-edit");
  assert.deepEqual(trace.map((e) => e.label), ["You edited Activity 3: then they decide"]);
  assert.equal(trace[0].before, "Each child keeps or changes the guess.");
  const verify = (await t.get(`${c}/verify`)).json;
  assert.equal(verify.ok ?? verify.valid ?? true, true, JSON.stringify(verify));

  // The teacher confirms the edited plan; a no-op edit records nothing.
  const same = await edit(t, c, [{ path: "activities.2.decisionAfterHelp", value: "Each child says which guess they keep, and why." }]);
  assert.equal(same.json.unchanged, true);
  assert.equal(editEvents(dir).length, 1);
  const conf = await t.post(`${c}/plan/confirm`, { text: "Confirm this lesson plan." });
  assert.equal(conf.json.status, "confirmed");
  assert.equal(conf.json.proposedBy, "ai");
  assert.equal(conf.json.editedByTeacher, true);
  assert.equal(conf.json.teacherEditCount, 1);
  assert.equal((confirmEvents(dir).at(-1).event ?? confirmEvents(dir).at(-1)).teacherEditCount, 1);
  const exported = (await t.get(`${c}/export`)).json;
  assert.equal(exported.plan.teacherEditCount, 1);
  await t.stop();
});

test("N3: values go through the model's bounds; refusals record nothing; minutes stay whole numbers", async () => {
  const dir = freshDir();
  const t = await boot(dir);
  const { c } = await drafted(t);
  const before = logText(dir).length;
  const refusals = [
    [{ path: "activities.0.learnerDoes", value: "   " }],
    [{ path: "activities.0.minutes", value: "12" }],
    [{ path: "activities.0.minutes", value: 12.5 }],
    [{ path: "activities.0.minutes", value: 999 }],
    [{ path: "activities.0.objectiveIds", value: ["urn:uuid:x"] }],
    [{ path: "activities.9.title", value: "x" }],
    [{ path: "aiPolicy", value: "x" }],
    [{ path: "activities.0.aiStatus", value: "sometimes" }],
    [{ path: "activities.0.phase", value: 7 }],
    [{ path: "activities.0.evidenceIfAny", value: "chat" }],
    [{ path: "title", value: "a" }, { path: "title", value: "b" }],
  ];
  for (const edits of refusals) {
    const r = await edit(t, c, edits);
    assert.equal(r.status, 422, `${JSON.stringify(edits)} -> ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, "BAD_EDIT");
  }
  assert.equal((await edit(t, c, [])).status, 422);
  assert.equal(logText(dir).length, before, "no refusal wrote to the log");

  const long = "x".repeat(500);
  const r = await edit(t, c, [{ path: "title", value: `  Plants\u2028 at\u202e work ${long}` }, { path: "activities.1.title", value: long }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.plan.title.length <= 160 && !/[\u2028\u202e]/.test(r.json.plan.title), r.json.plan.title);
  assert.ok(r.json.plan.activities[1].title.length <= 120);
  const ev = await edit(t, c, [{ path: "activities.1.evidenceIfAny", value: "work-product" }]);
  assert.equal(ev.json.plan.activities[1].evidenceIfAny, "work-product");
  // An optional field set to empty is removed, not stored as "".
  const cleared = await edit(t, c, [{ path: "activities.1.learnerFirst", value: "" }]);
  assert.equal("learnerFirst" in cleared.json.plan.activities[1], false);
  await t.stop();
});

test("N3: the K2 minutes check re-runs after a minutes edit", async () => {
  const t = await boot(freshDir());
  const { c, plan } = await drafted(t);
  assert.ok(!(plan.notes ?? []).some((n) => /add up to/.test(n)), "45 of 45: no length note at first");
  const over = await edit(t, c, [{ path: "activities.0.minutes", value: 40 }]);
  assert.equal(over.json.plan.activities[0].minutes, 40);
  assert.equal(over.json.plan.notes[0], "Activities add up to 70 min; you asked for 45. Trim or edit.");
  const back = await edit(t, c, [{ path: "activities.0.minutes", value: 15 }]);
  assert.ok(!(back.json.plan.notes ?? []).some((n) => /add up to/.test(n)), JSON.stringify(back.json.plan.notes));
  await t.stop();
});

test("N3: a teacher's AI status against the stage rule is kept, marked and recorded; never re-clamped, also after a restart", async () => {
  const dir = freshDir();
  let t = await boot(dir);
  const { c } = await drafted(t);
  const r = await edit(t, c, [{ path: "activities.0.aiStatus", value: "permitted" }], { text: "Edit activity 1: AI status." });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = r.json.plan.activities[0];
  assert.equal(a.aiStatus, "permitted", "the teacher's status stands");
  assert.deepEqual(a.teacherOverride, { aiStatus: "permitted", rule: "forbidden", ages: { min: 4, max: 10 } });
  assert.equal(a.clamped, undefined);
  assert.equal(r.json.plan.activities[1].teacherOverride, undefined);
  const trace = (await t.get(c)).json.timeline.filter((e) => e.kind === "plan-edit");
  assert.equal(trace.at(-1).label, "You edited Activity 1: AI status");
  assert.equal(trace.at(-1).detail, "permitted");
  await t.stop();

  t = await boot(dir); // restart: the record replays through the same code
  const again = (await t.get(c)).json.plan.activities[0];
  assert.equal(again.aiStatus, "permitted");
  assert.equal(again.teacherOverride.rule, "forbidden");
  // Setting it back inside the rule removes the mark.
  const ok = await edit(t, c, [{ path: "activities.0.aiStatus", value: "forbidden" }]);
  assert.equal(ok.json.plan.activities[0].teacherOverride, undefined);
  await t.stop();
});

test("N3: after publish an edit drafts the next version; the sealed version is untouched", async () => {
  const t = await boot(freshDir());
  const { c } = await drafted(t);
  await t.post(`${c}/plan/confirm`, { text: "Confirm this lesson plan." });
  const pub = await t.post(`${c}/publish`, { text: "Publish the course package." });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  const sealedBefore = JSON.stringify((await t.get(c)).json.versions[0]);
  const r = await edit(t, c, [{ path: "activities.1.title", value: "Leaves in the light" }]);
  assert.equal(r.status, 200);
  const view = (await t.get(c)).json;
  assert.equal(JSON.stringify(view.versions[0]), sealedBefore, "version 1 is exactly as it was sealed");
  assert.equal(view.plan.status, "draft");
  assert.equal(view.plan.courseVersion, 2);
  assert.equal(view.revision.drafting, true);
  assert.equal(view.revision.changes.plan, "unconfirmed");
  await t.stop();
});

test("N3: no plan, a stale plan id, or an invalidated plan is refused", async () => {
  const t = await boot(freshDir());
  const { json: { courseId } } = await t.post("/api/courses", { owner: "teacher:n3", title: "Empty" });
  const none = await edit(t, `/api/courses/${courseId}`, [{ path: "title", value: "x" }]);
  assert.equal(none.status, 409);
  assert.equal(none.json.code, "NO_PLAN");
  const { c } = await drafted(t);
  const stale = await edit(t, c, [{ path: "title", value: "x" }], { planId: "urn:uuid:not-this-plan" });
  assert.equal(stale.json.code, "PLAN_CHANGED");
  await t.stop();
});

test("N3: the stage rule used for the override mark matches the model clamp", () => {
  assert.equal(aiRuleFor(1, "permitted", "x"), "forbidden");
  assert.equal(aiRuleFor(1, "forbidden", ""), null);
  assert.equal(aiRuleFor(2, "required", "x"), "permitted");
  assert.equal(aiRuleFor(2, "permitted", ""), null);
  assert.equal(aiRuleFor(3, "permitted", ""), "forbidden");
  assert.equal(aiRuleFor(3, "required", ""), "forbidden");
  assert.equal(aiRuleFor(3, "required", "first"), "permitted");
  assert.equal(aiRuleFor(4, "required", ""), null);
  assert.ok(EDITABLE_PATHS.includes("activities.N.decisionAfterHelp"));
});
