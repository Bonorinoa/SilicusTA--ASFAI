import { describe, expect, it } from "vitest";
import { sourcesFootLine, sourcesPhrase } from "./sourceCount";

describe("N2: one source count", () => {
  it("counts files and web pages; the skill-map topics are named, not counted", () => {
    expect(sourcesPhrase(7, true)).toBe("7 sources and the skill-map topics");
    expect(sourcesPhrase(1, false)).toBe("1 source");
    expect(sourcesPhrase(0, true)).toBe("the skill-map topics");
    expect(sourcesPhrase(0, false)).toBe("");
  });
  it("a web page is never 'ready' before it is fetched", () => {
    const line = sourcesFootLine(5, 2, true)!;
    expect(line).toBe("7 sources: 5 read here, 2 web pages, fetched when Silicus reads them. Plus the skill-map topics.");
    expect(line).not.toMatch(/ready/);
    expect(sourcesFootLine(0, 1, false)).toBe("1 source: 1 web page, fetched when Silicus reads it.");
    expect(sourcesFootLine(0, 0, false)).toBeNull();
    expect(sourcesFootLine(0, 0, true)).toBe("Plus the skill-map topics.");
  });
});
