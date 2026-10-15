/**
 * store.mjs — the append-only, hash-chained event log behind a Silicus course.
 *
 * Trust story: the log IS the source of record. Every mutation is one event;
 * each record carries a digest over (previous digest + the event), so altering,
 * reordering or dropping a past event is detectable (`verify()`), and an export
 * can carry the head digest as a sealed fingerprint.
 *
 * Zero dependencies: node:fs + node:crypto (via chain.mjs) only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { ChainedLog, GENESIS } from "./chain.mjs";

export { GENESIS };

/**
 * One course's append-only event log, kept as an NDJSON file. The chain rule (digest, verify) is
 * chain.mjs's, shared with the browser host; this class only says where the records live.
 */
export class EventLog extends ChainedLog {
  /** @param {string} path absolute path to the course's events.ndjson */
  constructor(path) {
    const readRecords = () => {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
    };
    super({ readRecords, writeRecord: (record) => appendFileSync(path, JSON.stringify(record) + "\n") });
    this.path = path;
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
