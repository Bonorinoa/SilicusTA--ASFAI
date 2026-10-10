/**
 * seal.ts — tamper-evident export helper (B).
 *
 * The export the teacher downloads is opaque JSON with a sha-256 digest over
 * the EXACT payload bytes. Anyone (the school, a colleague, an auditor) can
 * re-derive the digest from the shipped file: recompute
 * `JSON.stringify(payload, null, 2)` and compare. Any alteration to the
 * payload changes the digest.
 *
 * The digest uses the same parity-tested crypto shim the confirm-gate relies
 * on for idempotency keys, so browser output is byte-identical to host output.
 */
import { createHash } from "./crypto-shim.mjs";

/**
 * SHA-256 of a serialized JSON payload, hex-encoded (64 chars).
 * Feed it the exact bytes shipped as the file's `payload` field.
 */
export function sealDigest(serializedPayload: string): string {
  return createHash("sha256").update(serializedPayload).digest("hex");
}

/**
 * Build the export file's body: `{ payload, digest }` where digest covers
 * `JSON.stringify(payload, null, 2)` — the same formatting that ships.
 */
export function buildSealedExport(payload: unknown): { payload: unknown; digest: string } {
  const json = JSON.stringify(payload, null, 2);
  return { payload, digest: sealDigest(json) };
}