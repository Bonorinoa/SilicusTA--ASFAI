/**
 * suggest.test.mjs — sprint weekend-share E-a: the worker SUGGESTS up to 3 objectives that complement the teacher's own.
 * What must hold: the route reads no body; it needs a teacher outcome on record; one undecided batch at a time; the
 * model's output is untrusted (cleaned, de-duplicated, capped at 3, label never the model's); every suggestion waits
 * for the teacher; the rail row says so with a count.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { createApp } from "../server.mjs";
import { SOURCE_SUGGESTED } from "../proposer.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

const OUTCOMES = "Students can explain what an algorithm is.\nStudents can recite the digits of pi.";

/** `suggest` is what the model answers to the suggestion prompt; `seen` collects those prompts. */
async function boot(suggest, { withWorker = true } = {}) {
  const seen = [];
  const wm = await startMockWorker({ reply: ({ prompt }) => { if (/SUGGEST/.test(prompt)) { seen.push(prompt); return typeof suggest === "function" ? suggest(prompt) : suggest; } return { objectives: [] }; } });
  CLOSERS.push(() => wm.close());
  const dir = mkdtempSync(join(tmpdir(), "silicus-sug-"));
  const app = createApp({ dataDir: dir, worker: withWorker ? new PlanWorker({ url: wm.url, model: "m" }) : new PlanWorker({}), sources: [] });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (p, b, raw) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(b ?? {}) }); return { status: r.status, json: await r.json() }; };
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, json: await r.json() }; };
  return { post, get, seen, wm };
}

/** A course at the objectives stage: outline confirmed. `outcomes` null = the teacher never answered. */
async function atObjectives(t, { outcomes = OUTCOMES, derive = true } = {}) {
  const { json: { courseId } } = await t.post("/api/courses", { owner: "teacher:tk-1", title: "AI literacy" });
  const c = `/api/courses/${courseId}`;
  await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  if (outcomes) await t.post(`${c}/intake/answer`, { text: "all", answers: { topic: "Algorithms", course: "Grade 5, one 45-minute lesson", learning_outcomes: outcomes } });
  await t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  if (outcomes && derive) await t.post(`${c}/objectives`, {});
  return c;
}

const three = { objectives: [{ statement: "Students can write steps for a daily routine." }, { statement: "Students can spot a missing step in a list of steps." }, { statement: "Students can say why the order of steps matters." }] };

