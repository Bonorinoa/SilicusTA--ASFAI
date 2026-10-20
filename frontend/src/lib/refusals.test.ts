/**
 * refusals.test.ts — R5: every code the contract names has three plain parts; none of them is machine text,
 * and the host's own words only ever reach the Details.
 */
import { describe, expect, it } from "vitest";
import { MESSAGES } from "../browser/site";
import { HostError } from "../gate/transport";
import { CONTRACT_CODES, REFUSALS, explainRefusal, fallbackRefusal, type Act } from "./refusals";

const MACHINE = /[A-Z]{3,}_[A-Z_]+|urn:|\{|\}|https?:/;
const ACTS: Act[] = ["propose", "suggest", "plan", "decide", "confirm", "brief", "publish", "ask", "create", "check", "other"];

describe("the refusal table covers every code in contract section 3", () => {
  for (const code of CONTRACT_CODES) {
    it(code, () => {
      const entry = REFUSALS[code];
      expect(entry, `${code} has no entry`).toBeDefined();
      for (const part of [entry.what, entry.saved, entry.next, ...Object.values(entry.nextFor ?? {})]) {
        expect(part.trim().length).toBeGreaterThan(10);
        expect(part).toMatch(/[.!]$/);
        expect(part).not.toMatch(MACHINE);
      }
      // the "saved" part answers the question it is for
      expect(entry.saved).toMatch(/[Nn]othing|kept|No /);
    });
  }

  it("every entry in the table, contract or not, reads the same way", () => {
    for (const [code, entry] of Object.entries(REFUSALS)) {
      for (const part of [entry.what, entry.saved, entry.next]) expect(part, code).not.toMatch(MACHINE);
    }
  });
});

describe("explainRefusal", () => {
  it("picks by code, never by the host's message, and keeps the message for Details", () => {
    const x = explainRefusal(new HostError("the drafting worker answered 503", "WORKER_UNREACHABLE"), "propose");
    expect(x).toMatchObject({ ...REFUSALS.WORKER_UNREACHABLE, code: "WORKER_UNREACHABLE", details: "The drafting worker answered 503." });
    expect(`${x.what} ${x.saved} ${x.next}`).not.toContain("503");
  });

  it("ROUND_NOTHING_NEW has three plain parts of its own and is in the contract list", () => {
    expect(CONTRACT_CODES).toContain("ROUND_NOTHING_NEW");
    const x = explainRefusal(new HostError("the worker proposed no objectives that are not already on this course", "ROUND_NOTHING_NEW"), "propose");
    expect(x.code).toBe("ROUND_NOTHING_NEW");
    expect(x.what).toContain("nothing new");
    expect(`${x.what} ${x.saved} ${x.next}`).not.toMatch(MACHINE);
  });

  it("ALREADY_PROPOSED's next step differs when nothing is actually waiting (F5)", () => {
    const waiting = explainRefusal(new HostError("earlier proposals are still waiting for your decision", "ALREADY_PROPOSED"), "propose", { alreadyProposedWaiting: true });
    expect(waiting.next).toContain("proposals waiting");
    const done = explainRefusal(new HostError("objectives have already been proposed for this course", "ALREADY_PROPOSED"), "propose", { alreadyProposedWaiting: false });
    expect(done.next).toContain("already run");
    expect(done.next).not.toContain("proposals waiting");
  });

  it("tells a wrong passcode from a dismissed prompt and from a prompt that could not open", () => {
    expect(explainRefusal(new HostError(MESSAGES.rejected, "PASSCODE_REQUIRED")).code).toBe("PASSCODE_REQUIRED");
    expect(explainRefusal(new HostError(MESSAGES.cancelled, "PASSCODE_REQUIRED")).code).toBe("PASSCODE_CANCELLED");
    expect(explainRefusal(new HostError(MESSAGES.dialogFailed, "PASSCODE_REQUIRED")).code).toBe("PASSCODE_DIALOG");
    expect(explainRefusal(new HostError("The demo passcode was not accepted, so the link was not read.", "PASSCODE_REQUIRED")).what).toBe(REFUSALS.PASSCODE_REQUIRED.what);
  });

  it("an act can carry its own next step (a plan can't be written by hand)", () => {
    expect(explainRefusal(new HostError("x", "WORKER_NOT_CONFIGURED"), "plan").next).toMatch(/plan needs AI drafting/);
    expect(explainRefusal(new HostError("x", "WORKER_NOT_CONFIGURED"), "propose").next).toMatch(/Write your own/);
  });

  it("an unknown code or a plain error falls back to words that still name what to try", () => {
    for (const act of ACTS) {
      const x = explainRefusal(new Error("socket hang up"), act);
      expect(x).toMatchObject(fallbackRefusal(act));
      expect(x.next).toMatch(/Try again/);
      expect(x.details).toBe("Socket hang up.");
      expect(`${x.what} ${x.saved} ${x.next}`).not.toMatch(MACHINE);
    }
  });
});
