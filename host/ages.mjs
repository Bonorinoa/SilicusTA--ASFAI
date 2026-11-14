/**
 * ages.mjs — the course record's STRUCTURED ages (owner decision 14 Nov).
 *
 * The teacher's free-text "who it's for" answer still reaches the drafting prompt and is never
 * parsed for ages when the structured field exists. This module holds the pure rules: what a
 * valid `ages` block is, and the derived SYNAPSE-style stage (Sarah Chardonnens, SYNAPSE model,
 * University of Fribourg) that P2 will key the plan's voice and warm-up off.
 *
 * Stage bands (owner, 14 Nov): the YOUNGEST age sets the stage.
 *   1 (under 8), 2 (8-11), 3 (12-14), 4 (15+).
 */

export const COURSE_AGE_MIN = 3;
export const COURSE_AGE_MAX = 99;

/**
 * Validate a candidate `ages` value for the course record. Pure and sync, so it is called by
 * the handler (mapping to a 400) and by CourseSession.create (refusing to store nonsense).
 * Absent is fine (legacy courses keep working, and they get no Marble suggestions). Anything
 * present must be `{min, max}` whole years inside 3..99 with min <= max.
 *
 * @param {unknown} value
 * @returns {string | null} a plain-message reason, or null when the value is acceptable
 */
export function agesError(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "ages must be an object like { min, max }";
  const { min, max } = value;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return "ages.min and ages.max must be whole years";
  if (min < COURSE_AGE_MIN || max > COURSE_AGE_MAX) return `ages must stay within ${COURSE_AGE_MIN} and ${COURSE_AGE_MAX}`;
  if (min > max) return "ages.min cannot be older than ages.max";
  return null;
}

/**
 * The derived stage from the course's structured ages: the YOUNGEST age sets the stage.
 *   {min} < 8  -> 1 (foundational), 8-11 -> 2, 12-14 -> 3, 15+ -> 4.
 * @param {{min?: number}} [ages]
 * @returns {1 | 2 | 3 | 4 | null} null when there is no structured ages (legacy courses)
 */
export function stageForAges(ages = {}) {
  const m = Number(ages?.min);
  if (!Number.isFinite(m)) return null;
  if (m < 8) return 1;
  if (m <= 11) return 2;
  if (m <= 14) return 3;
  return 4;
}
