import { describe, expect, it } from "vitest";
import { adjustedNotes, aiPolicyPlain, reviewOffset, sessionEvidenceLine, showActivityAiTags, PHASE_LABEL, CHANNEL_LABEL } from "./design";

describe("learning-design wording (plan schema v2)", () => {
  it("restates the host's stage 1 and stage 2 AI lines in plain words", () => {
    expect(aiPolicyPlain("AI in this course: learners do not use AI at all; nothing a child makes goes into a tool. The teacher may use AI to prepare."))
      .toBe("Children don’t use AI in this lesson. You may use it to prepare.");
    expect(aiPolicyPlain("AI in this course: teacher-led and projected to the whole class, only after children state their own view first; no child uses AI alone."))
      .toMatch(/^Children don’t use AI on their own\./);
  });
  it("shows an unknown policy line as given, without the prefix; nothing for an absent one", () => {
    expect(aiPolicyPlain("AI in this course: something else.")).toBe("something else.");
    expect(aiPolicyPlain(undefined)).toBeNull();
    expect(aiPolicyPlain("  ")).toBeNull();
  });
  it("tags activities only when there is no plan-level line (stages 3-4)", () => {
    expect(showActivityAiTags({ aiPolicy: undefined })).toBe(true);
    expect(showActivityAiTags({ aiPolicy: "AI in this course: learners do not use AI at all." })).toBe(false);
  });
  it("names the four phases in the card's words", () => {
    expect(PHASE_LABEL).toEqual({ 1: "Notice and guess", 2: "Try and fix", 3: "Check own work", 4: "Keep and reuse" });
  });
  it("names channels as actions, never as a kind of learner", () => {
    for (const w of Object.values(CHANNEL_LABEL)) expect(w).not.toMatch(/learner|visual|auditory|kinesthetic|style/i);
  });
  it("words review offsets", () => {
    expect([1, 2, 6, 7, 14, 30].map(reviewOffset)).toEqual(["Tomorrow", "In 2 days", "In 6 days", "Next week", "In 2 weeks", "In 30 days"]);
    expect(reviewOffset(0)).toBe("Later");
  });
  it("gives one evidence line, naming sessions only when there are several", () => {
    expect(sessionEvidenceLine(undefined)).toBeNull();
    expect(sessionEvidenceLine([{ session: 1, evidence: { kind: "work-product", whatLearnerProduces: "A sorted strip." } }])).toBe("A sorted strip.");
    expect(sessionEvidenceLine([
      { session: 1, evidence: { kind: "observation", whatLearnerProduces: "A guess." } },
      { session: 2, evidence: { kind: "work-product", whatLearnerProduces: "A strip." } },
    ])).toBe("Session 1: A guess. · Session 2: A strip.");
  });
  it("keeps the host's notes short: clipped, at most six, the rest counted", () => {
    const long = "x".repeat(20000);
    const { shown, more } = adjustedNotes(["dropped phase: must be a whole number.", long, ...Array(6).fill("n")]);
    expect(shown[0]).toBe("Dropped phase: must be a whole number.");
    expect(shown[1].length).toBeLessThanOrEqual(180);
    expect(shown[1].endsWith("…")).toBe(true);
    expect(shown).toHaveLength(6);
    expect(more).toBe(2);
    expect(adjustedNotes(undefined)).toEqual({ shown: [], more: 0 });
    expect(adjustedNotes(['aiStatus "required" clamped to "permitted": never required.', "a permitted or required AI use needs a noAiAlternative."]).shown)
      .toEqual(['AI use "required" clamped to "permitted": never required.', "A permitted or required AI use needs a no-AI alternative."]);
  });
});
