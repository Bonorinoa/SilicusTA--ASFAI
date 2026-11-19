import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { CourseStore } from "./store.mjs"; import { RecordStore } from "./record-store.mjs"; import { CourseSession } from "./course.mjs";
import { lengthNotes, lengthBand } from "./lesson-length.mjs"; import { PlanWorker } from "./worker.mjs"; import { startMockWorker } from "./test/mock-worker.mjs";
let bad = 0; const ck = (n, ok, d = "") => { console.log(ok ? "PASS" : "FAIL", n, d); if (!ok) bad++; };
// 1. round trip, disk store: new store object on the same directory
const dir = mkdtempSync(join(tmpdir(), "kv-k2-"));
const s1 = CourseSession.create(new CourseStore(dir), { owner: "t", title: "T", lessonMinutes: 90 });
const reopened = CourseSession.load(new CourseStore(dir), s1.courseId);
ck("disk store: reopened from files, lessonMinutes 90", reopened.view().course.lessonMinutes === 90, String(reopened.view().course.lessonMinutes));
// record store: snapshot -> JSON -> fresh RecordStore.load
const mem = new RecordStore();
const m1 = CourseSession.create(mem, { owner: "t", title: "T", lessonMinutes: 30 });
const snap = JSON.parse(JSON.stringify(mem.snapshot()));
const mem2 = new RecordStore(); mem2.load({ metas: snap.map((c) => ({ courseId: c.courseId, text: c.metaText })), events: snap.flatMap((c) => c.lines.map((l, i) => ({ courseId: c.courseId, seq: i, line: l }))) });
const m2 = CourseSession.load(mem2, m1.courseId);
ck("record store: snapshot->load round trip, lessonMinutes 30", m2.view().course.lessonMinutes === 30, String(m2.view().course.lessonMinutes));
// tamper: meta says 30 but chained event says otherwise -> view reads the event (not the meta)
const evOnly = new RecordStore(); const snap2 = JSON.parse(JSON.stringify(mem.snapshot()));
const meta2 = JSON.parse(snap2[0].metaText); meta2.lessonMinutes = 999;
evOnly.load({ metas: [{ courseId: m1.courseId, text: JSON.stringify(meta2, null, 2) + "\n" }], events: snap2[0].lines.map((l, i) => ({ courseId: m1.courseId, seq: i, line: l })) });
ck("view reads lessonMinutes from the chained event, not editable meta", CourseSession.load(evOnly, m1.courseId).view().course.lessonMinutes === 30, String(CourseSession.load(evOnly, m1.courseId).view().course.lessonMinutes));
// 2. over/under table
const acts = (...m) => m.map((x, i) => ({ title: "A" + i, minutes: x }));
const T = [[[45], 45, 0], [[41], 45, 0], [[49], 45, 0], [[40], 45, 1], [[50], 45, 1], [[70], 45, 1], [[10, 10], 45, 1], [[60, 30], 90, 0], [[], 45, 1]];
for (const [m, L, n] of T) { const notes = lengthNotes(acts(...m), L); ck(`notes for sum ${m.reduce((a, b) => a + b, 0)} vs ${L}: expect ${n}`, notes.length === n, JSON.stringify(notes)); }
console.log("band 45 =", JSON.stringify(lengthBand(45)), "| none:", JSON.stringify(lengthNotes(acts(99), null)));
// 3. runaway
const huge = "x".repeat(20000);
const mk = (n) => ({ title: "P".repeat(900), activities: Array.from({ length: n }, (_, i) => ({ title: "T".repeat(500), minutes: 5, objectiveIds: ["urn:uuid:aaa"], learnerDoes: huge, teacherDoes: huge, evidenceIfAny: "observation" })) });
const mock = await startMockWorker({ reply: mk(40) });
const w = new PlanWorker({ url: mock.url, model: "m" });
const out = await w.draft({ objectives: [{ id: "urn:uuid:aaa", statement: "Students can explain x." }], topic: "x", lessonMinutes: 45 });
console.log("keys", Object.keys(out).join(","));
ck("40 activities in -> at most 8 out", out.activities.length <= 8, String(out.activities.length));
const maxLen = Math.max(...out.activities.flatMap((a) => [a.title, a.learnerDoes, a.teacherDoes, a.evidenceIfAny].map((s) => (s ?? "").length)), out.title.length);
ck("every free-text field bounded (max length seen)", maxLen <= 600, String(maxLen));
console.log("notes:", JSON.stringify(out.notes ?? out.adjusted ?? null).slice(0, 400));
const p = mock.st.lastPrompt; ck("prompt carries the 8-activity bound", /\b8\b/.test(p) && /at most|no more than|maximum/i.test(p), (p.match(/[^\n]*\b8\b[^\n]*/) ?? [""])[0].slice(0, 160));
console.log("schema maxItems in prompt:", /maxItems/.test(p));
mock.close(); process.exit(bad ? 1 : 0);
