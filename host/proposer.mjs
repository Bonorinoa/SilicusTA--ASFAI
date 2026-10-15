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

/** The same, when the teacher answered the host's own questions and nothing left the machine. */
export const SOURCE_FROM_LOCAL_ANSWERS = "from your answer";

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
  // Every Unicode line terminator ends a line, and control / bidi characters are blanked: an outcome later
  // appears on a single line of the drafting prompt, and a stray U+2028 must not be able to start a new one.
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(LINE_BREAK) : [];
  return parts.map(cleanLine).filter(Boolean);
}

/** Every Unicode line terminator. */
const LINE_BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/;

/** Control and bidi characters: blanked, never passed through. THE character rule, defined once. */
const HOSTILE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

function cleanLine(s) {
  return String(s ?? "").replace(HOSTILE_CHARS, " ").trim();
}

/** The longest objective statement the teacher may write (the same bound intake.mjs puts on an outcome). */
export const MAX_STATEMENT_CHARS = 2000;

/** A teacher-typed statement was refused. `code` says why; the HTTP layer answers 422. */
export class StatementError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "StatementError";
    this.code = code;
  }
}

/**
 * The rule for a statement the teacher types for an objective (add, rename): it must be exactly ONE
 * outcome sentence under outcomeSentences' own rule. Control and bidi characters are blanked the same
 * way; a line break is refused rather than silently joining or splitting the teacher's words; the
 * length is bounded by refusal, never by truncation (a cut sentence is not the teacher's sentence).
 *
 * @param {unknown} raw
 * @returns {string} the cleaned statement
 * @throws {StatementError}
 */
export function teacherStatement(raw) {
  if (typeof raw !== "string") throw new StatementError("BAD_STATEMENT", "a statement must be text");
  const lines = outcomeSentences(raw);
  if (lines.length === 0) throw new StatementError("BAD_STATEMENT", "a statement must not be empty");
  if (lines.length > 1) throw new StatementError("STATEMENT_NOT_ONE_LINE", "an objective is one sentence on one line");
  if (lines[0].length > MAX_STATEMENT_CHARS) {
    throw new StatementError("STATEMENT_TOO_LONG", `an objective may be at most ${MAX_STATEMENT_CHARS} characters`);
  }
  return lines[0];
}

/**
 * @param {{learning_outcomes?: unknown} | null | undefined} answers  The teacher's recorded answers.
 * @returns {{kind: "local", statement: string}[]} one item per teacher sentence, verbatim. Empty if none.
 */
export function objectivesFromAnswers(answers) {
  const raw = answers && typeof answers === "object" ? answers[OUTCOMES_KEY] : null;
  return outcomeSentences(raw).map((statement) => ({ kind: "local", statement }));
}
