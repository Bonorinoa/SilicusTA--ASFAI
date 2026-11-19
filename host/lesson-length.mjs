/**
 * lesson-length.mjs — K2 (owner decision, 17 Nov): the teacher sets the lesson length; the plan fits it.
 *
 * One course is one lesson for December. The length is a whole number of minutes, 10 to 180, stored on the
 * course record as `lessonMinutes`. Absent means a legacy course: no length, no check, the prompt unchanged.
 *
 * The host checks the model's arithmetic but never redoes it: outside ±10% the plan is kept exactly as written
 * and the teacher gets a note under "Silicus adjusted". Spaced reviews happen after the lesson and are not
 * counted.
 *
 * The runaway bound (K2 item 5) lives here too: the most activities a plan may hold and the most characters
 * each free-text field keeps. The prompt states them and the host's clean() enforces them.
 */

export const LESSON_MINUTES_MIN = 10;
export const LESSON_MINUTES_MAX = 180;
/** The teacher's chips in the wizard; 45 is the default. */
export const LESSON_MINUTES_CHOICES = [20, 30, 45, 60, 90];
export const LENGTH_TOLERANCE = 0.1;

/** The most activities a lesson plan holds. A model that returns more keeps the first 8, with a note. */
export const MAX_ACTIVITIES = 8;
/** The most characters each free-text plan field keeps (the v2 fields keep their P2 limits in worker.mjs). */
export const TEXT_LIMITS = Object.freeze({ planTitle: 160, activityTitle: 120, does: 600 });

/** A plain refusal message, or null when the value is absent or a whole number from 10 to 180. */
export function lessonMinutesError(value) {
  if (value === undefined || value === null) return null;
  if (Number.isInteger(value) && value >= LESSON_MINUTES_MIN && value <= LESSON_MINUTES_MAX) return null;
  return `the lesson length must be a whole number of minutes from ${LESSON_MINUTES_MIN} to ${LESSON_MINUTES_MAX}`;
}

/** The tolerance band, in whole minutes the teacher can read: 45 -> 41 to 49. */
export function lengthBand(lessonMinutes) {
  return { low: Math.ceil(lessonMinutes * (1 - LENGTH_TOLERANCE)), high: Math.floor(lessonMinutes * (1 + LENGTH_TOLERANCE)) };
}

/** The prompt lines that state the length. Empty when the course has none, so the prompt is unchanged. */
export function lengthPromptLines(lessonMinutes) {
  if (!Number.isInteger(lessonMinutes)) return [];
  const { low, high } = lengthBand(lessonMinutes);
  return [
    `The lesson is ${lessonMinutes} minutes long. Activity minutes must add up to ${lessonMinutes}, within 10% (${low} to ${high}).`,
    "spacedReviews happen after the lesson and do not count toward these minutes.",
  ];
}

/**
 * Teacher-visible notes for a NORMALIZED activity list against the lesson length. Never changes a number.
 * An activity whose minutes were missing is named (it counts as 0). No length set: no notes at all.
 * @param {{title?: string, minutes: number, minutesMissing?: boolean}[]} activities
 * @param {number|null|undefined} lessonMinutes
 */
export function lengthNotes(activities, lessonMinutes) {
  if (!Number.isInteger(lessonMinutes)) return [];
  const notes = [];
  activities.forEach((a, i) => {
    if (a.minutesMissing) notes.push(`Activity ${i + 1} "${a.title ?? ""}" gives no minutes; it counts as 0.`);
  });
  const total = activities.reduce((n, a) => n + (Number.isFinite(a.minutes) ? a.minutes : 0), 0);
  const low = lessonMinutes * (1 - LENGTH_TOLERANCE);
  const high = lessonMinutes * (1 + LENGTH_TOLERANCE);
  if (total > high) notes.push(`Activities add up to ${total} min; you asked for ${lessonMinutes}. Trim or edit.`);
  else if (total < low) notes.push(`Activities add up to ${total} min; you asked for ${lessonMinutes}. Lengthen or edit.`);
  return notes;
}
