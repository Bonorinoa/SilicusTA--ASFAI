/**
 * marble-routes.test.mjs — the two read-only knowledge routes, shared by BOTH hosts (handler.mjs).
 *
 *   GET /api/knowledge/marble/search?q=...&ageMin=..&ageMax=..&limit=..
 *   GET /api/knowledge/marble/topics/:id
 *
 * They write nothing: no course, no log, no event. The shapes are pinned here so a later
 * studio card (G2) can build on them without a second contract.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { createMarbleService } from "../marble/marble-graph.mjs";
import { readFileSync, readdirSync } from "node:fs";

const SNAPSHOT = new URL("../data/marble/marble-snapshot.json", import.meta.url).pathname;
const marble = createMarbleService(async () => readFileSync(SNAPSHOT, "utf8"));
const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

async function boot({ withMarble = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "silicus-marble-routes-"));
  const app = createApp({ dataDir: dir, sources: [], marble: withMarble ? marble : null });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, json: await r.json() }; };
  return { get, dir };
}

test("search returns the small, stable shape, honouring ages and limit", async () => {
  const { get, dir } = await boot();
  const r = await get("/api/knowledge/marble/search?q=AI%20in%20daily%20life&ageMin=5&ageMax=12&limit=3");
  assert.equal(r.status, 200);
  assert.equal(r.json.query.q, "AI in daily life");
  assert.equal(r.json.query.ageMin, 5);
  assert.equal(r.json.query.ageMax, 12);
  assert.equal(r.json.query.limit, 3);
  assert.equal(r.json.hits.length, 3, "limit is honoured");
  assert.equal(r.json.hits[0].id, "mt_AzTrT5ySCx");
  assert.deepEqual(Object.keys(r.json.hits[0]).sort(), ["ageRangeEnd", "ageRangeStart", "domain", "id", "name", "score", "subject"]);
  // defaults: the whole Marble band, ten hits
  const d = await get("/api/knowledge/marble/search?q=artificial%20intelligence");
  assert.equal(d.json.query.ageMin, 3);
  assert.equal(d.json.query.ageMax, 15);
  assert.equal(d.json.query.limit, 10);
  // age filtering is a real filter, not display: a course ages 8-10 does not see the 11-12-only topics
  const narrow = await get("/api/knowledge/marble/search?q=likelihood&ageMin=3&ageMax=8");
  assert.equal(narrow.json.hits.length, 0, "no hit overlaps the ages, so none is served");
  // the route read nothing and wrote nothing: no courses, and the data dir holds no log
  assert.equal((await get("/api/courses")).json.courses.length, 0);
  assert.deepEqual(readdirSync(dir), [], "no course, no log, no event");
});

test("topic by id returns the node with its prerequisites and dependents", async () => {
  const { get } = await boot();
  const r = await get("/api/knowledge/marble/topics/mt_AzTrT5ySCx");
  assert.equal(r.status, 200);
  assert.equal(r.json.id, "mt_AzTrT5ySCx");
  assert.equal(r.json.name, "AI in Daily Life");
  assert.equal(r.json.ageRangeStart, 5);
  assert.equal(r.json.ageRangeEnd, 12);
  // the demo edges from the committee walk:
  assert.deepEqual(r.json.prerequisites.hard, [{ topicId: "mt_WRRv1ABECC", name: "Smart Versus Not-Smart Devices", strength: "hard", reason: "Must understand smart things before spotting AI all around daily life" }]);
  assert.equal(r.json.prerequisites.soft[0].topicId, "mt_u6SYiVx7FX", "a soft unlock");
  assert.equal(r.json.dependents.length, 1);
  assert.equal(r.json.dependents[0].topicId, "mt_kH1DzOPsXG", "Data and Information for Computers depends on it, soft");
  assert.equal(r.json.dependents[0].strength, "soft");
});

test("hard edges and soft edges both resolve the OTHER demo direction", async () => {
  const { get } = await boot();
  const r = await get("/api/knowledge/marble/topics/mt_kH1DzOPsXG");
  assert.equal(r.json.prerequisites.hard.length, 1);
  assert.ok(r.json.prerequisites.soft.some((s) => s.topicId === "mt_AzTrT5ySCx"), "AI in Daily Life is a soft prerequisite of Data and Information for Computers");
  assert.equal(r.json.name, "Data and Information for Computers");
});

test("the routes are read-only and refuse bad input", async () => {
  const { get } = await boot();
  const noQ = await get("/api/knowledge/marble/search");
  assert.equal(noQ.status, 400);
  assert.equal(noQ.json.code, "BAD_INPUT");
  const qOnly = await get("/api/knowledge/marble/search?q=");
  assert.equal(qOnly.status, 400);
  const ghosts = await get("/api/knowledge/marble/topics/mt_NOT_REAL");
  assert.equal(ghosts.status, 404);
  assert.equal(ghosts.json.code, "UNKNOWN_TOPIC");
  assert.equal((await get("/api/knowledge/marble/search?q=x&limit=9999")).json.query.limit, 50, "limit is bounded");
});

test("with no marble service the routes say so in the house style", async () => {
  const { get } = await boot({ withMarble: false });
  const r = await get("/api/knowledge/marble/search?q=x");
  assert.equal(r.status, 501);
  assert.equal(r.json.code, "MARBLE_NOT_CONFIGURED");
});

test("knowledge status carries marble together with the other sources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "silicus-marble-routes-"));
  const { MarbleSource } = await import("../sources/marble.mjs");
  const app = createApp({ dataDir: dir, sources: [new MarbleSource({ marble })], marble });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const r = await (await fetch(`${base}/api/knowledge/status`)).json();
  assert.deepEqual(r.sources.map((s) => s.id), ["marble"]);
  assert.deepEqual(r.sources[0], { id: "marble", label: "Marble skill taxonomy", enabled: true, canVerify: true });
});
