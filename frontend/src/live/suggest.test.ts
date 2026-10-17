import { describe, expect, it } from "vitest";
import { HostError } from "../gate/transport";
import type { ProposalView } from "../gate/types";
import { SUGGEST_REFUSAL, suggestOffer, suggestRefusalText } from "./suggest";

const row = (source: string, status: ProposalView["status"] = "proposed"): ProposalView =>
  ({ id: `${source}-${status}`, kind: "local", status, statement: "s", originalStatement: "s", source, alignment: null, by: "ai" }) as unknown as ProposalView;

describe("suggestOffer", () => {
  it("is offered once the teacher's own proposals are on screen and one is undecided", () => {
    expect(suggestOffer([row("from your answer")], false, true)).toEqual({ show: true, blockedBy: null });
    expect(suggestOffer([row("your own objective", "accepted"), row("from your answer to ASFAI")], false, true).show).toBe(true);
  });
  it("is not offered with nothing proposed, with only material proposals, once all are decided, once confirmed, or without a worker", () => {
    expect(suggestOffer([], false, true).show).toBe(false);
    expect(suggestOffer([row("from material: notes.pdf")], false, true).show).toBe(false);
    expect(suggestOffer([row("from your answer", "accepted")], false, true).show).toBe(false);
    expect(suggestOffer([row("from your answer")], true, true).show).toBe(false);
    expect(suggestOffer([row("from your answer")], false, false).show).toBe(false);
  });
  it("is held, with the reason, while an earlier set of suggestions is undecided", () => {
    expect(suggestOffer([row("from your answer"), row("suggested by Silicus")], false, true)).toEqual({ show: true, blockedBy: SUGGEST_REFUSAL.SUGGESTIONS_PENDING });
  });
});

describe("suggestRefusalText: every host code has a plain sentence", () => {
  const codes = ["PROPOSE_FIRST", "NO_TEACHER_OUTCOMES", "SUGGESTIONS_PENDING", "OBJECTIVES_CONFIRMED", "CHECKPOINT_ORDER", "NO_USABLE_SUGGESTIONS", "WORKER_BAD_OUTPUT", "WORKER_NOT_CONFIGURED"];
  for (const code of codes) {
    it(code, () => {
      const text = suggestRefusalText(new HostError("raw host message", code));
      expect(text).toBe(SUGGEST_REFUSAL[code]);
      expect(text).not.toContain(code);
      expect(text).not.toContain("raw host message");
      expect(text).toMatch(/[.]$/);
    });
  }
  it("an unknown code still reads as a sentence, from the host's own words", () => {
    expect(suggestRefusalText(new HostError("the worker timed out", "WORKER_FAILED"))).toBe("Nothing was suggested. The worker timed out.");
  });
});
