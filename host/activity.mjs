/**
 * activity.mjs — "who did what to which artifact", derived from the verified event log.
 *
 * Pure and replay-exact: the same records always give the same rows (no clock, no random ids), so a
 * reloaded session shows byte-identical activity. A reading aid, not the record: the log is the record,
 * and an event kind this table does not know is skipped rather than guessed at.
 *
 * `facts` hold counts, names and flags ONLY. Never material text, a passcode, a key, or a teacher's
 * free-text answer (an objective statement is already in the view; it is not repeated here).
 */
import { SOURCE_FROM_ANSWERS, SOURCE_FROM_LOCAL_ANSWERS } from "./proposer.mjs";

const CHECKPOINT_ARTIFACT = { files: "record", outline: "outline", objectives: "objectives", plan: "plan" };

/** Decision verbs, counted when present, in a fixed order so the output is stable. */
const VERBS = ["accept", "rename", "reword", "drop", "add"];

const count = (x) => (Array.isArray(x) ? x.length : 0);

/** @returns {{actor: string, action: string, artifact: string, facts: Record<string, string|number|boolean>} | null} */
function rowOf(event, published) {
  switch (event.kind) {
    case "course.created":
      return { actor: "teacher", action: "course.created", artifact: "record", facts: { materials: count(event.materials) } };
    case "checkpoint.confirmed":
      return { actor: "teacher", action: "checkpoint.confirmed", artifact: CHECKPOINT_ARTIFACT[event.id] ?? "record", facts: { checkpoint: String(event.id) } };
    case "intake.observed": {
      // `sent` is the NAMES of the fields that went to ASFAI (the host records names, never content).
      const sent = Array.isArray(event.sent) ? event.sent : [];
      if (sent.length > 0 || event.state === "ready_to_draft") {
        return { actor: "asfai", action: "intake.sent", artifact: "outline", facts: sent.length > 0 ? { fields: sent.length } : {} };
      }
      return { actor: "asfai", action: "intake.asked", artifact: "outline", facts: { questions: count(event.questions) } };
    }
    case "intake.answered":
      return { actor: "teacher", action: "intake.answered", artifact: "outline",
        facts: { answers: event.answers && typeof event.answers === "object" ? Object.keys(event.answers).length : 0 } };
    case "objectives.proposed": {
      const facts = { count: count(event.items) };
      if (event.assistantText) {
        const used = Array.isArray(event.materials) ? event.materials : [];
        if (used.length > 0) {
          facts.materials = used.length;   // a count: the rail's contract (names are already in the view's course)
          facts.characters = used.reduce((n, m) => n + (Number.isFinite(m?.chars) ? m.chars : 0), 0);
        }
        return { actor: "worker", action: "objectives.drafted", artifact: "objectives", facts };
      }
      const label = event.sources?.[0];
      if (label === SOURCE_FROM_ANSWERS) facts.source = "asfai";
      else if (label === SOURCE_FROM_LOCAL_ANSWERS) facts.source = "local";
      return { actor: "silicus", action: "objectives.derived", artifact: "objectives", facts };
    }
    case "objectives.decided": {
      const decisions = Array.isArray(event.decisions) ? event.decisions : [];
      const facts = { decisions: decisions.length };
      for (const verb of VERBS) {
        const n = decisions.filter((d) => d?.verb === verb).length;
        if (n > 0) facts[verb] = n;
      }
      return { actor: "teacher", action: "objectives.decided", artifact: "objectives", facts };
    }
    case "plan.proposed": {
      const facts = { activities: count(event.spec?.activities) };
      if (count(event.citations) > 0) facts.citations = event.citations.length;
      return { actor: "worker", action: "plan.drafted", artifact: "plan", facts };
    }
    case "plan.validated":
      return { actor: "asfai", action: "plan.checked", artifact: "plan", facts: { valid: event.valid === true, issues: count(event.issues) } };
    case "plan.confirmed":
      return { actor: "teacher", action: "plan.confirmed", artifact: "plan", facts: {} };
    case "package.published":
      return { actor: "teacher", action: "package.sealed", artifact: "package", facts: { version: published } };
    default:
      return null;
  }
}

/**
 * @param {readonly {seq: number, event: object}[]} records the verified log, oldest first
 * @returns {{seq: number, at: number, actor: string, action: string, artifact: string, facts: object}[]}
 */
export function activityOf(records) {
  const out = [];
  let published = 0;
  for (const { seq, event } of records) {
    if (event.kind === "package.published") published += 1;
    const row = rowOf(event, published);
    if (row) out.push({ seq, at: event.at, ...row });
  }
  return out;
}