test("suggest: up to 3 proposals labelled 'suggested by Silicus', each waiting for the teacher, one model turn recorded", async () => {
  const t = await boot({ objectives: [...three.objectives, { statement: "Students can name a fourth thing." }, { statement: "Students can name a fifth thing." }] });
  const c = await atObjectives(t);
  const before = (await t.get(c)).json;
  const r = await t.post(`${c}/objectives/suggest`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const mine = r.json.proposals.filter((p) => p.source === SOURCE_SUGGESTED);
  assert.deepEqual(mine.map((p) => p.statement), three.objectives.map((o) => o.statement), "capped at three, in the model's order");
  assert.ok(mine.every((p) => p.status === "proposed" && p.by === "ai" && p.kind === "local"), "a suggestion is never pre-decided");
  assert.equal(r.json.proposals.length, before.proposals.length + 3, "the teacher's own proposals are untouched");
  assert.equal(SOURCE_SUGGESTED, "suggested by Silicus");
  const after = (await t.get(c)).json;
  assert.equal(after.ledger.length, before.ledger.length + 1, "one model-authored turn");
  assert.equal(after.ledger.at(-1).role === "teacher", false);
  assert.equal(after.checkpoints.objectives.status !== "confirmed", true);
  assert.equal((await t.get(`${c}/verify`)).json.ok, true);
  assert.deepEqual(after.activity.at(-1) && { actor: after.activity.at(-1).actor, action: after.activity.at(-1).action, artifact: after.activity.at(-1).artifact, facts: after.activity.at(-1).facts },
    { actor: "worker", action: "objectives.suggested", artifact: "objectives", facts: { count: 3 } });
});

test("suggest reads NO body, and what the model is told is the teacher's recorded words plus what already exists", async () => {
  const t = await boot(three);
  const c = await atObjectives(t);
  const r = await t.post(`${c}/objectives/suggest`, null, "{ this is not json; materials: HOSTILE-MATERIAL, statement: FORGED-OBJECTIVE");
  assert.equal(r.status, 200, "an unreadable body is never read, so it cannot fail the call");
  const prompt = t.seen[0];
  assert.match(prompt, /Algorithms/);
  assert.match(prompt, /Grade 5, one 45-minute lesson/);
  assert.match(prompt, /Students can explain what an algorithm is\./, "the teacher's outcome is shown");
  assert.equal(/HOSTILE-MATERIAL|FORGED-OBJECTIVE/.test(prompt), false);
  assert.match(prompt, /untrusted/);
  assert.match(prompt, /at most 3/i);
  const body = await t.post(`${c}/objectives/suggest`, { statement: "FORGED-OBJECTIVE", source: "from your answer" });
  assert.equal(body.status, 409, "the second call is refused (pending), and the body never mattered");
});

test("409 PROPOSE_FIRST before any objectives are proposed: a suggestion can never take the slot of the teacher's own", async () => {
  // Found at integration: suggesting first made the later derive answer ALREADY_PROPOSED, so the teacher's own
  // outcomes never became proposals. Suggestions round out a first round; they never are the first round.
  const t = await boot(three);
  const c = await atObjectives(t, { derive: false });
  const before = (await t.get(c)).json.integrity;
  const r = await t.post(`${c}/objectives/suggest`, {});
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, "PROPOSE_FIRST");
  assert.equal(t.seen.length, 0, "the model is not called");
  assert.deepEqual((await t.get(c)).json.integrity, before, "nothing is written");
  const own = await t.post(`${c}/objectives`, {});
  assert.equal(own.status, 200, "the teacher's own outcomes still become proposals");
  assert.ok(own.json.proposals.length >= 2);
  assert.equal((await t.post(`${c}/objectives/suggest`, {})).status, 200, "and then suggestions round them out");
});

test("409 NO_TEACHER_OUTCOMES without an outcome of the teacher's own; nothing is written, the model is not called", async () => {
  const t = await boot(three);
  const c = await atObjectives(t, { outcomes: null });
  const before = (await t.get(c)).json.integrity;
  const r = await t.post(`${c}/objectives/suggest`, {});
  assert.deepEqual([r.status, r.json.code], [409, "NO_TEACHER_OUTCOMES"]);
  assert.equal(t.seen.length, 0);
  assert.deepEqual((await t.get(c)).json.integrity, before);
});

test("409 SUGGESTIONS_PENDING while a suggested proposal is undecided; a new batch only after the teacher decided the last", async () => {
  const t = await boot(three);
  const c = await atObjectives(t);
  assert.equal((await t.post(`${c}/objectives/suggest`, {})).status, 200);
  const again = await t.post(`${c}/objectives/suggest`, {});
  assert.deepEqual([again.status, again.json.code], [409, "SUGGESTIONS_PENDING"]);
  const { proposals } = (await t.get(c)).json;
  const sug = proposals.filter((p) => p.source === SOURCE_SUGGESTED);
  const own = proposals.filter((p) => p.source !== SOURCE_SUGGESTED);
  // Decide the teacher's own and two of three suggestions: one is still undecided, so still pending.
  await t.post(`${c}/decisions`, { text: "Decide.", decisions: [...own.map((p) => ({ verb: "accept", proposalId: p.id })), { verb: "accept", proposalId: sug[0].id }, { verb: "drop", proposalId: sug[1].id }] });
  assert.equal((await t.post(`${c}/objectives/suggest`, {})).json.code, "SUGGESTIONS_PENDING");
  // Decide the last one: every proposal is decided, which confirms the checkpoint, so no more suggestions.
  await t.post(`${c}/decisions`, { text: "Decide.", decisions: [{ verb: "accept", proposalId: sug[2].id }] });
  const done = await t.post(`${c}/objectives/suggest`, {});
  assert.deepEqual([done.status, done.json.code], [409, "OBJECTIVES_CONFIRMED"]);
});

