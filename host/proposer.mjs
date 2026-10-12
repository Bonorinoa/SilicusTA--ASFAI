/**
 * proposer.mjs — the teacher's own words, turned into proposal items.
 *
 * This is the anti-invention seam. The host records what the teacher answered to
 * ASFAI's questionnaire; the answer to "What should learners be able to do by the
 * end?" IS a list of the teacher's own outcome sentences. This module restates
 * them as proposals for the teacher to accept, rename or drop. It never writes an
 * objective, and it never mints a Marble id: objective identity is the local
 * urn:uuid the gate assigns, never `mt_*` (which is optional alignment metadata).
 *
 * Pure: no I/O, no gate, no clock. Every branch here is a fact about the teacher's
 * input, so a caller cannot reach a proposal the teacher did not write.
 */

/** The label the UI shows beside a derived proposal. It must be the truth. */
export const SOURCE_FROM_ANSWERS = "from your answer to ASFAI";

/** The question id whose answer is the teacher's objective list. */
export const OUTCOMES_KEY = "learning_outcomes";

/**
 * @param {{learning_outcomes?: unknown} | null | undefined} answers  The teacher's recorded answers.
 * @returns {{kind: "local", statement: string}[]} one item per teacher sentence, verbatim. Empty if none.
 */
export function objectivesFromAnswers(answers) {
  const raw = answers && typeof answers === "object" ? answers[OUTCOMES_KEY] : null;
  const outcomes = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("\n") : [];
  return outcomes
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .map((statement) => ({ kind: "local", statement }));
}
