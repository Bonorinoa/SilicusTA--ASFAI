/**
 * V3 (docs/verification/2026-10-17-weekend-share.md) found "sealed" in teacher-facing strings that the stage test
 * cannot render: the first-run tour panels, the publish-cancel hint and the device-pin details in Record details.
 * The glossary allows "sealed" only in the publish confirmation itself ("Seal version N?").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PANELS } from "../components/FirstRunTour/panels";
import { comparePin } from "../gate/pin";

const RETIRED = /\b(outlines?|packages?|seal(ed|s|ing)?)\b/i;

describe("retired words outside the rendered stages", () => {
  it("the first-run tour says published, not sealed", () => {
    for (const p of PANELS) for (const line of [p.title, ...p.body]) expect(line, line).not.toMatch(RETIRED);
  });
  it("the publish-cancel hint says nothing was published, without 'seal'", () => {
    const src = readFileSync(join(__dirname, "../components/PublishCard/PublishCard.tsx"), "utf8");
    const hint = src.match(/flashHint\("([^"]+)"\)/g) ?? [];
    expect(hint.length).toBeGreaterThan(0);
    for (const h of hint) expect(h, h).not.toMatch(RETIRED);
  });
  it("device-pin details say published", () => {
    const pin = { version: 2, versionDigest: "a", events: 5, head: "h" };
    for (const cur of [{ versionDigest: "b", events: 5, head: "h" }, { versionDigest: "a", events: 5, head: "h" }]) {
      const r = comparePin(pin as never, cur as never);
      expect(r.detail, r.detail).not.toMatch(RETIRED);
    }
  });
});
