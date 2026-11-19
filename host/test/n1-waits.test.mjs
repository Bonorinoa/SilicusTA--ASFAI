/**
 * n1-waits.test.mjs — N1 item 3 (L1 finding 3): per-task reasoning and deadlines. Ranking the map and answering a
 * student run with reasoning OFF and their own deadlines (25 s, 20 s); objectives, suggestions and the plan keep the
 * configured default. A deadline that passes is WORKER_TIMEOUT, which the studio words kindly.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PlanWorker, WorkerError } from "../worker.mjs";
import { TASK_REASONING, TASK_TIMEOUT_MS, taskReasoning, taskTimeoutMs } from "../worker-config.mjs";

const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });

function capture(content, opts = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ body: JSON.parse(init.body), init }); return reply(content); };
  return { seen, worker: new PlanWorker({ url: "https://w.example/v1", model: "m", reasoning: "low", fetchImpl, log: () => {}, ...opts }) };
}

test("the policy table: rank and answer off with 25 s / 20 s; everything else keeps the configured value", () => {
  assert.deepEqual(TASK_REASONING, { rank: "off", answer: "off", answer_adult: "low" }); // N5: 18+ helper low
  assert.deepEqual(TASK_TIMEOUT_MS, { rank: 25_000, answer: 20_000, answer_adult: 20_000 });
  for (const t of ["objectives", "suggest", "plan", null, "bogus"]) assert.equal(taskReasoning(t, "low"), "low", String(t));
  assert.equal(taskTimeoutMs("rank", 120_000), 25_000);
  assert.equal(taskTimeoutMs("rank", 10_000), 10_000, "a shorter configured deadline still wins");
  assert.equal(taskTimeoutMs("plan", 120_000), 120_000);
});

test("rankMap sends reasoning off; draftObjectives keeps the configured low; the task name goes upstream only when asked", async () => {
  const a = capture({ threads: [] });
  await a.worker.rankMap({ title: "t", goal: "g", ages: { min: 8, max: 9 }, topics: [] });
  assert.deepEqual(a.seen[0].body.reasoning, { enabled: false });
  assert.equal(a.seen[0].body.task, undefined, "a direct provider never sees a task key");
  assert.equal(a.seen[0].init.silicusDeadlineMs, undefined);
  const b = capture({ objectives: [{ statement: "Students can name the phases.", from: ["M1"] }] });
  await b.worker.draftObjectives({ materials: [{ name: "n", text: "x" }] });
  assert.deepEqual(b.seen[0].body.reasoning, { effort: "low" });
  const c = capture({ threads: [] }, { sendTask: true });
  await c.worker.rankMap({ title: "t", goal: "g", ages: { min: 8, max: 9 }, topics: [] });
  assert.equal(c.seen[0].body.task, "rank");
  assert.equal(c.seen[0].init.silicusDeadlineMs, 25_000, "the site fetch is told the task's deadline");
});

test("answerStudent runs reasoning off with the 20 s deadline (sent to the site fetch)", async () => {
  const c = capture({ kind: "answer", answer: "x", cites: ["objective:1"] }, { sendTask: true });
  await c.worker.answerStudent({ question: "q", items: [{ id: "objective:1", label: "Objective 1", text: "t" }] }).catch(() => {});
  assert.deepEqual(c.seen[0].body.reasoning, { enabled: false });
  assert.equal(c.seen[0].body.task, "answer");
  assert.equal(c.seen[0].init.silicusDeadlineMs, 20_000);
});

test("a deadline that passes is WORKER_TIMEOUT, not 'unreachable'", async () => {
  const fetchImpl = (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const w = new PlanWorker({ url: "https://w.example/v1", model: "m", timeoutMs: 30, fetchImpl, log: () => {} });
  const keep = setTimeout(() => {}, 2000); // AbortSignal.timeout's timer is unref'd; hold the loop open
  after(() => clearTimeout(keep));
  await assert.rejects(w.rankMap({ title: "t", goal: "g", ages: { min: 8, max: 9 }, topics: [] }), (e) => e instanceof WorkerError && e.code === "WORKER_TIMEOUT");
});
