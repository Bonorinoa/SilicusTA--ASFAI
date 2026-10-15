/**
 * passcode.mjs — the demo passcode gate.
 *
 * Unset or empty means NOT configured, and an unconfigured function refuses everything (503): it is
 * never an open proxy. The comparison hashes both sides to equal-length sha256 digests and compares
 * them with crypto.timingSafeEqual, so neither the content nor the length of the real passcode leaks
 * through response timing.
 */
import crypto from "node:crypto";

/** Is a passcode configured at all? */
export function passcodeConfigured(env) {
  return typeof env?.SILICUS_DEMO_PASSCODE === "string" && env.SILICUS_DEMO_PASSCODE.length > 0;
}

/** Constant-time check of the header value against the configured passcode. */
export function passcodeMatches(given, expected) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  const a = crypto.createHash("sha256").update(String(given ?? ""), "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  const same = crypto.timingSafeEqual(a, b);
  return same && typeof given === "string";
}
