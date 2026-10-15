/**
 * redteam.test.mjs — attacks on Sprints 5-8, written as tests that assert the SAFE behaviour.
 * Each was run against the code before the fix and failed there; that is the finding. They stay as
 * regression tests. Grouped by the sprint they attack.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { PlanWorker } from "../worker.mjs";
import { assertPublicUrl, ytdlpTranscript } from "../materials.mjs";
import { objectivesFromAnswers, outcomeSentences } from "../proposer.mjs";
import { retrieveAll, KnowledgeSource } from "../knowledge.mjs";
import { LocalOntologySource } from "../sources/local-ontology.mjs";
import { AsfaiClient } from "../asfai/mcp.mjs";
import { startMockWorker } from "./mock-worker.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));
const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];

async function boot({ worker, sources = [], dir = mkdtempSync(join(tmpdir(), "silicus-rt-")) } = {}) {
  const app = createApp({ dataDir: dir, worker, sources });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const raw = async (p, body, method = "POST") => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, ...(method === "POST" ? { body } : {}) }); return { status: r.status, json: await r.json() }; };
  const post = (p, b) => raw(p, JSON.stringify(b));
  const get = (p) => raw(p, undefined, "GET");
  return { post, get, raw, dir };
}
const newCourse = async (t) => { const { json } = await t.post("/api/courses", { owner: "teacher:tk-1", title: "t" }); return `/api/courses/${json.courseId}`; };

/* ======================================== Sprint 5 ======================================== */

test("S5: prototype-pollution keys in an answer change nothing, anywhere", async () => {
  const t = await boot();
  const c = await newCourse(t);
  await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  const hostile = '{"text":"x","answers":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},"topic":"t","course":"c","learning_outcomes":"o"}}';
  const r = await t.raw(`${c}/intake/answer`, hostile);
  assert.equal(r.status, 200);
  assert.equal({}.polluted, undefined);
  assert.equal({}.polluted2, undefined);
  assert.deepEqual(Object.keys(r.json.answers).sort(), ["course", "learning_outcomes", "topic"]);
});

