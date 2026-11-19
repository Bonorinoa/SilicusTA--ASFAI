/**
 * n5-reasoning-by-age.test.mjs — N5 resume (a), PM decision on item 6 (18 Nov): the helper's reasoning follows the
 * course's recorded ages, the same switch N4 uses (adultCourse). Under 18, or no ages: reasoning OFF (with the clarify
 * prompt rule). 18+: reasoning LOW (every eval bar passed at low). The answer task's 20 s deadline holds for both.
 * The site's function reads the task NAME and applies the shared table; a client still cannot send a reasoning value.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PlanWorker } from "../worker.mjs";
import { TASK_REASONING, TASK_TIMEOUT_MS, TASKS, taskReasoning, answerTask } from "../worker-config.mjs";
import { adultCourse } from "../student.mjs";
import { buildUpstreamBody, workerSettings } from "../../api/_lib/worker.mjs";

const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });
function capture(opts = {}) {
  const seen = [];
  const fetchImpl = async (_url, init) => { seen.push({ body: JSON.parse(init.body), init }); return reply({ kind: "answer", answer: "x", cites: ["objective:1"] }); };
  return { seen, worker: new PlanWorker({ url: "https://w.example/v1", model: "m", reasoning: "model-default", fetchImpl, log: () => {}, ...opts }) };
}
const items = [{ id: "objective:1", label: "Objective 1", text: "t" }];

test("the table: answer (under 18) off, answer_adult (18+) low, both with the 20 s deadline", () => {
  assert.equal(TASK_REASONING.answer, "off");
  assert.equal(TASK_REASONING.answer_adult, "low");
  assert.equal(TASK_TIMEOUT_MS.answer, 20_000);
  assert.equal(TASK_TIMEOUT_MS.answer_adult, 20_000);
  assert.ok(TASKS.includes("answer_adult"));
  assert.equal(answerTask(true), "answer_adult");
  assert.equal(answerTask(false), "answer");
  assert.equal(answerTask("yes"), "answer", "only a strict true is the adult course");
});

test("under 18 (youngest 15): the helper call runs reasoning off, task 'answer'", async () => {
  const pkg = { minAge: 15 };
  assert.equal(adultCourse(pkg), false);
  const c = capture({ sendTask: true });
  await c.worker.answerStudent({ question: "q", items, adult: adultCourse(pkg) }).catch(() => {});
  assert.deepEqual(c.seen[0].body.reasoning, { enabled: false });
  assert.equal(c.seen[0].body.task, "answer");
  assert.equal(c.seen[0].init.silicusDeadlineMs, 20_000);
});

test("no recorded ages counts as under 18: reasoning off", async () => {
  const pkg = { minAge: null };
  assert.equal(adultCourse(pkg), false);
  const c = capture();
  await c.worker.answerStudent({ question: "q", items, adult: adultCourse(pkg) }).catch(() => {});
  assert.deepEqual(c.seen[0].body.reasoning, { enabled: false });
});

test("18+ (youngest 18): the helper call runs reasoning low, task 'answer_adult', same 20 s deadline", async () => {
  const pkg = { minAge: 18 };
  assert.equal(adultCourse(pkg), true);
  const c = capture({ sendTask: true });
  await c.worker.answerStudent({ question: "q", items, adult: adultCourse(pkg) }).catch(() => {});
  assert.deepEqual(c.seen[0].body.reasoning, { effort: "low" });
  assert.equal(c.seen[0].body.task, "answer_adult");
  assert.equal(c.seen[0].init.silicusDeadlineMs, 20_000);
});

test("the site's function applies the same table from the task name; a client reasoning is dropped", () => {
  const settings = workerSettings({ OPENROUTER_API_KEY: "k", SILICUS_WORKER_MODEL: "m", SILICUS_DEMO_PASSCODE: "p" });
  const of = (extra) => buildUpstreamBody({ messages: [{ role: "user", content: "x" }], ...extra }, settings).body;
  assert.deepEqual(of({ task: "answer" }).reasoning, { enabled: false });
  assert.deepEqual(of({ task: "answer_adult" }).reasoning, { effort: "low" });
  assert.deepEqual(of({ task: "answer", reasoning: { effort: "high" } }).reasoning, { enabled: false }, "the client cannot set reasoning");
  assert.equal(of({ task: "answer_adult" }).task, undefined, "the task name is not forwarded upstream");
  assert.equal(taskReasoning("answer_adult", "off"), "low");
});
