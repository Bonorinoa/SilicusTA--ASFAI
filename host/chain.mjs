/**
 * chain.mjs — the hash chain behind a course's event log, independent of WHERE the log is kept.
 *
 * The rule lives here once: each record carries a digest over (previous digest + the event), so
 * altering, reordering or dropping a past event is detectable. Two adapters keep the records:
 *   - store.mjs     an NDJSON file on disk (the Node host)
 *   - record-store  an in-memory copy written through to IndexedDB (the browser host)
 * Both hand ChainedLog the same two things (read every record, write one record), so the digest,
 * the verify rule and the record shape cannot drift apart between hosts.
 *
 * Pure: no I/O. `node:crypto` is the real one on Node and the shared synchronous SHA-256
 * (lib/sha256.mjs, via frontend/src/gate/crypto-shim.mjs) in the browser build.
 */
import { createHash } from "node:crypto";

export const GENESIS = "genesis";

/** Deterministic digest over (prevDigest, event). */
export function linkDigest(prev, event) {
  return createHash("sha256").update(`${prev}\n${JSON.stringify(event)}`).digest("hex");
}

/** Recompute a whole chain from its records and report integrity. */
export function verifyRecords(records) {
  let prev = GENESIS;
  let n = 0;
  for (const r of records) {
    n += 1;
    if (r.seq !== n) return { ok: false, reason: `sequence gap at record ${n}` };
    if (r.prev !== prev) return { ok: false, reason: `broken link at record ${n}` };
    if (linkDigest(prev, r.event) !== r.digest) return { ok: false, reason: `digest mismatch at record ${n}` };
    prev = r.digest;
  }
  return { ok: true, events: n, head: prev };
}

/**
 * One course's append-only log over an injected record source.
 * @param {{readRecords: () => object[], writeRecord: (record: {seq: number, prev: string, digest: string, event: object}) => void}} io
 */
export class ChainedLog {
  #readRecords;
  #writeRecord;
  #head = 0;
  #digest = GENESIS;

  constructor({ readRecords, writeRecord }) {
    this.#readRecords = readRecords;
    this.#writeRecord = writeRecord;
    const records = readRecords();
    if (records.length) {
      this.#head = records[records.length - 1].seq;
      this.#digest = records[records.length - 1].digest;
    }
  }

  /** @returns {readonly object[]} parsed records in order (no verification). */
  read() {
    return this.#readRecords();
  }

  /** Append one event; returns {seq, digest}. */
  append(event) {
    const seq = this.#head + 1;
    const prev = this.#digest;
    const digest = linkDigest(prev, event);
    this.#writeRecord({ seq, prev, digest, event });
    this.#head = seq;
    this.#digest = digest;
    return { seq, digest };
  }

  /** Recompute the whole chain from the source of record and report integrity. */
  verify() {
    return verifyRecords(this.read());
  }

  get count() {
    return this.#head;
  }

  get headDigest() {
    return this.#digest;
  }
}
