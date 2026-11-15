import type { ActivityView, LessonPlanView, PlanSessionView, SpacedReviewView } from "../../gate/types";

/**
 * Plain-words helpers for the learning design a v2 plan carries (phase, AI status, sessions,
 * spaced reviews, the host's clamp notes). Pure functions, so each wording is unit-tested.
 * A v1 plan has none of these fields, and every helper then returns "nothing to show".
 */

export const PHASE_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: "Notice and guess",
  2: "Try and fix",
  3: "Check own work",
  4: "Keep and reuse",
};

export const AI_STATUS_LABEL: Record<NonNullable<ActivityView["aiStatus"]>, string> = {
  forbidden: "No AI",
  permitted: "AI allowed",
  required: "AI needed",
};

/** Channels are what learners DO (talk, draw, handle…), never a kind of learner. */
export const CHANNEL_LABEL: Record<NonNullable<ActivityView["channels"]>[number], string> = {
  speaking: "talk",
  drawing: "draw",
  writing: "write",
  handling: "handle things",
  discussion: "discuss",
  diagram: "diagram",
  enactment: "act it out",
};

export const REVIEW_FORM_LABEL: Record<NonNullable<SpacedReviewView["form"]>, string> = {
  "recall-without-support": "Recall without help",
  "near-transfer": "Same idea, a new example",
  "far-transfer": "Same idea, a new setting",
  "explain-to-absent": "Explain it to someone who missed it",
};

/** The host's two stage lines (host/worker.mjs STAGE_AI_POLICY), restated for the teacher. */
const POLICY_PLAIN: { match: RegExp; plain: string }[] = [
  { match: /learners do not use AI at all/i, plain: "Children don’t use AI in this lesson. You may use it to prepare." },
  { match: /teacher-led and projected/i, plain: "Children don’t use AI on their own. You may show it to the whole class, after they have said what they think." },
];

/** The plan-level AI line in plain words; null when the plan has none (stages 3-4, or a v1 plan). */
export function aiPolicyPlain(policy: string | undefined): string | null {
  if (typeof policy !== "string" || policy.trim() === "") return null;
  const hit = POLICY_PLAIN.find((p) => p.match.test(policy));
  return hit ? hit.plain : policy.replace(/^AI in this course:\s*/i, "").trim();
}

/** "Tomorrow", "In 2 days", "Next week", "In 3 weeks". */
export function reviewOffset(afterDays: number): string {
  if (!Number.isFinite(afterDays) || afterDays < 1) return "Later";
  if (afterDays === 1) return "Tomorrow";
  if (afterDays === 7) return "Next week";
  if (afterDays % 7 === 0) return `In ${afterDays / 7} weeks`;
  return `In ${afterDays} days`;
}

/** One line for the session evidence; null when the plan names none. */
export function sessionEvidenceLine(sessions: readonly PlanSessionView[] | undefined): string | null {
  const rows = (sessions ?? []).filter((s) => s?.evidence?.whatLearnerProduces);
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0].evidence.whatLearnerProduces;
  return rows.map((s) => `Session ${s.session}: ${s.evidence.whatLearnerProduces}`).join(" · ");
}

/** The host's notes name schema fields; the teacher reads plain words instead. */
const FIELD_WORDS: [RegExp, string][] = [
  [/\baiStatus\b/g, "AI use"],
  [/\baiPolicy\b/g, "AI line"],
  [/\bnoAiAlternative\b/g, "no-AI alternative"],
  [/\boperationDoneBy\b/g, "who does the work"],
  [/\bhelpAfter\b/g, "help afterwards"],
  [/\bsupportingPhase\b/g, "second phase"],
  [/\blearnerFirst\b/g, "learners-first step"],
  [/\bdecisionAfterHelp\b/g, "decision after help"],
  [/\btargetOperation\b/g, "target skill"],
  [/\bspacedReviews\b/g, "later reviews"],
  [/\bwhatLearnerProduces\b/g, "what the learner produces"],
  [/\bwhatChanges\b/g, "what changes"],
  [/\bafterDays\b/g, "days until the review"],
];
export function plainNote(note: string): string {
  // PM 14 Nov: a "replaced the AI line" note must say what the plan shows. The host's note embeds the
  // raw stage line; the plan renders the plain-words restatement, so restate the note the same way.
  const m = note.match(/^replaced aiPolicy with the stage rule: (.*)$/i);
  if (m) {
    const plain = aiPolicyPlain(m[1]);
    return plain ? `replaced the AI line with this stage's rule: ${plain}` : "replaced the AI line with this stage's rule (shown above)";
  }
  return FIELD_WORDS.reduce((s, [re, w]) => s.replace(re, w), note);
}

const NOTE_MAX = 180;
const NOTES_MAX = 6;

/** The host's clamp notes, short: each clipped, at most six shown (the host does not bound them). */
export function adjustedNotes(notes: readonly string[] | undefined): { shown: string[]; more: number } {
  const all = (notes ?? []).filter((n) => typeof n === "string" && n.trim() !== "");
  const clip = (n: string) => {
    const one = n.replace(/\s+/g, " ").trim();
    return one.length > NOTE_MAX ? `${one.slice(0, NOTE_MAX - 1).trimEnd()}…` : one;
  };
  const shown = all.slice(0, NOTES_MAX).map((n) => { const p = plainNote(n); return clip(p.charAt(0).toUpperCase() + p.slice(1)); });
  return { shown, more: Math.max(0, all.length - NOTES_MAX) };
}

/** Per-activity AI tags show only when the plan has no plan-level line (stages 3-4). */
export function showActivityAiTags(plan: Pick<LessonPlanView, "aiPolicy">): boolean {
  return aiPolicyPlain(plan.aiPolicy) === null;
}
