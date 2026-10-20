/**
 * record-store.mjs — the course store over records held in memory, for hosts that have no disk.
 *
 * Same interface as store.mjs's CourseStore (has, initCourse, meta, log, list), same record shapes, same
 * chain (chain.mjs). What differs is only where the bytes go: every write is handed to `onWrite`, which the
 * browser host uses to write through to IndexedDB, and `load()` replaces the contents with what was read
 * back from there. The bytes kept are exactly the disk host's: a meta document is the meta.json text and
 * an event is one NDJSON line, so a record means the same thing, and verifies the same way, on either host.
 *
 * Synchronous on purpose: course.mjs is synchronous, and verified replay per request runs over these lines.
 * Pure: no I/O of its own.
 */
import { ChainedLog } from "./chain.mjs";

/** The exact bytes the disk host writes for a meta document and an event record. */
export const metaText = (meta) => JSON.stringify(meta, null, 2) + "\n";
export const recordLine = (record) => JSON.stringify(record);

export class RecordStore {
  /** @type {Map<string, string>} courseId -> meta.json text */
  #metas = new Map();
  /** @type {Map<string, string[]>} courseId -> NDJSON lines, in seq order */
  #lines = new Map();
  #onWrite;

  /** @param {{onWrite?: (w: {type: "meta", courseId: string, text: string} | {type: "event", courseId: string, seq: number, line: string}) => void}} [opts] */
  constructor({ onWrite = () => {} } = {}) {
    this.#onWrite = onWrite;
  }

  /**
   * Replace the contents with records read back from durable storage. Events are ordered by their KEY's
   * seq; a record whose own seq disagrees, a gap, or an edited line is left for verify() to refuse.
   * @param {{metas: {courseId: string, text: string}[], events: {courseId: string, seq: number, line: string}[]}} snapshot
   */
  load({ metas = [], events = [] } = {}) {
    this.#metas = new Map(metas.map((m) => [String(m.courseId), String(m.text)]));
    const byCourse = new Map();
    for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
      const id = String(e.courseId);
      if (!byCourse.has(id)) byCourse.set(id, []);
      byCourse.get(id).push(String(e.line));
    }
    this.#lines = byCourse;
  }

  has(courseId) {
    return this.#metas.has(String(courseId));
  }

  /** Create the course record (meta) and open its log. Throws if it exists. */
  initCourse({ courseId, owner, title, description = "", materials = [], seed, at, objectivesConfirm }) {
    if (this.#metas.has(courseId)) throw new Error(`course already exists: ${courseId}`);
    // Only the exact checkpoint-3 mode "explicit" is recorded (R4). Anything else writes NO field, so an auto
    // course's meta document and course.created event are byte-identical to a record written before the mode existed.
    const mode = objectivesConfirm === "explicit" ? { objectivesConfirm } : {};
    const meta = Object.freeze({
      courseId, owner, title, description, materials,
      seed, ...mode, createdAt: at ?? Date.now(),
    });
    const text = metaText(meta);
    this.#metas.set(courseId, text);
    this.#onWrite({ type: "meta", courseId, text });
    const log = this.log(courseId);
    log.append({ kind: "course.created", courseId, owner, title, description, materials, seed, ...mode, at: meta.createdAt });
    return meta;
  }

  meta(courseId) {
    const text = this.#metas.get(String(courseId));
    if (text === undefined) throw new Error(`unknown course: ${courseId}`);
    return JSON.parse(text);
  }

  log(courseId) {
    const id = String(courseId);
    return new ChainedLog({
      readRecords: () => (this.#lines.get(id) ?? []).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l)),
      writeRecord: (record) => {
        const line = recordLine(record);
        if (!this.#lines.has(id)) this.#lines.set(id, []);
        this.#lines.get(id).push(line);
        this.#onWrite({ type: "event", courseId: id, seq: record.seq, line });
      },
    });
  }

  list() {
    return [...this.#metas.keys()].sort().map((id) => JSON.parse(this.#metas.get(id)));
  }

  /** Every course's meta text and lines, for an export. Copies: the caller cannot reach the store. */
  snapshot() {
    return [...this.#metas.keys()].sort().map((courseId) => ({
      courseId, metaText: this.#metas.get(courseId), lines: [...(this.#lines.get(courseId) ?? [])],
    }));
  }
}
