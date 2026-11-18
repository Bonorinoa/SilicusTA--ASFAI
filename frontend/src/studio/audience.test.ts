/** audience.test.ts — G2b: the wizard's learner state, pure. */
import { describe, expect, it } from "vitest";
import {
  EMPTY_AUDIENCE, NO_SUGGESTIONS, agesText, audienceAnswer, clearAnchor, pickAnchor, selectGroup, skillMapLine, stageOf, stepAge,
} from "./audience";

const AI = { id: "mt_AzTrT5ySCx", name: "AI in daily life", subject: "Computing", ageRangeStart: 8, ageRangeEnd: 10 };

describe("audience state", () => {
  it("starts with nothing chosen and no stage", () => {
    expect(EMPTY_AUDIENCE.ages).toBeNull();
    expect(stageOf(EMPTY_AUDIENCE)).toBeNull();
  });
  it("a group card sets its range, and the youngest age sets the stage (host's stageForAges)", () => {
    expect(selectGroup(EMPTY_AUDIENCE, "early-primary").ages).toEqual({ min: 4, max: 8 });
    expect(stageOf(selectGroup(EMPTY_AUDIENCE, "early-primary"))).toBe(1);
    expect(stageOf(selectGroup(EMPTY_AUDIENCE, "upper-primary"))).toBe(2);
    expect(stageOf(selectGroup(EMPTY_AUDIENCE, "lower-secondary"))).toBe(3);
    expect(stageOf(selectGroup(EMPTY_AUDIENCE, "upper-secondary"))).toBe(4);
    expect(selectGroup(EMPTY_AUDIENCE, "adult").ages).toEqual({ min: 18, max: 25 });
  });
  it("steppers stay inside 3..99 and never cross", () => {
    let a = selectGroup(EMPTY_AUDIENCE, "early-primary");
    for (let i = 0; i < 5; i++) a = stepAge(a, "min", -1);
    expect(a.ages).toEqual({ min: 3, max: 8 });
    for (let i = 0; i < 10; i++) a = stepAge(a, "min", 1);
    expect(a.ages).toEqual({ min: 8, max: 8 });
    a = stepAge(a, "max", -1);
    expect(a.ages).toEqual({ min: 8, max: 8 });
    let b = selectGroup(EMPTY_AUDIENCE, "adult");
    for (let i = 0; i < 100; i++) b = stepAge(b, "max", 1);
    expect(b.ages?.max).toBe(99);
    expect(stepAge(EMPTY_AUDIENCE, "min", 1)).toBe(EMPTY_AUDIENCE);
  });
  it("an anchor is picked and cleared; it is dropped when the ages move away from it", () => {
    const a = pickAnchor(selectGroup(EMPTY_AUDIENCE, "upper-primary"), AI);
    expect(a.anchor?.id).toBe("mt_AzTrT5ySCx");
    expect(clearAnchor(a).anchor).toBeNull();
    expect(stepAge(a, "max", 1).anchor?.id).toBe("mt_AzTrT5ySCx");
    expect(selectGroup(a, "upper-secondary").anchor).toBeNull();
  });
  it("the no-coverage path says so plainly", () => {
    expect(skillMapLine(0)).toBe(NO_SUGGESTIONS);
    expect(NO_SUGGESTIONS).toBe("No suggestions at these ages: you write your own objectives.");
    expect(skillMapLine(1320)).toBe("1,320 skill-map topics fit these ages.");
    expect(skillMapLine(null)).toMatch(/Counting/);
  });
  it("the brief's audience answer is words from the choices plus the class notes", () => {
    const a = { ...selectGroup(EMPTY_AUDIENCE, "upper-primary"), ages: { min: 9, max: 10 } };
    expect(agesText(a.ages)).toBe("Ages 9–10");
    expect(agesText({ min: 9, max: 9 })).toBe("Age 9");
    expect(audienceAnswer(a, "")).toBe("Upper primary, ages 9–10");
    expect(audienceAnswer(a, " Grade 4 science ")).toBe("Upper primary, ages 9–10. Grade 4 science");
  });
});
