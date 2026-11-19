import { describe, expect, it } from "vitest";
import { planLines, rankingLines } from "./mapLines";

describe("M1 wait lines", () => {
  it("ranking: counts filled in; line 3 only when a title word is in no topic name; names, never descriptions", () => {
    const lines = rankingLines({ fit: 1599, total: 1912, ages: { min: 4, max: 10 }, title: "Why is the grass green?", missingWord: "grass" });
    expect(lines).toEqual([
      "Keeping the 1,599 of 1,912 topics that fit ages 4–10",
      "Reading “Why is the grass green?” against their names",
      "“Grass” isn’t a topic on the map, so Silicus looks for the ideas behind it",
      "Grouping what fits into threads",
      "Finding what comes before and after each suggestion",
    ]);
    expect(rankingLines({ fit: 10, total: 20, ages: { min: 7, max: 9 }, title: "Reflecting light", missingWord: null })).toHaveLength(4);
    expect(lines.join(" ")).not.toMatch(/description|✓|%/);
  });
  it("plan: state-dependent lines appear only when true", () => {
    const full = planLines({ anchor: "Reflecting Light", before: "Light & Seeing in the Dark", connected: "What Plants Need to Thrive", sources: ["kidsgardening blog", "Skill map"], minutes: 45, ages: { min: 4, max: 10 }, stage: 1, objectives: 3 });
    expect(full).toHaveLength(9);
    expect(full[0]).toBe("Starting from your anchor: Reflecting Light, for ages 4–10");
    const bare = planLines({ anchor: null, before: null, connected: null, sources: [], minutes: 45, ages: { min: 9, max: 10 }, stage: 2, objectives: 1 });
    expect(bare).toEqual(["Fitting the activities into 45 minutes", "Tying each activity to your objective", "Checking every objective is used, and none twice"]);
  });
});
