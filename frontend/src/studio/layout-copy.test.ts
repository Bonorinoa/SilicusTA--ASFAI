/**
 * layout-copy.test.ts — R5 · B4: the copy that points at where a tray sits must not assume a side.
 *
 * At 380 the proposals tray and the guardrail probes stack below the document, so "on the right" was
 * wrong on the phone. These are the strings jsdom cannot reach (they render deep inside the studio and
 * Rehearse), so the source is read directly — the same way retired-words.test.ts guards its copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("B4: layout-neutral copy instead of 'on the right'", () => {
  const FILES = ["steps/ObjectivesStep.tsx", "Rehearse.tsx", "../landing/Landing.tsx"];

  it("no user-facing string places the proposals tray or the probes on the right", () => {
    for (const f of FILES) expect(read(f), f).not.toMatch(/on the right/i);
  });

  it("names the place instead, so it reads the same at every width", () => {
    expect(read("steps/ObjectivesStep.tsx")).toMatch(/each proposal under Proposals/);
    expect(read("Rehearse.tsx")).toMatch(/a guardrail probe under Guardrail probes/);
    expect(read("../landing/Landing.tsx")).toMatch(/proposals wait under Proposals/);
  });
});
