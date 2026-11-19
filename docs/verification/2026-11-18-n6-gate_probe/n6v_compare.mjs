// N6V probe: replay records written by OLD code in the N6 tree; diff a new run against a pre-N6 run.
// usage: node n6v_compare.mjs <n6-tree> <old-run.json> <pre-n6-run.json> <new-run.json>
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const [ROOT, ...runs] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(resolve(ROOT), p)).href);
const { RecordStore, metaText } = await imp("host/record-store.mjs");
const { CourseSession } = await imp("host/course.mjs");
const { comparePin } = await imp("frontend/src/gate/pin.ts");
const wire = (v) => JSON.parse(JSON.stringify(v));
const load = (f) => JSON.parse(readFileSync(f, "utf8"));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); if (!ok) fails++; };

for (const [label, f] of [["437f053-era", runs[0]], ["d4258aa(pre-N6, with plan edit)", runs[1]]]) {
  const run = load(f);
  const oldAnchor = run.anchor.anchor ?? run.anchor;
  const meta = JSON.parse(run.meta);
  const store = new RecordStore();
  store.load({ metas: [{ courseId: meta.courseId, text: run.meta }], events: run.lines.map((line, i) => ({ courseId: meta.courseId, seq: i + 1, line })) });
  const s = CourseSession.load(store, meta.courseId);
  const v = s.verifyLog();
  check(`${label}: replays in N6 tree, hash chain verifies`, v.ok === true && v.events === run.lines.length, JSON.stringify({ ok: v.ok, events: v.events }));
  check(`${label}: N6-tree export deepEquals the export the OLD code served`, (() => { try { assert.deepEqual(wire(s.export()), run.export); return true; } catch (e) { console.log(String(e.message).slice(0, 400)); return false; } })());
  check(`${label}: anchor v1 deepEquals old anchor`, (() => { try { assert.deepEqual(wire(s.publishAnchor(1)), oldAnchor); return true; } catch { return false; } })());
  const pin = { ...oldAnchor, pinnedAt: 1 };
  check(`${label}: comparePin(old pin, replayed anchor) = ok`, comparePin(pin, wire(s.publishAnchor(1))).status === "ok", comparePin(pin, wire(s.publishAnchor(1))).status);
  check(`${label}: no event in the old log mentions proposedBy/teacherEditCount`, !run.lines.some((l) => /proposedBy|teacherEditCount/.test(l)));
  const e = s.export();
  check(`${label}: replayed plan has no teacherEditCount; objectives still read by:"ai" for wizard lines`, e.plan.teacherEditCount === undefined, `plan.editedByTeacher=${e.plan.editedByTeacher} proposals.by=${JSON.stringify(s.view().proposals.map((p) => p.by))}`);
}

// New run vs pre-N6 run: same script, same deterministic ids -> only additive differences allowed.
const pre = load(runs[1]); const nw = load(runs[2]);
console.log("\nline-by-line, pre-N6 vs N6 (same script):", pre.lines.length, "vs", nw.lines.length);
let diffs = 0;
pre.lines.forEach((l, i) => {
  if (l === nw.lines[i]) return;
  diffs++;
  const a = JSON.parse(l), b = JSON.parse(nw.lines[i]);
  const ev = (o) => o.event ?? o.payload ?? o;
  const ka = new Set(Object.keys(JSON.stringify(a) ? flat(a) : {})); const kb = flat(b); const fa = flat(a);
  const added = Object.keys(kb).filter((k) => !(k in fa)), changed = Object.keys(fa).filter((k) => k in kb && fa[k] !== kb[k]), removed = Object.keys(fa).filter((k) => !(k in kb));
  console.log(`line ${i + 1}: kind=${a.event?.kind ?? a.kind ?? "?"} added=${JSON.stringify(added.filter((k) => !/(hash|prev|digest|head)/i.test(k)))} changed=${JSON.stringify(changed.filter((k) => !/(hash|prev|digest|head)/i.test(k)))} removed=${JSON.stringify(removed)}`);
});
function flat(o, p = "", out = {}) { if (o && typeof o === "object") for (const k of Object.keys(o)) flat(o[k], p ? `${p}.${k}` : k, out); else out[p] = o; return out; }
console.log("differing lines:", diffs, "of", pre.lines.length);
const fe = flat(pre.export), fn = flat(nw.export);
console.log("export keys added in N6:", JSON.stringify(Object.keys(fn).filter((k) => !(k in fe) )));
console.log("export keys removed in N6:", JSON.stringify(Object.keys(fe).filter((k) => !(k in fn))));
console.log("export values changed (excluding hashes):", JSON.stringify(Object.keys(fe).filter((k) => k in fn && fe[k] !== fn[k] && !/(hash|digest|head|prev)/i.test(k))));
process.exit(fails ? 1 : 0);
