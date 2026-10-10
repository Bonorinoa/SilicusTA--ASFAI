/**
 * crypto-shim.test.ts — the browser shim for `node:crypto` must be
 * byte-identical to Node's, or gate idempotency keys minted in the browser
 * would diverge from host-minted keys. (The alias maps `node:crypto` to the
 * shim; this test compares against the unaliased `crypto` builtin.)
 */
import { createHash as nodeCreateHash, randomUUID as nodeRandomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "./crypto-shim.mjs";

const SAMPLES = [
  "",
  "Add objective: Students can ask one honest question.",
  "a",
  "ünïcodé — em-dashes, emoji 🌱, and a very long statement ".repeat(20),
];

describe("crypto-shim (browser stand-in for node:crypto)", () => {
  it("sha256 base64url digests match node:crypto exactly", () => {
    for (const sample of SAMPLES) {
      const expected = nodeCreateHash("sha256").update(sample).digest("base64url");
      const actual = createHash("sha256").update(sample).digest("base64url");
      expect(actual, `digest mismatch for ${JSON.stringify(sample.slice(0, 30))}`).toBe(expected);
    }
  });

  it("sha256 hex digests match node:crypto exactly", () => {
    for (const sample of SAMPLES) {
      expect(createHash("sha256").update(sample).digest("hex")).toBe(
        nodeCreateHash("sha256").update(sample).digest("hex"),
      );
    }
  });

  it("mints well-formed uuid v4 ids (as the gate's local ids require)", () => {
    const id = randomUUID();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(nodeRandomUUID()).not.toBe(id);
    const urn = `urn:uuid:${id}`;
    expect(urn).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
