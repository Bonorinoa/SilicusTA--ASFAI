// N6V probe: run one deterministic course (wizard-typed objective + two-field plan edit + publish) through
// the real Node host (createApp over HTTP) of ANY tree, and dump the on-disk log, meta and API views.
// usage: node n6v_run_course.mjs <tree-root> <out.json>
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.argv[2]);
const OUT = resolve(process.argv[3]);
crypto.randomUUID = (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })();
syncBuiltinESMExports();
Date.now = () => 1767225600000;
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { createApp } = await imp("host/server.mjs");
const { PlanWorker } = await imp("host/worker.mjs");
const { chatCompletion } = await imp("host/test/scripted-course.mjs");

const fakeModel = async (_u, init) => new Response(JSON.stringify(chatCompletion(JSON.parse(init.body))), { status: 200, headers: { "content-type": "application/json" } });
const noAsfai = { status: () => ({ connected: false }), runIntake: async () => { throw Object.assign(new Error("off"), { code: "OFF" }); }, validate: async () => null };
const dir = mkdtempSync(join(tmpdir(), "n6v-"));
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: "http://127.0.0.1:9/v1/chat/completions", model: "m", fetchImpl: fakeModel }), sources: [], asfai: noAsfai });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json() };
};
const tr = [];
const step = async (...a) => { const r = await call(...a); if (r.status >= 400) console.log("HTTP", r.status, a[1].replace(/urn[^/]*/, "ID"), JSON.stringify(r.json).slice(0, 200)); tr.push({ m: a[0], p: a[1].replace(/urn[^/]*/, "ID"), s: r.status }); return r; };
try {
  const created = await step("POST", "/api/courses", { owner: "Ada Lovelace", title: "N6V course" });
  const c = `/api/courses/${encodeURIComponent(created.json.courseId)}`;
  await step("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the empty material list." });
  await step("POST", `${c}/intake/answer`, { text: "Brief.", answers: { topic: "photosynthesis", course: "Science, ages 8-10", learning_outcomes: "Students can explain how a plant makes food." } });
  await step("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const proposed = await step("POST", `${c}/objectives`, {});
  await step("POST", `${c}/decisions`, { text: "Accept.", decisions: proposed.json.proposals.map((p) => ({ verb: "accept", proposalId: p.id })) });
  const drafted = await step("POST", `${c}/plan`, {});
  if (process.env.N6V_EDIT !== "0") {
    await step("POST", `${c}/plan/edit`, { planId: drafted.json.id, text: "Edit the plan.", edits: [{ path: "title", value: "Plants make food" }, { path: "activities.0.decisionAfterHelp", value: "Each child says which guess they keep, and why." }] });
  }
  await step("POST", `${c}/plan/confirm`, { text: "Confirm the lesson plan." });
  await step("POST", `${c}/publish`, { text: "Publish." });
  const exp = await step("GET", `${c}/export`);
  const ver = await step("GET", `${c}/verify`);
  const anc = await step("GET", `${c}/anchor/1`);
  const slug = readdirSync(dir).find((n) => n.startsWith("urn"));
  const lines = readFileSync(join(dir, slug, "events.ndjson"), "utf8").split("\n").filter(Boolean);
  const meta = readFileSync(join(dir, slug, "meta.json"), "utf8");
  writeFileSync(OUT, JSON.stringify({ root: ROOT, tr, lines, meta, export: exp.json, verify: ver.json, anchor: anc.json, courseId: created.json.courseId }, null, 1));
  console.log("wrote", OUT, "events", lines.length, "statuses", tr.map((t) => t.s).join(","));
} finally { app.closeAllConnections?.(); app.close(); rmSync(dir, { recursive: true, force: true }); }
