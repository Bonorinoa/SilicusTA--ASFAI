/**
 * reasonText.test.ts — D3, in words. The host classifies each publish blocker into a code; this table is the ONE
 * place those codes become a sentence for a teacher. Raw gate text never reaches the reading path.
 */
import { describe, expect, it } from "vitest";
import type { PublishReason, PublishStatusView } from "../gate/types";
import { reasonText, reasonsFor } from "./reasonText";

describe("reasonText: one sentence per code", () => {
  const cases: [PublishReason, string][] = [
    [{ code: "CHECKPOINT_UNCONFIRMED", checkpoint: "files" }, "Confirm the material list"],
    [{ code: "CHECKPOINT_UNCONFIRMED", checkpoint: "outline" }, "Confirm the brief"],
    [{ code: "CHECKPOINT_UNCONFIRMED", checkpoint: "objectives" }, "Decide every proposed objective"],
    [{ code: "UNDECIDED_PROPOSALS", count: 3 }, "Decide the 3 proposed objectives still waiting"],
    [{ code: "NO_CONFIRMED_PLAN" }, "Confirm a lesson plan"],
    [{ code: "PLAN_INVALIDATED" }, "Re-confirm the plan: it cites an objective you revoked"],
    [{ code: "PLAN_EMPTY" }, "The plan has no activities"],
    [{ code: "PLAN_CITES_UNCONFIRMED", count: 2 }, "The plan cites 2 objectives you have not confirmed"],
    [{ code: "OTHER", text: "a brand new rule" }, "A brand new rule"],
  ];
  it.each(cases)("%j reads %s", (reason, words) => expect(reasonText(reason)).toBe(words));

  it("says the singular in the singular: never '1 objectives'", () => {
    expect(reasonText({ code: "UNDECIDED_PROPOSALS", count: 1 })).toBe("Decide the proposed objective still waiting");
    expect(reasonText({ code: "PLAN_CITES_UNCONFIRMED", count: 1 })).toBe("The plan cites an objective you have not confirmed");
    expect(reasonText({ code: "UNDECIDED_PROPOSALS", count: 1 })).not.toMatch(/\b1 objectives\b/);
  });

  it("an unrecognised blocker is kept, as the gate wrote it, never dropped and never made to look like ours", () => {
    expect(reasonText({ code: "OTHER", text: "lesson plan needs a title" })).toMatch(/lesson plan needs a title/i);
  });
});

describe("reasonsFor: the lines a PublishCard shows", () => {
  const status = (blockers: string[], reasons?: PublishReason[]): PublishStatusView => ({ canPublish: blockers.length === 0, blockers, ...(reasons ? { reasons } : {}) });

  it("uses the host's reasons, in the host's order, and never prints the raw gate text or an urn", () => {
    const s = status(
      ['checkpoint "files" is not teacher-confirmed', "undecided proposals await teacher decisions: urn:uuid:a, urn:uuid:b"],
      [{ code: "CHECKPOINT_UNCONFIRMED", checkpoint: "files" }, { code: "UNDECIDED_PROPOSALS", count: 2 }],
    );
    const lines = reasonsFor(s);
    expect(lines).toEqual(["Confirm the material list", "Decide the 2 proposed objectives still waiting"]);
    expect(lines.join(" ")).not.toMatch(/urn:|checkpoint "|is not teacher-confirmed/);
  });

  it("one line for several plan citations of unconfirmed objectives: they are counted, not repeated", () => {
    const s = status(["a", "b", "c"], [1, 2, 3].map(() => ({ code: "PLAN_CITES_UNCONFIRMED", count: 1 }) as PublishReason));
    expect(reasonsFor(s)).toEqual(["The plan cites 3 objectives you have not confirmed"]);
  });

  it("an older host that sends no reasons: the raw blockers, as before", () => {
    expect(reasonsFor(status(["no teacher-confirmed lesson plan"]))).toEqual(["no teacher-confirmed lesson plan"]);
  });

  it("a host whose reasons do not line up with its blockers is not trusted: the raw blockers, as before", () => {
    expect(reasonsFor(status(["x", "y"], [{ code: "PLAN_EMPTY" }]))).toEqual(["x", "y"]);
  });

  it("no blockers, no lines", () => {
    expect(reasonsFor(status([]))).toEqual([]);
  });
});
