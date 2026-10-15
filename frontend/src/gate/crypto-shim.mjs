/**
 * crypto-shim.mjs — browser stand-in for the two `node:crypto` primitives that
 * ../confirm-gate/confirm-gate.mjs imports (`createHash("sha256")` for decision
 * idempotency keys, `randomUUID` for local id minting).
 *
 * The confirm-gate core is used UNMODIFIED; vite.config.ts aliases `node:crypto`
 * to this module for browser/test builds. Outputs are byte-identical to Node's
 * (asserted by src/gate/crypto-shim.test.ts against the real `crypto` module),
 * so idempotency keys minted in the browser match keys minted on the host.
 *
 * Note: host-guard.mjs needs no shim at all — it is pure JS and bundles as-is.
 * The SHA-256 itself lives in host/lib/sha256.mjs (one implementation, shared with the browser host).
 */

import { sha256, base64url, toHex } from "../../../host/lib/sha256.mjs";

const encoder = new TextEncoder();

class Hash {
  /** @param {Uint8Array[]} chunks */
  constructor(chunks) {
    this._chunks = chunks;
  }
  /** @param {string|Uint8Array} data */
  update(data) {
    this._chunks.push(typeof data === "string" ? encoder.encode(data) : data);
    return this;
  }
  /** @param {string} [encoding] */
  digest(encoding = "hex") {
    const total = this._chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of this._chunks) {
      all.set(c, at);
      at += c.length;
    }
    const out = sha256(all);
    if (encoding === "base64url") return base64url(out);
    if (encoding === "base64") {
      const b64 = base64url(out).replace(/-/g, "+").replace(/_/g, "/");
      return b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    }
    return toHex(out);
  }
}

/** Node-compatible `createHash`, supporting the sha256 algorithm. */
export function createHash(algorithm) {
  if (algorithm !== "sha256") {
    throw new Error(`crypto-shim: unsupported hash algorithm "${algorithm}" (only sha256)`);
  }
  return new Hash([]);
}

/** Node-compatible `randomUUID` (UUID v4). */
export function randomUUID() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default { createHash, randomUUID };
