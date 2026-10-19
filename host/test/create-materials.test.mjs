/**
 * create-materials.test.mjs — what POST /api/courses may keep about a course's materials (U-2 / engineering
 * F2), and what a non-object body gets (E3).
 *
 * The record keeps source NAMES only (the shape the shipped UI sends). Raw material text — sent on the
 * create payload, or smuggled under any other key — must reach no record: not meta.json, not the
 * hash-chained course.created event, not the view, the export or a backup (lock: material transient).
 * A JSON null, an array or a scalar is a clean 400, never a 500 from reading a field off it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../handler.mjs";
import { CourseStore } from "../store.mjs";
import { RecordStore } from "../record-store.mjs";
import { buildBackup } from "../backup.mjs";
import { materialNames, MAX_MATERIAL_NAMES, MAX_MATERIAL_NAME_CHARS } from "../materials-core.mjs";

const OFF_ASFAI = { status: () => ({ connected: false }), oauth: {}, runIntake: async () => { throw new Error("off"); }, validate: async () => { throw new Error("off"); } };

/** A handler over a disk store and a dead worker: create and read need neither a model nor a network. */
function host() {
  const root = mkdtempSync(join(tmpdir(), "silicus-create-"));
  const store = new CourseStore(root);
  const handler = createHandler({
    store, asfai: OFF_ASFAI, worker: { enabled: false, answerStudent: async () => ({}) },
    sources: [], archives: null, prepareMaterials: async () => ({ materials: [], skipped: [] }),
  });
  const call = async (method, path, body) => {
    const r = await handler.handle({ method, url: path, readBody: async () => body });
    return { status: r.status, json: r.json };
  };
  const diskText = () => {
    const found = [];
    const walk = (d) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : found.push(readFileSync(p, "utf8")); });
    walk(root);
    return found.join("\n");
  };
  const backupText = (courseId) => {
    const rs = new RecordStore();
    rs.load({ metas: [{ courseId, text: JSON.stringify(store.meta(courseId), null, 2) + "\n" }], events: store.log(courseId).read().map((r) => ({ courseId, seq: r.seq, line: JSON.stringify(r) })) });
    return JSON.stringify(buildBackup(rs).file);
  };
  return { call, diskText, backupText };
}

const get = (call, id) => call("GET", `/api/courses/${encodeURIComponent(id)}`);
const SECRET = "TANGERINE-CREATE-9041";

test("raw material text sent on POST /api/courses is kept nowhere: not meta, not the event, not the view, export or backup (U-2)", async () => {
  const { call, diskText, backupText } = host();
  const r = await call("POST", "/api/courses", { owner: "T", title: "Raw", materials: [
    { name: "notes.txt", text: `${SECRET} body` },
    { name: "slides", extra: { deep: `${SECRET}-deep` } },
    { name: "bare", text: SECRET, provenance: { turnRef: SECRET }, statement: SECRET },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.courseId;
  assert.equal(JSON.stringify(r.json.view).includes(SECRET), false, "the create response view does not echo it");
  assert.equal(diskText().includes(SECRET), false, "no file under the data dir holds it (meta.json + events.ndjson)");
  assert.equal(JSON.stringify((await call("GET", `/api/courses/${encodeURIComponent(id)}/export`)).json).includes(SECRET), false, "nor the export");
  assert.equal(backupText(id).includes(SECRET), false, "nor a backup");
  assert.deepEqual((await get(call, id)).json.course.materials, [
    { name: "notes.txt" }, { name: "slides" }, { name: "bare" },
  ], "only the source NAMES survive");
});

test("material names are bounded to the shipped UI's own limits (24 names, 200 chars); non-names are dropped", async () => {
  const { call } = host();
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `m${i}` }));
  const r = await call("POST", "/api/courses", { owner: "T", title: "Bounds", materials: [...many, 7, null, "string", { noName: true }, { name: 42 }, { name: "x".repeat(500) }] });
  const kept = (await get(call, r.json.courseId)).json.course.materials;
  assert.equal(kept.length, MAX_MATERIAL_NAMES);
  assert.deepEqual(kept[0], { name: "m0" });
  assert.ok(kept.every((m) => typeof m.name === "string" && m.name.length <= MAX_MATERIAL_NAME_CHARS), "every kept name is a bounded string");
  assert.equal(JSON.stringify(kept).includes("42"), false, "a non-string name is dropped, not coerced");
  // The helper itself: names only, deduplicated names stay as given (only the propose path de-duplicates).
  assert.deepEqual(materialNames([{ name: "ok", text: "x" }, { name: "ok" }]), [{ name: "ok" }, { name: "ok" }]);
  assert.deepEqual(materialNames("not an array"), []);
});

test("a JSON null, an array or a scalar body to POST /api/courses is a 400, not a 500 (E3)", async () => {
  const { call } = host();
  for (const body of [null, [1, 2], "hello", 42, true]) {
    const r = await call("POST", "/api/courses", body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, "BAD_INPUT");
  }
  const missing = await call("POST", "/api/courses", { owner: "T" });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.code, "BAD_INPUT");
});
