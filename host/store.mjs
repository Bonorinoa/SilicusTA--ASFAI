/**
 * store.mjs — the append-only, hash-chained event log behind a Silicus course.
 *
 * Trust story: the log IS the source of record. Every mutation is one event;
 * each record carries a digest over (previous digest + the event), so altering,
 * reordering or dropping a past event is detectable (`verify()`), and an export
 * can carry the head digest as a sealed fingerprint.
 *
 * Zero dependencies: node:fs + node:crypto only.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export const GENESIS = "genesis";

/** Deterministic digest over (prevDigest, event). */
function linkDigest(prev, event) {
  return createHash("sha256").update(`${prev}\n${JSON.stringify(event)}`).digest("hex");
}

/** One course's append-only event log. */
export class EventLog {
  /** @param {string} path absolute path to the course's events.ndjson */
  constructor(path) {
    this.path = path;
    this.#head = 0;
    this.#digest = GENESIS;
    if (existsSync(path)) {
      const records = this.read();
      if (records.length) {
        this.#head = records[records.length - 1].seq;
        this.#digest = records[records.length - 1].digest;
      }
    }
  }

  #head;
  #digest;

  /** @returns {readonly object[]} parsed records in order (no verification). */
  read() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  }

  /** Append one event; returns {seq, digest}. */
  append(event) {
    const seq = this.#head + 1;
    const prev = this.#digest;
    const digest = linkDigest(prev, event);
    appendFileSync(this.path, JSON.stringify({ seq, prev, digest, event }) + "\n");
    this.#head = seq;
    this.#digest = digest;
    return { seq, digest };
  }

  /** Recompute the whole chain from disk and report integrity. */
  verify() {
    let prev = GENESIS;
    let n = 0;
    for (const r of this.read()) {
      n += 1;
      if (r.seq !== n) return { ok: false, reason: `sequence gap at record ${n}` };
      if (r.prev !== prev) return { ok: false, reason: `broken link at record ${n}` };
      if (linkDigest(prev, r.event) !== r.digest) return { ok: false, reason: `digest mismatch at record ${n}` };
      prev = r.digest;
    }
    return { ok: true, events: n, head: prev };
  }

  get count() {
    return this.#head;
  }

  get headDigest() {
    return this.#digest;
  }
}

/** Filesystem layout: <root>/<slug>/meta.json + events.ndjson. */
export class CourseStore {
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  #slug(courseId) {
    return String(courseId).replace(/[^A-Za-z0-9._-]/g, "_");
  }

  #dir(courseId) {
    const dir = join(this.root, this.#slug(courseId));
    const rel = relative(this.root, dir);
    // `.` and `..` survive the slug filter (dots are legal in ids) and join() would
    // resolve them OUT of the data directory. Refuse anything that is not a child.
    if (!rel || rel === "." || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
      const e = new Error("course id escapes the data directory");
      e.code = "BAD_COURSE_ID";
      throw e;
    }
    return dir;
  }

  has(courseId) {
    try {
      return existsSync(join(this.#dir(courseId), "meta.json"));
    } catch (e) {
      if (e.code === "BAD_COURSE_ID") return false; // a traversal id is "not a course", not a crash
      throw e;
    }
  }

  /** Create the course record (meta.json) and open its log. Throws if it exists. */
  initCourse({ courseId, owner, title, description = "", materials = [], seed, at }) {
    const dir = this.#dir(courseId);
    if (existsSync(join(dir, "meta.json"))) throw new Error(`course already exists: ${courseId}`);
    mkdirSync(dir, { recursive: true });
    const meta = Object.freeze({
      courseId, owner, title, description, materials,
      seed, createdAt: at ?? Date.now(),
    });
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
    const log = this.log(courseId);
    log.append({ kind: "course.created", courseId, owner, title, description, materials, seed, at: meta.createdAt });
    return meta;
  }

  meta(courseId) {
    const p = join(this.#dir(courseId), "meta.json");
    if (!existsSync(p)) throw new Error(`unknown course: ${courseId}`);
    return JSON.parse(readFileSync(p, "utf8"));
  }

  log(courseId) {
    return new EventLog(join(this.#dir(courseId), "events.ndjson"));
  }

  list() {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(this.root, d.name, "meta.json")))
      .map((d) => JSON.parse(readFileSync(join(this.root, d.name, "meta.json"), "utf8")));
  }
}
