/**
 * N1V item 3 probe (no paid call, no network). Usage: node n1v-reasoning-probe.mjs <tree-root>
 *  A. Node host: the five PlanWorker methods, request bodies captured by a stand-in fetch.
 *  B. Site: what the browser host sends (sendTask:true) goes through the REAL /api/worker handler
 *     (createWorkerHandler) with a stand-in upstream; hostile client bodies try to set reasoning.
 *  C. Real deadlines: a fetch that never answers; rank must end at ~25 s, answer at ~20 s, with WORKER_TIMEOUT.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2] || ".");
const W = await import(pathToFileURL(path.join(root, "host/worker.mjs")).href);
const A = await import(pathToFileURL(path.join(root, "api/_lib/worker.mjs")).href);
let bad = 0;
const check = (name, ok, detail = "") => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const ok = (content) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });
const mk = (extra = {}) => { const seen = []; const fetchImpl = async (u, init) => { seen.push(JSON.parse(init.body)); return ok({ objectives: [], threads: [], kind: "off_topic", answer: "", cites: [] }); }; return { seen, w: new W.PlanWorker({ url: "https://w.example/v1", model: "m", reasoning: "low", fetchImpl, log: () => {}, ...extra }) }; };
const calls = {
  rank: (w) => w.rankMap({ title: "t", goal: "g", ages: { min: 8, max: 9 }, topics: [] }),
  answer: (w) => w.answerStudent({ question: "q", items: [{ id: "objective:1", label: "Objective 1", text: "t" }] }).catch(() => {}),
  objectives: (w) => w.draftObjectives({ materials: [{ name: "n", text: "x".repeat(200) }] }).catch(() => {}),
  suggest: (w) => w.suggestObjectives({ topic: "t", course: "c" }).catch(() => {}),
  plan: (w) => w.draft({ objectives: ["Students can name a thing."], topic: "t" }).catch(() => {}),
};
const expected = { rank: { enabled: false }, answer: { enabled: false }, objectives: { effort: "low" }, suggest: { effort: "low" }, plan: { effort: "low" } };

console.log("== A. Node host request bodies (configured reasoning = low)");
for (const [task, call] of Object.entries(calls)) {
  const { seen, w } = mk(); await call(w);
  check(`A ${task}: upstream reasoning = ${JSON.stringify(expected[task])}`, seen.length === 1 && JSON.stringify(seen[0].reasoning) === JSON.stringify(expected[task]) && seen[0].task === undefined, `got ${JSON.stringify(seen[0]?.reasoning)} task=${seen[0]?.task}`);
}

console.log("== B. Site: browser-host bodies through the real /api/worker handler");
const env = { OPENROUTER_API_KEY: "sk-test-not-real", SILICUS_WORKER_MODEL: "m", SILICUS_DEMO_PASSCODE: "pw" };
const upstream = [];
const fetchImpl = async (u, init) => { upstream.push({ url: String(u), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200, headers: { "content-type": "application/json" } }); };
const { POST } = A.createWorkerHandler({ env, fetchImpl });
const viaSite = async (body) => { upstream.length = 0; const r = await POST(new Request("https://app.example/api/worker", { method: "POST", headers: { "content-type": "application/json", "x-silicus-passcode": "pw", "x-forwarded-for": "198.51.100." + Math.floor(Math.random() * 200) }, body: JSON.stringify(body) })); return { status: r.status, up: upstream[0]?.body }; };
for (const task of Object.keys(calls)) {
  // what the real browser-host client puts on the wire: capture it from a PlanWorker with sendTask:true, forward it verbatim
  const cap = []; const fi = async (u, init) => { cap.push(JSON.parse(init.body)); return ok({}); };
  const w = new W.PlanWorker({ url: "https://s.example/api/worker", model: "m", reasoning: "low", sendTask: true, fetchImpl: fi, log: () => {} });
  await calls[task](w);
  const wire = cap[0];
  const r = await viaSite(wire);
  check(`B ${task}: client sent task=${wire.task}; Vercel upstream reasoning = ${JSON.stringify(expected[task])}`, r.status === 200 && wire.task === task && JSON.stringify(r.up.reasoning) === JSON.stringify(expected[task]) && r.up.task === undefined, `status ${r.status}, upstream ${JSON.stringify(r.up?.reasoning)}`);
}
// Hostile: the client tries every way to set reasoning itself.
const m = [{ role: "user", content: "x" }];
const attacks = [
  ["reasoning high + task plan", { messages: m, task: "plan", reasoning: { effort: "high" } }, { effort: "low" }],
  ["reasoning high, no task", { messages: m, reasoning: { effort: "high" } }, { effort: "low" }],
  ["reasoning on + task rank", { messages: m, task: "rank", reasoning: { effort: "high" } }, { enabled: false }],
  ["reasoning_effort top-level", { messages: m, task: "plan", reasoning_effort: "high" }, { effort: "low" }],
  ["task as object", { messages: m, task: { toString: "rank" } }, { effort: "low" }],
  ["task __proto__", { messages: m, task: "__proto__" }, { effort: "low" }],
  ["task constructor", { messages: m, task: "constructor" }, { effort: "low" }],
  ["task hasOwnProperty", { messages: m, task: "hasOwnProperty" }, { effort: "low" }],
  ["task array", { messages: m, task: ["rank"] }, { effort: "low" }],
  ["task 'RANK' upper", { messages: m, task: "RANK" }, { effort: "low" }],
  ["extra keys (provider, max_tokens)", { messages: m, task: "plan", provider: { zdr: false }, max_tokens: 99999 }, { effort: "low" }],
];
for (const [name, body, want] of attacks) {
  const r = await viaSite(body);
  const good = r.status === 200 && JSON.stringify(r.up.reasoning) === JSON.stringify(want) && !("reasoning_effort" in r.up) && r.up.task === undefined && r.up.max_tokens === 16000 && r.up.provider?.zdr === true;
  check(`B hostile: ${name} -> reasoning ${JSON.stringify(want)}, task/provider/max_tokens not client-controlled`, good, `status ${r.status} upstream reasoning ${JSON.stringify(r.up?.reasoning)} max_tokens ${r.up?.max_tokens} zdr ${r.up?.provider?.zdr}`);
}
console.log("  note: the client CAN lower reasoning for itself by naming task=rank|answer (off); it cannot raise it above the configured default.");

console.log("== C. Real deadlines (a fetch that never answers)");
const hang = (_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
const keep = setInterval(() => {}, 1000);
const timed = async (task) => { const w = new W.PlanWorker({ url: "https://w.example/v1", model: "m", timeoutMs: 120000, fetchImpl: hang, log: () => {} }); const t0 = Date.now(); const e = await calls[task](w).then(() => null, (x) => x); return { ms: Date.now() - t0, code: e?.code }; };
const [r1, r2] = await Promise.all([timed("rank"), timed("answer")]);
clearInterval(keep);
check("C rank ends at about 25 s with WORKER_TIMEOUT", r1.code === "WORKER_TIMEOUT" && r1.ms >= 24500 && r1.ms <= 27000, `${r1.ms} ms ${r1.code}`);
const w2 = new W.PlanWorker({ url: "https://w.example/v1", model: "m", timeoutMs: 120000, fetchImpl: hang, log: () => {} });
const k2 = setInterval(() => {}, 1000);
const t0 = Date.now();
const e2 = await w2.answerStudent({ question: "q", items: [{ id: "objective:1", label: "O", text: "t" }] }).then(() => null, (x) => x);
clearInterval(k2);
const ms2 = Date.now() - t0;
check("C answer ends at about 20 s with WORKER_TIMEOUT", e2?.code === "WORKER_TIMEOUT" && ms2 >= 19500 && ms2 <= 22000, `${ms2} ms ${e2?.code}`);
console.log(bad === 0 ? "ALL PASS" : `${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
