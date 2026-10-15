/**
 * sha256.test.mjs — the dependency-free SHA-256 the browser host runs must be byte-identical to node:crypto.
 * A log hashed in the browser has to verify on a Node host (and an export made on either must verify on the
 * other), so this is checked over many random inputs, every padding boundary, and multi-byte UTF-8.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { sha256, sha256Hex, base64url, toHex } from "../lib/sha256.mjs";

const nodeHex = (buf) => createHash("sha256").update(buf).digest("hex");

test("sha256 matches node:crypto on every length around the 64-byte block and padding boundaries", () => {
  for (let len = 0; len <= 300; len += 1) {
    const bytes = randomBytes(len);
    assert.equal(toHex(sha256(new Uint8Array(bytes))), nodeHex(bytes), `length ${len}`);
  }
});

test("sha256 matches node:crypto over 3000 random byte strings (up to 20 KB)", () => {
  for (let i = 0; i < 3000; i += 1) {
    const bytes = randomBytes(randomInt(0, i % 50 === 0 ? 20_000 : 600));
    assert.equal(toHex(sha256(new Uint8Array(bytes))), nodeHex(bytes));
  }
});

test("sha256Hex matches node:crypto on random Unicode text (UTF-8, astral, controls, bidi)", () => {
  const ranges = [[0x20, 0x7e], [0x00, 0x1f], [0xa0, 0x2ff], [0x2000, 0x206f], [0x4e00, 0x4fff], [0x1f300, 0x1f6ff]];
  for (let i = 0; i < 2000; i += 1) {
    let s = "";
    const n = randomInt(0, 200);
    for (let j = 0; j < n; j += 1) {
      const [lo, hi] = ranges[randomInt(0, ranges.length)];
      s += String.fromCodePoint(randomInt(lo, hi + 1));
    }
    assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"));
  }
});

test("base64url matches node:crypto's base64url digest encoding", () => {
  for (let i = 0; i < 500; i += 1) {
    const bytes = randomBytes(randomInt(0, 100));
    assert.equal(base64url(sha256(new Uint8Array(bytes))), createHash("sha256").update(bytes).digest("base64url"));
  }
});
