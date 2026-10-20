import { describe, expect, it } from "vitest";
import { diagnose } from "./aiStatus";
import { isWebAddress, isYouTube, nameForPaste } from "./sourceIntake";

describe("diagnose (F5: one plain sentence and the fix)", () => {
  const base = { worker: { configured: true }, unreachable: false, browserMode: true, passcodeHeld: true };
  it("ready", () => expect(diagnose(base)).toMatchObject({ tone: "ok", label: "AI ready", fix: null }));
  it("checking while the status is unknown", () => expect(diagnose({ ...base, worker: null }).tone).toBe("checking"));
  it("passcode needed online, with the passcode action", () =>
    expect(diagnose({ ...base, worker: { configured: true, passcodeRequired: true }, passcodeHeld: false })).toMatchObject({ tone: "warn", action: "passcode" }));
  it("the passcode is never asked for in the local app", () =>
    expect(diagnose({ ...base, browserMode: false, worker: { configured: true, passcodeRequired: true }, passcodeHeld: false }).tone).toBe("ok"));
  it("not set up says what still works", () => {
    const d = diagnose({ ...base, worker: { configured: false } });
    expect(d.tone).toBe("off");
    expect(d.fix).toMatch(/write your own objectives/i);
  });
  it("unreachable offers to check again, in both builds", () => {
    expect(diagnose({ ...base, unreachable: true }).action).toBe("recheck");
    expect(diagnose({ ...base, browserMode: false, unreachable: true }).sentence).toMatch(/host on this computer/);
  });
  it("carries no machine text", () => {
    for (const d of [diagnose(base), diagnose({ ...base, unreachable: true }), diagnose({ ...base, worker: { configured: false } }), diagnose({ ...base, browserMode: false, worker: { configured: false } })]) {
      expect(`${d.sentence} ${d.fix ?? ""}`).not.toMatch(/[A-Z]{3,}_[A-Z]|WORKER|http|\{|urn:/);
    }
  });
});

describe("source intake (no name field)", () => {
  it("names pasted text by its first line, unique against what is held", () => {
    expect(nameForPaste("\n  Lesson notes  \nmore")).toBe("Lesson notes");
    expect(nameForPaste("Lesson notes", ["Lesson notes"])).toBe("Lesson notes (2)");
    expect(nameForPaste("")).toBe("Pasted text");
    const long = nameForPaste("Plants make their own food from light and water and air, which is a long first line indeed");
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
  });
  it("tells a web page address from text", () => {
    expect(isWebAddress("https://en.wikipedia.org/wiki/Solow")).toBe(true);
    expect(isWebAddress("http://example.com")).toBe(false);
    expect(isWebAddress("see https://example.com")).toBe(false);
    expect(isYouTube("https://www.youtube.com/watch?v=x")).toBe(true);
  });
});
