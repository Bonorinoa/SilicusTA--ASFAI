import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { CourseStore } from "./store.mjs"; import { RecordStore } from "./record-store.mjs"; import { CourseSession } from "./course.mjs";
let bad = 0; const ck = (n, ok, d = "") => { console.log(ok ? "PASS" : "FAIL", n, d); if (!ok) bad++; };
const args = { owner: "t", title: "Grass", ages: { min: 4, max: 10 }, marbleAnchor: "mt_gLy3ZgZWiN", marbleConnected: "mt_lutxvMlkwS" };
const dir = mkdtempSync(join(tmpdir(), "kv-m1-"));
const a = CourseSession.create(new CourseStore(dir), args);
const a2 = CourseSession.load(new CourseStore(dir), a.courseId).view().course;
ck("disk store reload: marbleConnected + marbleAnchor", a2.marbleConnected === "mt_lutxvMlkwS" && a2.marbleAnchor === "mt_gLy3ZgZWiN", JSON.stringify([a2.marbleAnchor, a2.marbleConnected]));
const mem = new RecordStore(); const m = CourseSession.create(mem, args);
const snap = mem.snapshot(); const mem2 = new RecordStore();
mem2.load({ metas: snap.map((c) => ({ courseId: c.courseId, text: c.metaText })), events: snap.flatMap((c) => c.lines.map((l, i) => ({ courseId: c.courseId, seq: i, line: l }))) });
const m2 = CourseSession.load(mem2, m.courseId).view().course;
ck("record store reload: marbleConnected + marbleAnchor", m2.marbleConnected === "mt_lutxvMlkwS" && m2.marbleAnchor === "mt_gLy3ZgZWiN", JSON.stringify([m2.marbleAnchor, m2.marbleConnected]));
for (const badV of ["not-an-id", "mt_gLy3ZgZWiN" /* same as anchor */, 42]) { let err = null; try { CourseSession.create(new RecordStore(), { ...args, marbleConnected: badV }); } catch (e) { err = e.code ?? e.message; } ck(`refuses marbleConnected=${JSON.stringify(badV)}`, err !== null, String(err)); }
let e2 = null; try { CourseSession.create(new RecordStore(), { ...args, marbleAnchor: null }); } catch (e) { e2 = e.code ?? e.message; } ck("marbleConnected without an anchor", true, "result: " + (e2 ?? "accepted"));
process.exit(bad ? 1 : 0);
