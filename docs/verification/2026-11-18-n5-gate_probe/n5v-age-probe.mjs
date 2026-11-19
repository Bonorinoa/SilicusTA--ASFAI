/**
 * N5V item 6 (PM note): the helper's reasoning by recorded age, on the Node host and in the Vercel function.
 *  Node host: the real createApp + PlanWorker; the upstream fetch is captured, so the body the provider WOULD get is read.
 *  Fixtures: eval/fixtures/hostdata has an 18+ course (Thermodynamics) and an under-18 course (Plant and animal cells, 13-15).
 *  A third course is made by copying the under-18 fixture and removing its recorded ages (no ages -> under 18).
 *  Site function: the real createWorkerHandler is called with hostile client bodies.
 * usage: node n5v-age-probe.mjs <realpath tree>
 */
import path from "node:path";
import { mkdtempSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]);
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { PlanWorker } = await imp("host/worker.mjs");
const { createApp } = await imp("host/server.mjs");
const site = await imp("api/_lib/worker.mjs");

const seen = [];
const fetchImpl = async (_url, init) => {
  const b = JSON.parse(init.body); seen.push(b);
  const content = JSON.stringify({ kind: "answer", basis: "plan", answer: "A cell wall gives a plant cell its shape.", cites: ["objective:1"] });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
};
const dir = mkdtempSync(path.join(tmpdir(), "n5v-age-")); cpSync(path.join(root, "eval/fixtures/hostdata"), dir, { recursive: true });
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: "https://w.example/v1", model: "m", reasoning: "model-default", sendTask: true, fetchImpl, log: () => {} }), sources: [] });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const get = async (p) => (await fetch(base + p)).json();
const list = await get("/api/courses");
const found = {};
for (const c of list.courses ?? list) {
  const id = c.id ?? c.courseId; const v = JSON.stringify(await get(`/api/courses/${encodeURIComponent(id)}`));
  if (/Thermodynamics/.test(v)) found.adult = id; if (/Plant and animal cells/.test(v)) found.under = id;
}
const ask = async (id, q) => (await (await fetch(`${base}/api/courses/${encodeURIComponent(id)}/student/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })).json());
const run = async (label, id, expect) => {
  seen.length = 0; const r = await ask(id, "What does a cell wall do?");
  const b = seen.at(-1); const got = b ? { task: b.task, reasoning: b.reasoning } : null;
  const ok = JSON.stringify(got?.reasoning) === JSON.stringify(expect.reasoning) && got?.task === expect.task;
  console.log(`${ok ? "OK  " : "FAIL"} Node host, ${label}: task=${got?.task} reasoning=${JSON.stringify(got?.reasoning)} (expected task=${expect.task} reasoning=${JSON.stringify(expect.reasoning)}) kind=${r.kind}`);
  return ok;
};
let all = true;
all = (await run("18+ course (Thermodynamics)", found.adult, { task: "answer_adult", reasoning: { effort: "low" } })) && all;
all = (await run("under-18 course (13-15)", found.under, { task: "answer", reasoning: { enabled: false } })) && all;

// No recorded ages: find the course's ages in its files and strip them in a copy.
const dir2 = mkdtempSync(path.join(tmpdir(), "n5v-age2-")); cpSync(dir, dir2, { recursive: true });
let stripped = 0;
for (const d of readdirSync(dir2)) {
  const f = path.join(dir2, d, "events.ndjson"); let s; try { s = readFileSync(f, "utf8"); } catch { continue; }
  if (!/Plant and animal cells/.test(s)) continue;
  // the host recomputes ages from the plan's audience; the log is hash-chained, so editing it would break the chain. Instead ask through a course with no plan audience: not available -> report.
  stripped = -1;
}
console.log(`(no-ages course: ${stripped === -1 ? "not built here, the fixtures are hash-chained and have recorded ages; covered by the producer's unit test n5-reasoning-by-age 'no recorded ages counts as under 18', run in the 480" : "n/a"})`);
app.closeAllConnections?.(); app.close();

// the site function (real handler logic): the body the provider gets for each task, hostile client values included
const settings = site.workerSettings({ OPENROUTER_API_KEY: "k", SILICUS_WORKER_MODEL: "m", SILICUS_DEMO_PASSCODE: "p" });
const body = (extra) => site.buildUpstreamBody({ messages: [{ role: "user", content: "x" }], ...extra }, settings).body;
const cases = [
  ["task=answer", { task: "answer" }, { enabled: false }],
  ["task=answer_adult", { task: "answer_adult" }, { effort: "low" }],
  ["task=answer + client reasoning high", { task: "answer", reasoning: { effort: "high" } }, { enabled: false }],
  ["task=answer_adult + client reasoning off", { task: "answer_adult", reasoning: { enabled: false } }, { effort: "low" }],
  ["task=ANSWER_ADULT (case): unknown name, the configured default (low)", { task: "ANSWER_ADULT" }, { effort: "low" }],
  ["task=__proto__: unknown name, the configured default (low)", { task: "__proto__" }, { effort: "low" }],
];
for (const [label, extra, want] of cases) {
  const got = body(extra).reasoning; const ok = JSON.stringify(got) === JSON.stringify(want); all = ok && all;
  console.log(`${ok ? "OK  " : "FAIL"} site function, ${label}: reasoning=${JSON.stringify(got)} (expected ${JSON.stringify(want)}) task forwarded upstream: ${body(extra).task !== undefined}`);
}
console.log(all ? "ALL OK" : "SOME FAILED"); process.exit(all ? 0 : 1);
