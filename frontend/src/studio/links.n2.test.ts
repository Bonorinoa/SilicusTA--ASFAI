import { describe, expect, it } from "vitest";
import { keysReadAfterRound } from "./links";
import { newSources } from "./steps/objectivesOffer";

describe("N2: a skipped link is not new since Silicus last read", () => {
  const materials = [{ name: "notes.txt", text: "x" }, { name: "bad.pdf", text: "" }, { url: "https://science.nasa.gov/moon" }, { url: "https://example.org/gone" }];
  const skipped = new Set(["bad.pdf", "https://example.org/gone"]);
  it("marks read links (also the skipped one) and read files, but not a skipped file", () => {
    expect(keysReadAfterRound(materials, skipped)).toEqual(["notes.txt", "https://science.nasa.gov/moon", "https://example.org/gone"]);
  });
  it("so right after a round, only the skipped file is new, never a skipped link", () => {
    const read = new Set(keysReadAfterRound(materials, skipped));
    expect(newSources(materials, [], read, {}).map((m) => ("url" in m ? m.url : m.name))).toEqual(["bad.pdf"]);
  });
});
