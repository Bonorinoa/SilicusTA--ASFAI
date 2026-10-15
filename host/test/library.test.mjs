/** The course library (non-AI) and the OpenRouter worker preset. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, workerFromEnv } from "../server.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "silicus-lib-"));
  const app = createApp({ dataDir: dir, sources: [] });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, json: await r.json() }; };
  return { dir, post, get };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("the library lists every course newest first, with honest progress and no content", async () => {
  const t = await boot();
  assert.deepEqual((await t.get("/api/courses")).json, { courses: [] });
  const a = (await t.post("/api/courses", { owner: "Ada", title: "First" })).json.courseId;
  await wait(5);
  const b = (await t.post("/api/courses", { owner: "Grace", title: "Second" })).json.courseId;
  await t.post(`/api/courses/${b}/checkpoints`, { id: "files", text: "Confirm the material list." });
  const { courses } = (await t.get("/api/courses")).json;
  assert.deepEqual(courses.map((c) => c.title), ["Second", "First"]);
  assert.deepEqual(courses[0].progress, { confirmed: 1, total: 5, versions: 0 });
  assert.deepEqual(courses[1].progress, { confirmed: 0, total: 5, versions: 0 });
  assert.deepEqual(Object.keys(courses[0]).sort(), ["courseId", "createdAt", "owner", "progress", "title"], "a summary, never material or answers");
  assert.ok(a && b);
});

test("a course whose record does not verify is listed as needing attention, not silently dropped", async () => {
  const t = await boot();
  const ok = (await t.post("/api/courses", { owner: "Ada", title: "Fine" })).json.courseId;
  const bad = (await t.post("/api/courses", { owner: "Ada", title: "Tampered" })).json.courseId;
  await t.post(`/api/courses/${bad}/checkpoints`, { id: "files", text: "Confirm the material list." });
  const f = join(t.dir, bad.replace(/[^A-Za-z0-9._-]/g, "_"), "events.ndjson");
  writeFileSync(f, readFileSync(f, "utf8").replace("Confirm the material list.", "Confirm something else."));
  const { status, json } = await t.get("/api/courses");
  assert.equal(status, 200, "one bad course does not take the library down");
  const byTitle = Object.fromEntries(json.courses.map((c) => [c.title, c.progress]));
  assert.equal(byTitle.Tampered.error, "LOG_INTEGRITY");
  assert.equal(byTitle.Fine.confirmed, 0);
  assert.ok(ok);
});

/* ---- the OpenRouter preset ---- */

test("the OpenRouter preset: URL, model and key defaults, zero-data-retention ON unless explicitly switched off", () => {
  const w = workerFromEnv({ SILICUS_WORKER_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
  assert.equal(w.enabled, true);
  assert.equal(w.provider, "openai", "OpenRouter speaks the chat-completions wire");
  assert.equal(w.zdr, true);
  assert.equal(workerFromEnv({ SILICUS_WORKER_PROVIDER: "openrouter", SILICUS_WORKER_ZDR: "0" }).zdr, false);
  assert.equal(workerFromEnv({ SILICUS_WORKER_PROVIDER: "openrouter", SILICUS_WORKER_MODEL: "x/y" }).enabled, true);
});

test("without the preset nothing claims zero-retention it was not asked for, and the other presets are unchanged", () => {
  assert.equal(workerFromEnv({ SILICUS_WORKER_URL: "https://x.example/v1", SILICUS_WORKER_MODEL: "m" }).zdr, false);
  assert.equal(workerFromEnv({}).enabled, false);
  assert.equal(workerFromEnv({ SILICUS_WORKER_PROVIDER: "anthropic" }).provider, "anthropic");
  assert.throws(() => workerFromEnv({ SILICUS_WORKER_PROVIDER: "anthropic", SILICUS_WORKER_ZDR: "1" }), { code: "WORKER_BAD_CONFIG" });
});