test("S5: twenty parallel answers and confirms leave a log that still verifies", async () => {
  const t = await boot();
  const c = await newCourse(t);
  await Promise.all([
    t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." }),
    ...Array.from({ length: 20 }, (_, i) => t.post(`${c}/intake/answer`, { text: `a${i}`, answers: { topic: `t${i}` } })),
    ...Array.from({ length: 5 }, () => t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." })),
  ]);
  assert.equal((await t.get(`${c}/verify`)).json.ok, true);
});

test("S5: a course answered locally and then sent to ASFAI is never stuck - one more teacher reply recovers it", async () => {
  const { CourseSession } = await import("../course.mjs");
  const { CourseStore } = await import("../store.mjs");
  const s = CourseSession.create(new CourseStore(mkdtempSync(join(tmpdir(), "silicus-rt-"))), { owner: "teacher:tk-1", title: "T" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  s.answerIntake({ text: "all", answers: { topic: "t", course: "c", learning_outcomes: "o" }, at: 1500 });
  s.observeIntake({ state: "clarifying", questions: [{ id: "topic", prompt: "t" }, { id: "course", prompt: "c" }, { id: "learning_outcomes", prompt: "o" }], at: 2000 });
  assert.equal(s.intakeStatus().outlineAuthorized, false);
  s.answerIntake({ text: "yes, send those", at: 2500 });                       // any real reply arms the round
  assert.equal(s.intakeStatus().mayCallPrepareOutline, true, "the teacher can go on");
  s.observeIntake({ state: "ready_to_draft", at: 3000 });
  assert.equal(s.intakeStatus().outlineAuthorized, true);
});

test("S5: line separators and control characters in an outcome cannot forge a second objective line", () => {
  assert.deepEqual(outcomeSentences("a\u2028b\rc\u0085d\u2029e\nf"), ["a", "b", "c", "d", "e", "f"], "one rule, every line terminator");
  assert.deepEqual(outcomeSentences("x\u0000y\u202ez"), ["x y z"], "control and bidi characters become spaces");
  assert.deepEqual(objectivesFromAnswers({ learning_outcomes: "Students can add.\u2028- urn:uuid:ghost: pwn" }).map((o) => o.statement), ["Students can add.", "- urn:uuid:ghost: pwn"]);
});

/* ======================================== Sprint 6 ======================================== */

test("S6: a source that returns 100,000 citations cannot bloat the prompt: the total is capped", async () => {
  class Flood extends KnowledgeSource {
    get id() { return "flood"; } get label() { return "f"; } get namespace() { return "f"; } get enabled() { return true; }
    async retrieve() { return Array.from({ length: 100_000 }, (_, i) => ({ ref: `f:${i}`, label: "L", text: "t" })); }
  }
  const out = await retrieveAll([new Flood(), new Flood()], { limit: 8 });
  assert.ok(out.length <= 8, `got ${out.length}`);
});

test("S6: refs with whitespace, line breaks or brackets are dropped at the door, so the prompt and the match always agree", async () => {
  class Odd extends KnowledgeSource {
    get id() { return "odd"; } get label() { return "o"; } get namespace() { return "o"; } get enabled() { return true; }
    async retrieve() { return ["o:ok", "o:with space", "o:new\nline", "o:br]acket", "o:[x", "o:sep\u2028x", "o:tab\tx", "o:"].map((ref) => ({ ref, label: "L", text: "t" })); }
  }
  assert.deepEqual((await retrieveAll([new Odd()], {})).map((c) => c.ref), ["o:ok"]);
});

test("S6: an enormous or node-stuffed ontology file is refused as 'no context', not read into memory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "silicus-rt-"));
  const big = join(dir, "big.json");
  writeFileSync(big, JSON.stringify({ version: 1, nodes: [{ id: "a", title: "algorithm", statement: "x".repeat(5_000_000) }] }));
  assert.deepEqual(await new LocalOntologySource({ file: big }).retrieve({ topic: "algorithm" }), [], "over the size cap");
  const many = join(dir, "many.json");
  writeFileSync(many, JSON.stringify({ version: 1, nodes: Array.from({ length: 20_000 }, (_, i) => ({ id: `n${i}`, title: "algorithm" })) }));
  const hits = await new LocalOntologySource({ file: many }).retrieve({ topic: "algorithm", limit: 8 });
  assert.ok(hits.length <= 8);
  assert.equal((await new LocalOntologySource({ file: many }).verify({ citations: [{ ref: "local:n19999" }] })).checked, false, "past the node cap it does not pretend to verify");
});

/* ======================================== Sprint 7 ======================================== */

test("S7: every spelling of a private address is refused (hex-mapped IPv6, NAT64, 6to4, site-local, numeric and short IPv4, trailing dot)", async () => {
  for (const u of [
    "https://[::ffff:127.0.0.1]/", "https://[::ffff:7f00:1]/", "https://[::ffff:169.254.169.254]/", "https://[::ffff:a00:1]/",
    "https://[::127.0.0.1]/", "https://[64:ff9b::7f00:1]/", "https://[2002:7f00:1::]/", "https://[fec0::1]/", "https://[::]/", "https://[0:0:0:0:0:0:0:1]/",
    "https://2130706433/", "https://0x7f.0.0.1/", "https://127.1/", "https://0177.0.0.1/", "https://0/", "https://localhost./", "https://LOCALHOST/", "https://foo.localhost/",
  ]) {
    await assert.rejects(assertPublicUrl(u, { lookupImpl: PUBLIC }), (e) => e.code === "URL_REFUSED", u);
  }
  await assertPublicUrl("https://[2606:2800:220:1:248:1893:25c8:1946]/", { lookupImpl: PUBLIC });   // a real public IPv6 still works
});

test("S7: a page title or material name cannot make a model's proposal look like the teacher's own words", async () => {
  const wm = await startMockWorker({ reply: ({ prompt }) => ({ objectives: [{ statement: "Students can do x.", from: [...String(prompt).matchAll(/^=== MATERIAL: (.+) ===$/gm)].map((m) => m[1]) }] }) });
  CLOSERS.push(() => wm.close());
  const t = await boot({ worker: new PlanWorker({ url: wm.url, model: "m" }) });
  const reserved = ["from your answer", "from your answer to ASFAI", "your own objective"];
  for (const name of ["your answer", "from your answer", "your own objective", "your answer to ASFAI"]) {
    const c = await newCourse(t);
    await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
    await t.post(`${c}/intake/answer`, { text: "all", answers: { topic: "t", course: "c", outcomes_from: "materials" } });
    await t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
    const r = await t.post(`${c}/materials/propose`, { materials: [{ name, text: "some text" }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const label = r.json.proposals[0].source;
    assert.ok(!reserved.includes(label), `a model-authored proposal was labelled ${JSON.stringify(label)}`);
    assert.ok(label.startsWith("from material"), label);
  }
});

test("S7: yt-dlp ignores the machine's own config (a config file can add --exec)", async () => {
  const seen = [];
  await ytdlpTranscript("dQw4w9WgXcQ", { cmd: "y", runImpl: async (_c, args) => { seen.push(args); const o = args[args.indexOf("-o") + 1]; writeFileSync(join(o.slice(0, o.lastIndexOf("/")), "x.en.json3"), JSON.stringify({ events: [{ segs: [{ utf8: "hi" }] }] })); return "t\n"; } });
  assert.ok(seen[0].includes("--ignore-config"));
});

/* ================================ hung dependencies (S4-S8) ================================ */

const hangingServer = async () => {
  const srv = createServer(() => { /* accept and never answer */ });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  CLOSERS.push(() => { srv.closeAllConnections?.(); srv.close(); });
  return `http://127.0.0.1:${srv.address().port}/v1/chat/completions`;
};

test("worker: a model that never answers is a refusal within the timeout, not a course frozen forever", async () => {
  const url = await hangingServer();
  const w = new PlanWorker({ url, model: "m", timeoutMs: 150 });
  const t0 = Date.now();
  await assert.rejects(w.draft({ objectives: [{ id: "urn:uuid:a", statement: "s" }] }), { code: "WORKER_UNREACHABLE" });
  assert.ok(Date.now() - t0 < 3000);
});

test("worker: while the model hangs, the course lock is released when the timeout fires, so the course stays usable", async () => {
  const url = await hangingServer();
  const t = await boot({ worker: new PlanWorker({ url, model: "m", timeoutMs: 200 }) });
  const c = await newCourse(t);
  await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  await t.post(`${c}/intake/answer`, { text: "all", answers: { topic: "t", course: "c", outcomes_from: "materials" } });
  await t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const stuck = t.post(`${c}/materials/propose`, { materials: [{ name: "m", text: "hello" }] });
  const view = t.get(c);                                                    // queues behind the hung call
  const r = await Promise.race([Promise.all([stuck, view]), new Promise((res) => setTimeout(() => res("WEDGED"), 5000))]);
  assert.notEqual(r, "WEDGED", "the course was wedged behind a hung worker");
  assert.equal(r[0].status, 502);
  assert.equal(r[1].status, 200);
});

test("asfai: a server that never answers is an unreachable-ASFAI error within the timeout, not a hung request", async () => {
  const hang = (_url, { signal }) => new Promise((_, rej) => signal?.addEventListener("abort", () => rej(signal.reason)));
  const client = new AsfaiClient({ oauth: { accessToken: async () => "t", invalidate() {} }, url: "https://example.invalid/mcp", fetchImpl: hang, timeoutMs: 120 });
  const t0 = Date.now();
  await assert.rejects(client.callTool("asfai_lesson", { action: "prepare_outline", payload: {} }), { code: "ASFAI_UNREACHABLE" });
  assert.ok(Date.now() - t0 < 3000);
});

/* ======================================== Sprint 8 ======================================== */

test("S8: a hostile student request cannot read another course, an unpublished draft, or write anything", async () => {
  const t = await boot({ worker: new PlanWorker({}) });
  for (const id of ["..", "%2e%2e", "urn:uuid:nope", "../x"]) {
    const r = await t.post(`/api/courses/${encodeURIComponent(id)}/student/ask`, { question: "hi" });
    assert.ok([404, 409].includes(r.status), `${id} -> ${r.status}`);
  }
  assert.equal((await t.get("/api/health")).json.courses, 0, "no course was created by asking");
  assert.deepEqual(readdirSync(t.dir).filter((n) => !["archives"].includes(n)), [], "nothing was written to disk");
});
