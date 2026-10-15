/**
 * backup.mjs — every course in a store, as one file that can be imported again, and the check that
 * refuses a file that does not verify.
 *
 * The file reuses the archive envelope (archive.mjs: `silicus.archive.v1`, a digest over the payload a reader
 * can recompute). Its payload carries each course's meta and its FULL event log — the course export
 * (`silicus.course.export.v1`) is a summary that cannot rebuild a course, and the log can.
 *
 * Import fails CLOSED, all or nothing: the envelope digest must match, every course's chain must verify, its
 * meta must agree with its own `course.created` event, and it must replay through the real course session.
 * One failure refuses the whole file and nothing is written.
 *
 * Honest scope, the same as the log's: this is tamper-EVIDENT, not tamper-proof. Someone who edits an event
 * and recomputes every digest produces a file that verifies; nothing here is signed. A version pinned on the
 * teacher's device (frontend/src/gate/pin.ts) is what catches that.
 *
 * Pure: no I/O. The caller reads and writes the file and the storage.
 */
import { verifyRecords } from "./chain.mjs";
import { CourseSession } from "./course.mjs";
import { digestOf } from "./digest.mjs";
import { RecordStore, metaText, recordLine } from "./record-store.mjs";

export const BACKUP_KIND = "silicus.browser.backup.v1";
export const ENVELOPE_KIND = "silicus.archive.v1";

export class BackupError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

/**
 * Every course in `store` whose record verifies, in one envelope. A course that does not verify is left
 * out and reported: copying a broken record into a backup would only make the backup refuse to import.
 * @param {RecordStore} store
 * @returns {{file: object, included: {courseId: string, title: string}[], skipped: {courseId: string, title: string, reason: string}[]}}
 */
export function buildBackup(store, { at = Date.now() } = {}) {
  const courses = [];
  const included = [];
  const skipped = [];
  for (const { courseId, metaText: text, lines } of store.snapshot()) {
    let meta;
    try { meta = JSON.parse(text); } catch { skipped.push({ courseId, title: courseId, reason: "its details could not be read" }); continue; }
    try {
      const records = lines.filter((l) => l.trim()).map((l) => JSON.parse(l));
      const v = verifyRecords(records);
      if (!v.ok) { skipped.push({ courseId, title: meta.title, reason: `its record does not verify (${v.reason})` }); continue; }
      courses.push({ courseId, meta, records });
      included.push({ courseId, title: meta.title });
    } catch {
      skipped.push({ courseId, title: meta.title, reason: "its record could not be read" });
    }
  }
  const payload = { kind: BACKUP_KIND, courses };
  return { file: { kind: ENVELOPE_KIND, ref: "silicus-courses", digest: digestOf(payload), archivedAt: at, payload }, included, skipped };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Parse and verify a backup file. Throws BackupError on ANY problem; returns the records to write only when
 * every course checks out.
 * @param {string} text
 * @returns {{courses: {courseId: string, title: string, metaText: string, lines: string[], events: number, head: string}[]}}
 */
export function readBackup(text) {
  let file;
  try { file = JSON.parse(String(text)); } catch { throw new BackupError("NOT_JSON", "This file is not a Silicus export (it is not JSON)."); }
  if (!file || file.kind !== ENVELOPE_KIND || !file.payload || file.payload.kind !== BACKUP_KIND || !Array.isArray(file.payload.courses)) {
    throw new BackupError("NOT_A_BACKUP", "This file is not a Silicus courses export.");
  }
  if (typeof file.digest !== "string" || digestOf(file.payload) !== file.digest) {
    throw new BackupError("DIGEST_MISMATCH", "This file does not match its own fingerprint: it was changed or damaged after it was exported. Nothing was imported.");
  }
  const seen = new Set();
  const out = [];
  for (const c of file.payload.courses) {
    const id = c && typeof c.courseId === "string" ? c.courseId : null;
    const title = typeof c?.meta?.title === "string" ? c.meta.title : "a course";
    if (!id || !c.meta || typeof c.meta !== "object" || c.meta.courseId !== id || !Array.isArray(c.records) || seen.has(id)) {
      throw new BackupError("BAD_FILE", `This file is malformed (${title}). Nothing was imported.`);
    }
    seen.add(id);
    const v = verifyRecords(c.records);
    if (!v.ok) throw new BackupError("LOG_INTEGRITY", `The record of “${title}” does not verify (${v.reason}). Nothing was imported.`);
    const created = c.records[0]?.event;
    const m = c.meta;
    if (!created || created.kind !== "course.created" || created.courseId !== id || created.owner !== m.owner || created.title !== m.title
      || created.description !== m.description || created.seed !== m.seed || created.at !== m.createdAt || !same(created.materials, m.materials)) {
      throw new BackupError("META_MISMATCH", `The details of “${title}” do not match its own record. Nothing was imported.`);
    }
    const entry = { courseId: id, title, metaText: metaText(m), lines: c.records.map(recordLine), events: v.events, head: v.head };
    // The last check is the real one: the course must replay through the same session every request uses.
    try {
      const scratch = new RecordStore();
      scratch.load({ metas: [{ courseId: id, text: entry.metaText }], events: entry.lines.map((line, i) => ({ courseId: id, seq: i + 1, line })) });
      CourseSession.load(scratch, id).view();
    } catch (e) {
      throw new BackupError("REPLAY_FAILED", `The record of “${title}” could not be replayed (${e instanceof Error ? e.message : String(e)}). Nothing was imported.`);
    }
    out.push(entry);
  }
  return { courses: out };
}
