/**
 * suggest.ts — when "Suggest up to 3 more" is offered, and what each refusal of the host says in plain words.
 *
 * Display only. The host decides (409/502 codes, host/course.mjs suggestObjectives); this only chooses which button
 * to put in front of the teacher and turns a code into words. An unknown code falls back to the table's generic
 * entry, which still names what to try, so a new refusal is never silent and never raw.
 */
import type { ProposalView } from "../gate/types";
import { explainRefusal, REFUSALS, refusalLine } from "../lib/refusals";

export const SUGGESTED_LABEL = "suggested by Silicus";
/** Labels that only the teacher's words may carry (glossary: objective sources). */
const TEACHER_SOURCES = new Set(["from your answer", "from your answer to ASFAI", "your own objective"]);

/**
 * One plain line per code, from the one refusal table (lib/refusals.ts, R5): what happened, whether anything was
 * saved or sent, and the one next action. Every code the host can answer suggest with (409, 502, 501) is there.
 */
export const SUGGEST_REFUSAL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(REFUSALS).map(([code, r]) => [code, refusalLine({ ...r, next: r.nextFor?.suggest ?? r.next })]),
);

/** The short reason under a held "Suggest up to 3 more" button. */
export const SUGGEST_HELD = "Decide the suggestions you already have first. Silicus offers one set at a time.";

/** Kept for the classic view (LiveCourse): the same three parts as the studio, as one line. */
export function suggestRefusalText(e: unknown): string {
  return refusalLine(explainRefusal(e, "suggest"));
}

export type SuggestOffer =
  | { show: false }
  | { show: true; blockedBy: string | null };

/**
 * Offered only after the teacher's own proposals are on screen, and only while at least one proposal is still
 * undecided (the checkpoint confirms itself once every proposal is decided). While an earlier set of suggestions
 * waits for a decision the button is there but held, with the reason.
 */
export function suggestOffer(rows: readonly ProposalView[], objectivesConfirmed: boolean, workerConfigured: boolean): SuggestOffer {
  if (objectivesConfirmed || !workerConfigured) return { show: false };
  const teacherRows = rows.some((r) => TEACHER_SOURCES.has(r.source ?? ""));
  const undecided = rows.some((r) => r.status === "proposed");
  if (!teacherRows || !undecided) return { show: false };
  const pending = rows.some((r) => r.source === SUGGESTED_LABEL && r.status === "proposed");
  return { show: true, blockedBy: pending ? SUGGEST_HELD : null };
}
