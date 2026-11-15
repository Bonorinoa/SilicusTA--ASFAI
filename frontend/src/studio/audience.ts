/**
 * audience.ts — the wizard's "Who are your learners?" state (G2b), kept pure so it can be tested
 * without rendering: the five stage cards, the exact-age steppers, the skill-map anchor, and what
 * the consequence strip says.
 *
 * The AI stage itself is the host's rule (host/ages.mjs, stageForAges: the YOUNGEST age sets it),
 * imported here so the wizard and the course record can never disagree. The plain-words lines
 * below are ours. The stage idea follows Sarah Chardonnens, SYNAPSE model (University of
 * Fribourg); none of her wording is used.
 */
import { COURSE_AGE_MAX, COURSE_AGE_MIN, stageForAges } from "../../../host/ages.mjs";

export type Stage = 1 | 2 | 3 | 4;

/** The five learner groups a teacher picks from. Each one only sets a starting age range. */
export const GROUPS = [
  { id: "early-primary", name: "Early primary", min: 4, max: 8, label: "4–8" },
  { id: "upper-primary", name: "Upper primary", min: 8, max: 12, label: "8–12" },
  { id: "lower-secondary", name: "Lower secondary", min: 12, max: 15, label: "12–15" },
  { id: "upper-secondary", name: "Upper secondary", min: 15, max: 19, label: "15–19" },
  { id: "adult", name: "University / adult", min: 18, max: 25, label: "18+" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];

/** One plain rule per AI stage: how a learner may use the AI helper. */
export const AI_RULE: Record<Stage, string> = {
  1: "Under 8: learners do not use the AI on their own. You lead, and the AI helps you prepare.",
  2: "From 8: learners use the AI in short, guided turns, with you close by.",
  3: "From 12: learners may ask the AI to explain. It does not do the work for them.",
  4: "From 15: learners may use the AI on their own. It still never grades.",
};

/** One line on how the drafted plan reads, by stage. */
export const PLAN_VOICE: Record<Stage, string> = {
  1: "Short sentences, things to touch and say aloud, play before words.",
  2: "Plain words, hands-on steps, one new idea at a time.",
  3: "Clear reasons and worked examples, with room to ask why.",
  4: "Subject vocabulary, argument and evidence.",
};

export const NO_SUGGESTIONS = "No suggestions at these ages: you write your own objectives.";

export interface Anchor { id: string; name: string; subject: string; ageRangeStart: number; ageRangeEnd: number }

export interface Audience {
  group: GroupId | null;
  ages: { min: number; max: number } | null;
  anchor: Anchor | null;
}

export const EMPTY_AUDIENCE: Audience = { group: null, ages: null, anchor: null };

/** Picking a card sets its range. An anchor that no longer overlaps the new range is dropped. */
export function selectGroup(a: Audience, id: GroupId): Audience {
  const g = GROUPS.find((x) => x.id === id);
  if (!g) return a;
  return keepAnchorIfFits({ ...a, group: g.id, ages: { min: g.min, max: g.max } });
}

/** The "Exact ages" steppers. Bounds are the host's (3–99) and min never passes max. */
export function stepAge(a: Audience, which: "min" | "max", delta: number): Audience {
  if (!a.ages) return a;
  let { min, max } = a.ages;
  if (which === "min") min = Math.min(Math.max(COURSE_AGE_MIN, min + delta), max);
  else max = Math.max(Math.min(COURSE_AGE_MAX, max + delta), min);
  return keepAnchorIfFits({ ...a, ages: { min, max } });
}

export function pickAnchor(a: Audience, anchor: Anchor): Audience { return { ...a, anchor }; }
export function clearAnchor(a: Audience): Audience { return { ...a, anchor: null }; }

function keepAnchorIfFits(a: Audience): Audience {
  if (!a.anchor || !a.ages) return a;
  const fits = a.anchor.ageRangeStart <= a.ages.max && a.anchor.ageRangeEnd >= a.ages.min;
  return fits ? a : { ...a, anchor: null };
}

export function stageOf(a: Audience): Stage | null {
  return a.ages ? (stageForAges(a.ages) as Stage | null) : null;
}

export function agesText(ages: { min: number; max: number } | null): string {
  if (!ages) return "";
  return ages.min === ages.max ? `Age ${ages.min}` : `Ages ${ages.min}–${ages.max}`;
}

/**
 * H2a: the bands an exact range touches. Bands share their edge ages (8, 12, 15), so an edge alone does not
 * count: 5–12 touches Early and Upper primary, not Lower secondary. A single age counts every band holding it.
 */
export function bandsTouched(ages: { min: number; max: number } | null): GroupId[] {
  if (!ages) return [];
  return GROUPS.filter((g) => ages.min === ages.max
    ? ages.min >= g.min && ages.min <= g.max
    : ages.min < g.max && ages.max > g.min).map((g) => g.id);
}

/** The line under the steppers: the range and the band(s) it covers, e.g. "Ages 5–12: Early primary and Upper primary". */
export function rangeLabel(ages: { min: number; max: number } | null): string {
  if (!ages) return "";
  const names = bandsTouched(ages).map((id) => GROUPS.find((g) => g.id === id)!.name);
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return list ? `${agesText(ages)}: ${list}` : agesText(ages);
}

export function groupName(a: Audience): string {
  return GROUPS.find((g) => g.id === a.group)?.name ?? "";
}

/** The skill-map tile: a topic count, or the no-coverage sentence. `null` count = not known yet. */
export function skillMapLine(overlapping: number | null): string {
  if (overlapping === null) return "Counting skill-map topics…";
  if (overlapping === 0) return NO_SUGGESTIONS;
  return `${overlapping.toLocaleString("en-US")} skill-map ${overlapping === 1 ? "topic fits" : "topics fit"} these ages.`;
}

/**
 * The brief's "course" answer, built from what the teacher chose. Words only: the host never parses
 * it for ages when structured ages exist. The class notes ride along as context for the AI.
 */
export function audienceAnswer(a: Audience, notes: string): string {
  const head = [groupName(a), agesText(a.ages).toLowerCase()].filter(Boolean).join(", ");
  const extra = notes.trim();
  return extra ? `${head}. ${extra}` : head;
}