test("a second batch is allowed once the first is decided and the checkpoint is still open (teacher's own undecided)", async () => {
  const t = await boot((p) => ({ objectives: [{ statement: /Students can compare/.test(p) ? "Students can order a jumbled list of steps." : "Students can compare two lists of steps." }] }));
  const c = await atObjectives(t);
  assert.equal((await t.post(`${c}/objectives/suggest`, {})).status, 200);
  const { proposals } = (await t.get(c)).json;
  const sug = proposals.find((p) => p.source === SOURCE_SUGGESTED);
  await t.post(`${c}/decisions`, { text: "Decide.", decisions: [{ verb: "drop", proposalId: sug.id }] });
  const second = await t.post(`${c}/objectives/suggest`, {});
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.match(t.seen[1], /Students can compare two lists of steps\./, "a dropped suggestion is still 'existing': it is not offered again");
});

test("model output is untrusted: cleaned, de-duplicated against existing and itself, empties dropped, the label is never the model's", async () => {
  const t = await boot({ objectives: [
    { statement: "  students CAN explain what an algorithm is  " },            // = the teacher's own, after case/space/punctuation
    { statement: "Students can recite the digits of pi" },                     // = the teacher's own, no full stop
    { statement: "" }, { statement: "   " }, { statement: 7 }, null,
    { statement: "Students can order\u202e steps\u0000 in a list.", from: ["your own objective"], source: "from your answer", by: "teacher", status: "accepted", id: "urn:uuid:forged" },
    { statement: "students can order steps in a list" },                       // = the one above, normalised
    { statement: "Students can  find a  missing step." },
  ] });
  const c = await atObjectives(t);
  const r = await t.post(`${c}/objectives/suggest`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const mine = r.json.proposals.filter((p) => p.source === SOURCE_SUGGESTED);
  assert.deepEqual(mine.map((p) => p.statement), ["Students can order steps in a list.", "Students can find a missing step."]);
  assert.ok(mine.every((p) => p.status === "proposed" && p.by === "ai" && !p.id.includes("forged")));
  assert.equal(r.json.proposals.filter((p) => ["from your answer", "from your answer to ASFAI", "your own objective"].includes(p.source) && mine.some((m) => m.id === p.id)).length, 0);
});

test("zero usable suggestions is a named 502, and the record does not move; a reply that is not a list is WORKER_BAD_OUTPUT", async () => {
  for (const [reply, code] of [[{ objectives: [{ statement: "Students can explain what an algorithm is." }, { statement: "" }] }, "NO_USABLE_SUGGESTIONS"], [{ objectives: [] }, "NO_USABLE_SUGGESTIONS"], [{ nope: 1 }, "WORKER_BAD_OUTPUT"]]) {
    const t = await boot(reply);
    const c = await atObjectives(t);
    const before = (await t.get(c)).json.integrity;
    const r = await t.post(`${c}/objectives/suggest`, {});
    assert.deepEqual([r.status, r.json.code], [502, code], JSON.stringify(reply));
    assert.deepEqual((await t.get(c)).json.integrity, before, "nothing recorded");
  }
});

test("no worker configured: 501; GET is 405; the outline must be confirmed first", async () => {
  const none = await boot(three, { withWorker: false });
  const nc = await atObjectives(none);
  assert.equal((await none.post(`${nc}/objectives/suggest`, {})).status, 501);
  const t = await boot(three);
  const c = await atObjectives(t);
  assert.equal((await t.get(`${c}/objectives/suggest`)).status, 405);
  const { json: { courseId } } = await t.post("/api/courses", { owner: "teacher:tk-1", title: "early" });
  const early = await t.post(`/api/courses/${courseId}/objectives/suggest`, {});
  assert.equal(early.status, 409);
  assert.ok(["NO_TEACHER_OUTCOMES", "CHECKPOINT_ORDER"].includes(early.json.code), early.json.code);
});

test("suggestions carry their label in the view and the hash-chained log still verifies", async () => {
  const t = await boot(three);
  const c = await atObjectives(t);
  await t.post(`${c}/objectives/suggest`, {});
  const view = (await t.get(c)).json;
  assert.equal(view.proposals.filter((p) => p.source === SOURCE_SUGGESTED).length, 3);
  assert.equal((await t.get(`${c}/verify`)).json.ok, true);
});
