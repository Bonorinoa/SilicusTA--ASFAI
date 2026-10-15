/**
 * record-store.test.mjs — the store a disk-less host uses (record-store.mjs) behind the SAME handler gives the
 * same API and the same log as the disk store behind the real HTTP server; and the backup file of a store
 * round-trips and fails closed when tampered with.
 *
 * Ids and clock are pinned in both runs (randomUUID via syncBuiltinESMExports, Date.now), which is the only
 * way two independent runs can be compared byte for byte.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { createHandler } from "../handler.mjs";
import { RecordStore } from "../record-store.mjs";
import { PlanWorker } from "../worker.mjs";
import { prepareMaterialsWith, MaterialError } from "../materials-core.mjs";
import { buildBackup, readBackup } from "../backup.mjs";
import { CourseSession } from "../course.mjs";
import { runScriptedCourse, chatCompletion, MATERIAL_SECRET } from "./scripted-course.mjs";

function pinIdsAndClock() {
  const realUUID = crypto.randomUUID;
  const realNow = Date.now;
  let n = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  syncBuiltinESMExports();
  Date.now = () => 1767225600000;
  return () => { crypto.randomUUID = realUUID; syncBuiltinESMExports(); Date.now = realNow; };
}

const fakeModel = async (_url, init) => new Response(JSON.stringify(chatCompletion(JSON.parse(init.body))), { status: 200, headers: { "content-type": "application/json" } });
const worker = () => new PlanWorker({ url: "http://127.0.0.1:9/v1/chat/completions", model: "m", fetchImpl: fakeModel });
const noAsfai = { status: () => ({ connected: false }), runIntake: async () => { throw Object.assign(new Error("off"), { code: "OFF" }); }, validate: async () => null };

async function runOnDisk() {
  const restore = pinIdsAndClock();
  const dir = mkdtempSync(join(tmpdir(), "silicus-parity-"));
  const app = createApp({ dataDir: dir, worker: worker(), sources: [], asfai: noAsfai });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const out = await runScriptedCourse(async (method, path, body) => {
      const r = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: r.status, json: await r.json() };
    });
    const slug = readdirSync(dir).find((d) => d.startsWith("urn"));
    return { ...out, lines: readFileSync(join(dir, slug, "events.ndjson"), "utf8").split("\n").filter(Boolean), meta: readFileSync(join(dir, slug, "meta.json"), "utf8"), dir };
  } finally {
    app.closeAllConnections?.(); app.close(); restore();
  }
}

function memoryHandler(store) {
  return createHandler({ store, asfai: noAsfai, worker: worker(), sources: [], prepareMaterials: (items) => prepareMaterialsWith(items, async () => { throw new MaterialError("URL_REFUSED", "no links here"); }) });
}

async function runInMemory() {
  const restore = pinIdsAndClock();
  const writes = [];
  const store = new RecordStore({ onWrite: (w) => writes.push(w) });
  const h = memoryHandler(store);
  try {
    const out = await runScriptedCourse(async (method, path, body) => {
      const r = await h.handle({ method, url: path, readBody: async () => JSON.parse(JSON.stringify(body ?? {})) });
      return { status: r.status, json: JSON.parse(JSON.stringify(r.json)) };
    });
    const snap = store.snapshot()[0];
    return { ...out, lines: snap.lines, meta: snap.metaText, writes, store };
  } finally {
    restore();
  }
}

test("the record store behind the shared handler matches the disk host over HTTP: same transcript, same log bytes, same meta", async () => {
  const disk = await runOnDisk();
  const mem = await runInMemory();
  assert.ok(disk.transcript.length > 20);
  for (let i = 0; i < disk.transcript.length; i += 1) {
    assert.deepEqual(mem.transcript[i], disk.transcript[i], `step ${i}: ${disk.transcript[i].method} ${disk.transcript[i].path}`);
  }
  assert.equal(mem.transcript.length, disk.transcript.length);
  assert.deepEqual(mem.lines, disk.lines, "identical NDJSON lines");
  assert.equal(mem.meta, disk.meta, "identical meta.json text");
  // The story really happened: published, cited answer, forged keys cut away.
  const statuses = Object.fromEntries(disk.transcript.map((s) => [`${s.method} ${s.path.replace(/urn%3Auuid%3A[0-9a-f-]+/, ":id")}`, s.status]));
  assert.equal(statuses["POST /api/courses/:id/publish"], 200);
  const ask = disk.transcript.filter((s) => s.path.endsWith("/student/ask")).at(-1);
  assert.equal(ask.json.grounded, true);
  assert.ok(!disk.lines.join("\n").includes("forged") && !disk.lines.join("\n").includes("attacker") && !disk.lines.join("\n").includes("mt_1"));
  assert.ok(!disk.lines.join("\n").includes(MATERIAL_SECRET) && !mem.writes.some((w) => JSON.stringify(w).includes(MATERIAL_SECRET)), "material text is never written");
});

test("a record store reloaded from its own writes replays to the same view; an edited line is refused, never served", async () => {
  const mem = await runInMemory();
  const id = mem.courseId;
  const fresh = new RecordStore();
  fresh.load({
    metas: mem.writes.filter((w) => w.type === "meta").map((w) => ({ courseId: w.courseId, text: w.text })),
    events: mem.writes.filter((w) => w.type === "event").map(({ courseId, seq, line }) => ({ courseId, seq, line })),
  });
  assert.deepEqual(CourseSession.load(fresh, id).view(), CourseSession.load(mem.store, id).view());

  const tampered = new RecordStore();
  tampered.load({
    metas: mem.writes.filter((w) => w.type === "meta").map((w) => ({ courseId: w.courseId, text: w.text })),
    events: mem.writes.filter((w) => w.type === "event").map(({ courseId, seq, line }) => ({ courseId, seq, line: seq === 2 ? line.replace("Confirm the material list", "Confirm a different list") : line })),
  });
  const h = memoryHandler(tampered);
  const r = await h.handle({ method: "GET", url: `/api/courses/${encodeURIComponent(id)}`, readBody: async () => ({}) });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "LOG_INTEGRITY");
  const lib = await h.handle({ method: "GET", url: "/api/courses", readBody: async () => ({}) });
  assert.deepEqual(lib.json.courses[0].progress, { error: "LOG_INTEGRITY" });
});

test("a backup of a store round-trips through readBackup and replays to the same view", async () => {
  const mem = await runInMemory();
  const { file, included, skipped } = buildBackup(mem.store, { at: 1 });
  assert.equal(included.length, 1);
  assert.equal(skipped.length, 0);
  const back = readBackup(JSON.stringify(file));
  assert.equal(back.courses.length, 1);
  assert.deepEqual(back.courses[0].lines, mem.lines);
  assert.equal(back.courses[0].metaText, mem.meta);
  assert.ok(!JSON.stringify(file).includes(MATERIAL_SECRET));
});

test("a tampered backup is refused, whole, with a clear reason: payload edit, recomputed-envelope edit, meta mismatch, not a backup", async () => {
  const mem = await runInMemory();
  const { file } = buildBackup(mem.store, { at: 1 });
  const edited = structuredClone(file);
  edited.payload.courses[0].records[2].event.text = "I never said this.";
  assert.throws(() => readBackup(JSON.stringify(edited)), { code: "DIGEST_MISMATCH" });

  // Recompute the envelope digest so only the chain can catch it.
  const { digestOf } = await import("../digest.mjs");
  edited.digest = digestOf(edited.payload);
  assert.throws(() => readBackup(JSON.stringify(edited)), { code: "LOG_INTEGRITY" });

  const meta = structuredClone(file);
  meta.payload.courses[0].meta.title = "Someone else's course";
  meta.digest = digestOf(meta.payload);
  assert.throws(() => readBackup(JSON.stringify(meta)), { code: "META_MISMATCH" });

  assert.throws(() => readBackup("{not json"), { code: "NOT_JSON" });
  assert.throws(() => readBackup(JSON.stringify({ kind: "silicus.course.export.v1" })), { code: "NOT_A_BACKUP" });
});
