/**
 * suggest.ts — when "Suggest up to 3 more" is offered, and what each refusal of the host says in plain words.
 *
 * Display only. The host decides (409/502 codes, host/course.mjs suggestObjectives); this only chooses which button
 * to put in front of the teacher and turns a code into a sentence. An unknown code falls back to the host's own
 * message, capitalised, so a new refusal is never silent and never raw.
 */
import type { ProposalView } from "../gate/types";

export const SUGGESTED_LABEL = "suggested by Silicus";
/** Labels that only the teacher's words may carry (glossary: objective sources). */
const TEACHER_SOURCES = new Set(["from your answer", "from your answer to ASFAI", "your own objective"]);

/** One plain sentence per code. Every code the host can answer with (409, 502, 501) is here. */
export const SUGGEST_REFUSAL: Readonly<Record<string, string>> = {
  PROPOSE_FIRST: "Propose objectives from your answers first. Silicus suggests ones that round out that first set.",
  NO_TEACHER_OUTCOMES: "Add at least one outcome of your own first. Silicus suggests ones that round out yours.",
  SUGGESTIONS_PENDING: "Decide the suggestions you already have first. Silicus offers one set at a time.",
  OBJECTIVES_CONFIRMED: "Your objectives are already confirmed, so Silicus can\u2019t add suggestions. They are offered before you finish deciding.",
  CHECKPOINT_ORDER: "Confirm your brief first. Then Silicus can suggest objectives.",
  NO_USABLE_SUGGESTIONS: "Silicus had nothing new to suggest, so nothing was added.",
  WORKER_BAD_OUTPUT: "The drafting model\u2019s answer could not be used, so nothing was added. You can ask again.",
  WORKER_NOT_CONFIGURED: "No drafting model is set up here, so Silicus can\u2019t suggest objectives. Everything else still works.",
};

const sentence = (m: string) => { const t = m.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : ""; };

export function suggestRefusalText(e: unknown): string {
  const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "";
  if (SUGGEST_REFUSAL[code]) return SUGGEST_REFUSAL[code];
  const message = e instanceof Error ? e.message : String(e);
  return `Nothing was suggested. ${sentence(message)}`;
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
  return { show: true, blockedBy: pending ? SUGGEST_REFUSAL.SUGGESTIONS_PENDING : null };
}
