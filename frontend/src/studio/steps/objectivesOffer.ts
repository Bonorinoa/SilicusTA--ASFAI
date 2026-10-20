/**
 * objectivesOffer.ts — which ways in the Objectives step puts in front of the teacher (R3 UI, R4 UI).
 *
 * Display only. The host decides: it refuses a round while one waits (ALREADY_PROPOSED), a confirmed set
 * (OBJECTIVES_CONFIRMED), a second derive (ALREADY_PROPOSED) and an early confirm (OBJECTIVES_PENDING,
 * NO_OBJECTIVES). This only chooses which buttons to show and whether to hold one, with the reason, so the
 * teacher is not invited to a click the host is sure to refuse. A held button is courtesy, not the rule.
 */
import type { ObjectivesMode, ProposalView } from "../../gate/types";
import { plural } from "../../lib/plural";

export const DECIDED = new Set(["accepted", "renamed", "added"]);
/** Model-written proposals carry one of these labels (host/course.mjs label(); SOURCE_SUGGESTED). */
const MODEL_LABEL = (source: string | null) => !!source && (source.startsWith("from material:") || source === "suggested by Silicus");
const ANSWER_LABEL = (source: string | null) => !!source && source.startsWith("from your answer");

export interface ObjectivesOffer {
  mode: ObjectivesMode;
  /** Writing your own: always, while the objectives are not confirmed. */
  canWrite: boolean;
  /** "Propose from my sources": shown, and held with a reason when a click would be refused. */
  sources: { show: boolean; heldBy: string | null };
  /** "Use my answers": the brief has outcomes and nothing has been derived from them yet. */
  answers: { show: boolean };
  /** Explicit mode only: the one primary, "Confirm objectives". */
  confirm: { show: boolean; enabled: boolean; text: readonly [lead: string, rest: string] };
}

export function objectivesOffer(args: {
  rows: readonly ProposalView[];
  mode: ObjectivesMode | undefined;
  confirmed: boolean;
  sourceCount: number;
  hasOutcomes: boolean;
  workerConfigured: boolean | undefined;
}): ObjectivesOffer {
  const mode: ObjectivesMode = args.mode === "explicit" ? "explicit" : "auto";
  const { rows, confirmed } = args;
  const waiting = rows.filter((r) => r.status === "proposed");
  const decided = rows.filter((r) => DECIDED.has(r.status));
  const modelWaiting = waiting.some((r) => MODEL_LABEL(r.source));
  const anyProposalRound = rows.some((r) => r.by !== "teacher");

  // Propose from sources. Explicit courses: a new round whenever nothing waits. Auto (older) courses: one round.
  const roundsLeft = mode === "explicit" ? true : !anyProposalRound;
  const showSources = !confirmed && args.sourceCount > 0 && !modelWaiting && roundsLeft;
  const heldBy = args.workerConfigured === false
    ? "AI drafting isn’t set up here. You can still write your own."
    : waiting.length > 0
      ? `Decide the ${plural(waiting.length, "proposal")} waiting first.`
      : null;

  const confirmText: [string, string] = waiting.length > 0
    ? [`${plural(waiting.length, "proposal")} waiting.`, "Decide each one, then confirm."]
    : decided.length === 0
      ? ["Nothing to confirm yet.", "Write or accept at least one objective."]
      : [`${plural(decided.length, "objective")} decided.`, "Confirm them when the set is complete; the plan is drafted from them."];

  return {
    mode,
    canWrite: !confirmed,
    sources: { show: showSources, heldBy: showSources ? heldBy : null },
    answers: { show: !confirmed && args.hasOutcomes && !anyProposalRound && !rows.some((r) => ANSWER_LABEL(r.source)) },
    confirm: { show: mode === "explicit" && !confirmed, enabled: decided.length > 0 && waiting.length === 0, text: confirmText },
  };
}
