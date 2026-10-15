/**
 * archive.mjs — durable course archives (Sprint 2a).
 *
 * A sealed record leaves the host as an export (`course.mjs export()`). An archive
 * stores that exact JSON with a digest a reader can recompute, and — following the
 * ASFAI storage resource for a local file store (asfai-storage-local) — a save is
 * only "saved" after an atomic replace AND a read-back check:
 *
 *   1. write the complete JSON to a temp file in the same folder
 *   2. atomically replace the target
 *   3. reread and compare digests (the `asfai_storage` action `verify` discipline:
 *      expected vs actual), reporting verified only when they agree
 *
 * ASFAI handoff, honestly scoped: `asfai_storage` action `export` is the documented
 * way to hand a record over as JSON, and action `verify` is the documented
 * read-back. The Pod OBJECT operations (put_object/get_object/head_object) have no
 * published payload schema in asfai-learning 2.0.0, and the educator workspace
 * store explicitly does not hold course files — so a Pod-backed archive needs a
 * file-capable store (a connected Pod) and its field names must be confirmed
 * against the live server before any code depends on them. Not invented here.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { digestOf } from "./digest.mjs";

export { digestOf };

export class ArchiveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
  }
}

const slug = (ref) => String(ref).replace(/[^A-Za-z0-9._-]/g, "_");

export class LocalArchive {
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  #path(ref) {
    return join(this.root, `${slug(ref)}.json`);
  }

  /** Save a payload under a ref; verified is true only after the read-back matches. */
  save(ref, payload) {
    const record = { kind: "silicus.archive.v1", ref, digest: digestOf(payload), archivedAt: Date.now(), payload };
    const target = this.#path(ref);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
    renameSync(tmp, target);
    const readBack = JSON.parse(readFileSync(target, "utf8"));
    const verified = readBack.digest === record.digest && digestOf(readBack.payload) === record.digest;
    return { saved: true, verified, ref, digest: record.digest, path: target };
  }

  /** Load by ref; refuses a record that no longer matches its own digest. */
  load(ref) {
    const path = this.#path(ref);
    if (!existsSync(path)) throw new ArchiveError("UNKNOWN_ARCHIVE", `no archive for ref: ${ref}`);
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (digestOf(record.payload) !== record.digest) {
      throw new ArchiveError("ARCHIVE_DIGEST_MISMATCH", `archive ${ref} does not match its recorded digest`);
    }
    return record;
  }

  verify(ref, expectedDigest) {
    const record = this.load(ref);
    return { verified: record.digest === expectedDigest, ref, expected: expectedDigest, actual: record.digest };
  }

  list() {
    return readdirSync(this.root)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }
}
