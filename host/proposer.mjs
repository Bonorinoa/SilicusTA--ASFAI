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
 * THE rule for how a teacher's raw answer to ASFAI's outcomes question becomes a
 * list of outcome sentences: one per line, trimmed, blanks dropped.
 *
 * ASFAI asks this as `kind: "open"` — one free-text field — but its own request
 * contract carries `learningOutcomes` as a LIST. One outcome per line is the
 * convention that bridges the two, and it must be defined exactly once:
 *
 *   - intake.mjs calls this to build the `learningOutcomes` array it sends ASFAI;
 *   - objectivesFromAnswers calls this to build the proposals the teacher confirms.
 *
 * Same function, so the objectives the teacher confirms and the outcomes ASFAI was
 * told are the same list by construction, and cannot drift apart in an edit.
 * Bounds (how many, how long) are the caller's business, not this rule's.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function outcomeSentences(raw) {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("\n") : [];
  return parts.map((s) => String(s ?? "").trim()).filter(Boolean);
}

/**
 * @param {{learning_outcomes?: unknown} | null | undefined} answers  The teacher's recorded answers.
 * @returns {{kind: "local", statement: string}[]} one item per teacher sentence, verbatim. Empty if none.
 */
export function objectivesFromAnswers(answers) {
  const raw = answers && typeof answers === "object" ? answers[OUTCOMES_KEY] : null;
  return outcomeSentences(raw).map((statement) => ({ kind: "local", statement }));
}
