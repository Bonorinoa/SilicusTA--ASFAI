// HV probe (verifier's own). Run from the clean export root: node <this> <exportRoot>
import { pathToFileURL } from "node:url";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.argv[2];
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const out = []; let bad = 0;
const check = (name, ok, detail = "") => { out.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`); if (!ok) bad++; };

const hw = await imp("host/worker.mjs");
const aw = await imp("api/_lib/worker.mjs");
const ages = await imp("host/ages.mjs");

// ---- cap, host: capture the request body the PlanWorker really sends
async function hostCap(maxTokens) {
  let seen;
  const fetchImpl = async (_u, o) => { seen = JSON.parse(o.body); return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } }); };
  const w = new hw.PlanWorker({ url: "https://worker.example/v1/chat/completions", model: "m", fetchImpl, ...(maxTokens === undefined ? {} : { maxTokens }) });
  try { await w.draft({ objectives: [{ id: "urn:uuid:11111111-1111-4111-8111-111111111111", statement: "s" }] }); } catch {}
  return seen?.max_tokens;
}
for (const [inp, want] of [[undefined, 16000], [20000, 20000], [32000, 32000], [32001, 32000], [65536, 32000], [0, 16000], [-5, 16000], [1.5, 16000], ["9", 16000]]) {
  const got = await hostCap(inp);
  check(`host cap input=${String(inp)} -> ${want}`, got === want, `got ${got}`);
}
check("host constants", hw.DEFAULT_MAX_TOKENS === 16000 && hw.MAX_TOKENS_CEILING === 32000);

// ---- cap, api: the real handler's upstream body
const H = await imp("api/test/helpers.mjs");
async function apiCap(envOver) {
  const up = H.upstream();
  const { POST } = aw.createWorkerHandler({ env: H.baseEnv(envOver), fetchImpl: up.fetchImpl });
  const r = await H.read(await POST(H.post(H.WORKER_URL, { messages: [{ role: "user", content: "hi" }], max_tokens: 99999 })));
  return { status: r.status, mt: up.calls[0]?.body?.max_tokens };
}
for (const [env, want] of [[{}, 16000], [{ SILICUS_WORKER_MAX_TOKENS: "20000" }, 20000], [{ SILICUS_WORKER_MAX_TOKENS: "32000" }, 32000], [{ SILICUS_WORKER_MAX_TOKENS: "65536" }, 32000], [{ SILICUS_WORKER_MAX_TOKENS: "junk" }, 16000], [{ SILICUS_WORKER_MAX_TOKENS: "500" }, 500]]) {
  const r = await apiCap(env);
  check(`api cap env=${JSON.stringify(env)} (client sends 99999) -> ${want}`, r.mt === want, `status ${r.status} got ${r.mt}`);
}
check("api constants", aw.DEFAULT_MAX_TOKENS === 16000 && aw.MAX_TOKENS_CEILING === 32000 && aw.UPSTREAM_TIMEOUT_MS === 115000);

// ---- clamps through the real PlanWorker.draft (fake model reply)
const OBJ = [{ id: "urn:uuid:11111111-1111-4111-8111-111111111111", statement: "Students can do a thing." }];
async function draft(agesIn, acts, extra = {}) {
  const spec = { title: "T", activities: acts.map((a, i) => ({ title: `A${i}`, minutes: 10, objectiveIds: [OBJ[0].id], learnerDoes: "L", teacherDoes: "T", ...a })), ...extra };
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(spec) }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
  const w = new hw.PlanWorker({ url: "https://worker.example/v1/chat/completions", model: "m", fetchImpl });
  return w.draft({ objectives: OBJ, ages: agesIn });
}
const S1 = { min: 5, max: 7 }, S2 = { min: 9, max: 11 }, S3 = { min: 12, max: 14 }, S4 = { min: 16, max: 18 };
check("stage map", ages.stageForAges(S1) === 1 && ages.stageForAges(S2) === 2 && ages.stageForAges(S3) === 3 && ages.stageForAges(S4) === 4);
const has = (spec, re) => (spec.notes ?? []).some((n) => re.test(n));
// stage-3 rule
let s = await draft(S3, [{ aiStatus: "permitted", noAiAlternative: "x" }]);
check("S3 permitted + no first try -> forbidden + note", s.activities[0].aiStatus === "forbidden" && has(s, /"permitted" clamped to "forbidden"/), JSON.stringify(s.notes));
s = await draft(S3, [{ aiStatus: "permitted", noAiAlternative: "x", learnerFirst: "predict" }]);
check("S3 permitted + first try -> stays permitted, no clamp note", s.activities[0].aiStatus === "permitted" && !has(s, /clamped/), JSON.stringify(s.notes));
s = await draft(S3, [{ aiStatus: "required", noAiAlternative: "x", learnerFirst: "predict" }]);
check("S3 required + first try -> permitted", s.activities[0].aiStatus === "permitted" && has(s, /"required" clamped to "permitted"/), JSON.stringify(s.notes));
s = await draft(S3, [{ aiStatus: "required", noAiAlternative: "x" }]);
check("S3 required + no first try -> forbidden (two notes)", s.activities[0].aiStatus === "forbidden" && (s.notes ?? []).length >= 2, JSON.stringify(s.notes));
s = await draft(S4, [{ aiStatus: "permitted", noAiAlternative: "x" }]);
check("S4 permitted + no first try -> NOT clamped (rule is stage 3 only)", s.activities[0].aiStatus === "permitted", JSON.stringify(s.notes));
s = await draft(S1, [{ aiStatus: "permitted", noAiAlternative: "x", learnerFirst: "p" }]);
check("S1 permitted -> forbidden", s.activities[0].aiStatus === "forbidden" && has(s, /clamped to "forbidden"/));
s = await draft(S2, [{ aiStatus: "required", noAiAlternative: "x" }]);
check("S2 required -> permitted", s.activities[0].aiStatus === "permitted" && has(s, /"required" clamped to "permitted"/));
// helpAfter ai
for (const [name, st, dropped] of [["S1", S1, true], ["S2", S2, true], ["S3", S3, false], ["S4", S4, false], ["no-ages", null, false]]) {
  s = await draft(st, [{ helpAfter: "ai", learnerFirst: "p" }]);
  const gone = s.activities[0].helpAfter === undefined;
  check(`helpAfter "ai" at ${name}: ${dropped ? "dropped + note" : "kept"}`, dropped ? gone && has(s, /dropped helpAfter "ai"/) : !gone, JSON.stringify(s.notes));
}
// operationDoneBy ai at every stage
for (const [name, st] of [["S1", S1], ["S2", S2], ["S3", S3], ["S4", S4], ["no-ages", null]]) {
  s = await draft(st, [{ operationDoneBy: "ai" }]);
  check(`operationDoneBy "ai" noted at ${name}`, has(s, /operationDoneBy "ai"/), JSON.stringify(s.notes));
}
// notes bounded: hostile long model strings echoed in notes
const BIG = "Z".repeat(5000);
s = await draft(S1, [{ aiStatus: BIG, helpAfter: BIG, operationDoneBy: BIG, channels: [BIG, "talk"], phase: BIG, session: BIG }], { sessions: [{ session: 1, evidence: [BIG] }] }).catch((e) => ({ err: e.message }));
if (s.err) check("notes bounded (hostile strings)", false, s.err.slice(0, 200));
else {
  const max = Math.max(0, ...(s.notes ?? []).map((n) => n.length));
  check("notes bounded: longest note <= 400 chars with 5,000-char model strings", (s.notes ?? []).length > 0 && max <= 400, `notes=${(s.notes ?? []).length} longest=${max}`);
}
// aiStatus echo for stage-1 clamp with long invalid-but-listed value
s = await draft(S1, [{ aiStatus: "permitted" }]);
check("S1 note length small", Math.max(...s.notes.map((n) => n.length)) < 300);

// ---- anchor / ages refusal over HTTP (real app, real snapshot)
const { createApp } = await imp("host/server.mjs");
const { createMarbleService } = await imp("host/marble/marble-graph.mjs");
const marble = createMarbleService(async () => readFileSync(join(root, "host/data/marble/marble-snapshot.json"), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "hv-probe-"));
const app = createApp({ dataDir: dir, sources: [], marble });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const post = async (body) => { const r = await fetch(base + "/api/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const A = "mt_AzTrT5ySCx";
let r = await post({ owner: "teacher:t", title: "T", ages: { min: 5, max: 12 }, marbleAnchor: A });
check("anchor + overlapping ages -> 201", r.status === 201, JSON.stringify(r.json).slice(0, 120));
r = await post({ owner: "teacher:t", title: "T", ages: { min: 19, max: 22 }, marbleAnchor: A });
check("anchor + non-overlapping ages (19-22) -> 400 BAD_ANCHOR", r.status === 400 && r.json.code === "BAD_ANCHOR", `${r.status} ${r.json.code} ${r.json.message}`);
for (const bad of [123, { a: 1 }, [A], true]) {
  r = await post({ owner: "teacher:t", title: "T", ages: { min: 5, max: 12 }, marbleAnchor: bad });
  check(`non-string marbleAnchor ${JSON.stringify(bad)} -> 400 BAD_ANCHOR`, r.status === 400 && r.json.code === "BAD_ANCHOR", `${r.status} ${r.json.code}`);
}
r = await post({ owner: "teacher:t", title: "T", ages: { min: 5, max: 12 }, marbleAnchor: null });
check("null marbleAnchor stays absent -> 201", r.status === 201, String(r.status));
r = await post({ owner: "teacher:t", title: "T", ages: { min: 5, max: 12 }, marbleAnchor: "mt_GHOST" });
check("ghost anchor -> 400 UNKNOWN_ANCHOR", r.status === 400 && r.json.code === "UNKNOWN_ANCHOR");
app.closeAllConnections?.(); app.close();

console.log(out.join("\n")); console.log(`\nFAILS=${bad} of ${out.length}`);
process.exit(bad ? 1 : 0);
