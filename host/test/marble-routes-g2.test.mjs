/**
 * marble-routes-g2.test.mjs — the two new read-only Marble routes (G2a), shared by BOTH hosts.
 *
 *   GET /api/knowledge/marble/coverage?min=..&max=..         the wizard's histogram strip
 *   GET /api/knowledge/marble/neighbourhood/:id             the anchor's two-hop-up / one-hop-down view
 *
 * They write nothing: no course, no log, no event, no console line. The coverage counts are
 * pinned to the committed snapshot (ages 9-10 -> 1,320 overlapping topics; 19-22 -> 0).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { createMarbleService } from "../marble/marble-graph.mjs";

const SNAPSHOT = new URL("../data/marble/marble-snapshot.json", import.meta.url).pathname;
const marble = createMarbleService(async () => readFileSync(SNAPSHOT, "utf8"));
const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "silicus-marble-g2-routes-"));
  const app = createApp({ dataDir: dir, sources: [], marble });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, json: await r.json() }; };
  return { get, dir };
}

test("coverage counts the topics overlapping the range, with the 3..25 strip for the histogram", async () => {
  const { get, dir } = await boot();
  const r = await get("/api/knowledge/marble/coverage?min=9&max=10");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.query, { min: 9, max: 10 });
  // pinned to the committed snapshot: ages 9-10 overlap 1,320 topics
  assert.equal(r.json.overlapping, 1320);
  const perAge = r.json.perAge;
  assert.equal(perAge.length, 23, "the strip runs from 3 to 25 inclusive");
  assert.deepEqual(perAge[0], { age: 3, count: 112 });
  assert.deepEqual(perAge[6], { age: 9, count: 1141 });
  assert.deepEqual(perAge[22], { age: 25, count: 0 });
});

test("coverage: ages 19-22 overlap nothing, defaults cover the whole graph, and bad input is a 400", async () => {
  const { get, dir } = await boot();
  const r = await get("/api/knowledge/marble/coverage?min=19&max=22");
  assert.equal(r.json.overlapping, 0, "the acceptance's 19-22 case");
  const d = await get("/api/knowledge/marble/coverage");
  assert.deepEqual(d.json.query, { min: 3, max: 15 });
  assert.equal(d.json.overlapping, 1912, "the whole trimmed snapshot as the default range");
  for (const q of ["min=2&max=10", "min=9&max=8", "min=8&max=100", "min=8.5&max=10", "min=x&max=10"]) {
    const bad = await get(`/api/knowledge/marble/coverage?${q}`);
    assert.equal(bad.status, 400, q);
    assert.equal(bad.json.code, "BAD_INPUT");
  }
  // read-only: nothing was written, no log line, no course
  assert.equal((await get("/api/courses")).json.courses.length, 0);
  assert.deepEqual(readdirSync(dir), ["archives"], "no course, no log, no event");
});

test("neighbourhood: prerequisites two hops up and dependents one hop down, with full rows", async () => {
  const { get } = await boot();
  const r = await get("/api/knowledge/marble/neighbourhood/mt_AzTrT5ySCx");
  assert.equal(r.status, 200);
  const { evidence: anchorEvidence, ...anchorRest } = r.json.anchor;
  assert.deepEqual(anchorRest, { id: "mt_AzTrT5ySCx", name: "AI in Daily Life", subject: "Computing", domain: "Artificial Intelligence", ageRangeStart: 5, ageRangeEnd: 12 });
  // G2c: the anchor carries its evidence lines (the objectives step offers them as wording to copy).
  assert.equal(anchorEvidence.length, 3);
  assert.match(anchorEvidence[0], /five examples of AI/);
  // G2c: the walked edges, prerequisite -> topic, with their strength; both ends always in the view.
  const ids = new Set(["mt_AzTrT5ySCx", ...r.json.prerequisites.map((p) => p.id), ...r.json.dependents.map((p) => p.id)]);
  for (const e of r.json.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `edge ${e.from}>${e.to} stays inside the view`);
  const edge = (from, to) => r.json.edges.find((e) => e.from === from && e.to === to)?.strength;
  assert.equal(edge("mt_WRRv1ABECC", "mt_AzTrT5ySCx"), "hard");
  assert.equal(edge("mt_u6SYiVx7FX", "mt_AzTrT5ySCx"), "soft");
  assert.equal(edge("mt_AzTrT5ySCx", "mt_kH1DzOPsXG"), "soft");
  assert.ok(edge("mt_WRRv1ABECC", "mt_u6SYiVx7FX"), "the edge between two one-hop prerequisites survives the per-id dedupe");

  const rowKeys = ["ageRangeEnd", "ageRangeStart", "domain", "evidence", "hops", "id", "name", "reason", "strength", "subject"];
  for (const row of [...r.json.prerequisites, ...r.json.dependents]) {
    assert.deepEqual(Object.keys(row).sort(), rowKeys, `row shape for ${row.id}`);
    assert.equal(typeof row.strength, "string");
    assert.equal(typeof row.reason, "string");
    assert.ok(Array.isArray(row.evidence), "evidence lines are present");
  }

  const prereqs = r.json.prerequisites;
  const hop1 = prereqs.find((p) => p.id === "mt_WRRv1ABECC");
  assert.deepEqual(hop1, {
    id: "mt_WRRv1ABECC", name: "Smart Versus Not-Smart Devices", subject: "Computing", domain: "Artificial Intelligence",
    ageRangeStart: 5, ageRangeEnd: 8, strength: "hard", hops: 1,
    reason: "Must understand smart things before spotting AI all around daily life",
    evidence: [
      "Sort a set of objects into 'smart' (responds to input) and 'not smart' (does the same thing every time)",
      "Explain what makes a smart speaker different from a regular radio",
      "Give an example of a machine that senses something and responds (automatic door, motion-sensor light)",
    ],
  });
  assert.ok(prereqs.some((p) => p.id === "mt_u6SYiVx7FX" && p.hops === 1), "Voice Assistants is a one-hop soft prerequisite");
  assert.ok(prereqs.some((p) => p.id === "mt_XbGfVhfiUz" && p.hops === 2 && p.strength === "hard"), "Computers in Everyday Life, two hops up");
  assert.ok(prereqs.some((p) => p.id === "mt__p5n8z5soJ" && p.hops === 2), "Step-by-Step Instructions, two hops up via Voice Assistants");
  // dedupe by id: WRRv1ABECC is also a hop-2 via Voice Assistants, and appears once, as hop 1
  assert.equal(prereqs.filter((p) => p.id === "mt_WRRv1ABECC").length, 1);

  const deps = r.json.dependents;
  assert.equal(deps.length, 1);
  assert.deepEqual(deps[0], {
    id: "mt_kH1DzOPsXG", name: "Data and Information for Computers", subject: "Computing", domain: "Data Representation",
    ageRangeStart: 5, ageRangeEnd: 10, strength: "soft", hops: 1,
    reason: "Seeing AI in daily life motivates understanding what data powers it",
    evidence: [
      "Define data as information stored in a computer (numbers, text, images, sounds)",
      "Give at least three examples of data they create every day (photos, messages, search queries)",
      "Explain that a computer only knows what it has been given — it has no knowledge of its own",
    ],
  });
});

test("neighbourhood refuses unknown ids and malformed encoding, read-only like the topic route", async () => {
  const { get, dir } = await boot();
  assert.equal((await get("/api/knowledge/marble/neighbourhood/mt_NOT_REAL")).status, 404);
  assert.equal((await get("/api/knowledge/marble/neighbourhood/%")).status, 400);
  assert.equal((await get("/api/knowledge/marble/neighbourhood")).json.code, "NOT_FOUND");
  assert.deepEqual(readdirSync(dir), ["archives"]);
});
