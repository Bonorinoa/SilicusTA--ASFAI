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
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** @param {Uint8Array} bytes @returns {Uint8Array} sha-256 digest */
function sha256(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array((len + 9 + 63) & ~63);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  dv.setUint32(padded.length - 4, (len * 8) >>> 0);

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return new Uint8Array([
    (h0 >>> 24) & 0xff, h0 >>> 16 & 0xff, h0 >>> 8 & 0xff, h0 & 0xff,
    (h1 >>> 24) & 0xff, h1 >>> 16 & 0xff, h1 >>> 8 & 0xff, h1 & 0xff,
    (h2 >>> 24) & 0xff, h2 >>> 16 & 0xff, h2 >>> 8 & 0xff, h2 & 0xff,
    (h3 >>> 24) & 0xff, h3 >>> 16 & 0xff, h3 >>> 8 & 0xff, h3 & 0xff,
    (h4 >>> 24) & 0xff, h4 >>> 16 & 0xff, h4 >>> 8 & 0xff, h4 & 0xff,
    (h5 >>> 24) & 0xff, h5 >>> 16 & 0xff, h5 >>> 8 & 0xff, h5 & 0xff,
    (h6 >>> 24) & 0xff, h6 >>> 16 & 0xff, h6 >>> 8 & 0xff, h6 & 0xff,
    (h7 >>> 24) & 0xff, h7 >>> 16 & 0xff, h7 >>> 8 & 0xff, h7 & 0xff,
  ]);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** @param {Uint8Array} bytes @returns {string} unpadded base64url */
function base64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 63];
  }
  return out;
}

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
    return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
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
