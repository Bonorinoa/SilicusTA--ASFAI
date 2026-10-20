/** sourceUse.test.ts — R6: what the Sources panel says about each source, counted, never decided. */
import { describe, expect, it } from "vitest";
import { legacyNames, namesInLabel, recordedNames, skippedLine, skipReason, sourceKey, usedFor, usedLine } from "./sourceUse";

const p = (source: string | null) => ({ source });

describe("used for N proposals", () => {
  it("counts the proposals whose material label names this source exactly", () => {
    const props = [p("from material: Lesson notes"), p("from material: Lesson notes, Slides"), p("from material: Slides"), p("your own objective"), p(null)];
    expect(usedFor("Lesson notes", props)).toBe(2);
    expect(usedFor("Slides", props)).toBe(2);
    expect(usedFor("lesson notes", props)).toBe(0);
    expect(usedFor("Lesson", props)).toBe(0);
  });
  it("\"(several)\" credits no source", () => {
    expect(namesInLabel("from material: (several)")).toEqual([]);
    expect(usedFor("Lesson notes", [p("from material: (several)")])).toBe(0);
  });
  it("a name with a comma still matches the whole label", () => {
    expect(usedFor("Notes, week 1", [p("from material: Notes, week 1")])).toBe(1);
  });
  it("says the count with the plural helper", () => {
    expect(usedLine(1)).toBe("Used for 1 proposal");
    expect(usedLine(3)).toBe("Used for 3 proposals");
  });
});

describe("skipped", () => {
  it("names the reason in plain words from the code, never the host's sentence", () => {
    const skipped = [{ name: "https://x.test/a", code: "URL_UNREACHABLE", reason: "fetch failed: ECONNREFUSED" }];
    expect(skippedLine("https://x.test/a", skipped)).toBe("Skipped: the page could not be opened");
    expect(skippedLine("https://x.test/a", skipped)).not.toMatch(/ECONN|fetch/);
    expect(skippedLine("other", skipped)).toBeNull();
  });
  it("falls back to the refusal table, then to a generic line", () => {
    expect(skipReason("NO_MATERIALS")).toBe("There was no readable source to propose from");
    expect(skipReason("SOMETHING_NEW")).toBe("Silicus could not read it");
    expect(skipReason(undefined)).toBe("Silicus could not read it");
  });
});

describe("legacy names", () => {
  it("an attached file matches a legacy name ignoring case and extension", () => {
    expect(sourceKey("Lesson Notes.PDF")).toBe(sourceKey("lesson notes.docx"));
    expect(legacyNames(["Lesson Notes.pdf", "Syllabus"], [{ name: "lesson notes.docx" }])).toEqual(["Syllabus"]);
    expect(legacyNames(["Syllabus"], [{ name: "SYLLABUS.txt" }])).toEqual([]);
  });
  it("does not strip what is not an extension", () => {
    expect(legacyNames(["Week 1. Plants"], [{ name: "Week 1" }])).toEqual(["Week 1. Plants"]);
  });
});

describe("a link's page title maps back to its row", () => {
  it("maps inputs minus the skipped ones onto the host's read list, in order", () => {
    const inputs = [{ name: "Lesson notes", text: "…" }, { url: "https://a.test/x" }, { url: "https://b.test/y" }];
    const map = recordedNames(inputs, [{ name: "https://a.test/x", code: "URL_REFUSED" }], [{ name: "Lesson notes" }, { name: "How leaves work" }]);
    expect(map).toEqual({ "Lesson notes": "Lesson notes", "https://b.test/y": "How leaves work" });
    expect(usedFor(map["https://b.test/y"], [{ source: "from material: How leaves work" }])).toBe(1);
  });
  it("maps nothing when the counts disagree", () => {
    expect(recordedNames([{ url: "https://a.test/x" }], [], [])).toEqual({});
  });
});
