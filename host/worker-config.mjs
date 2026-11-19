/** Shared, credential-free worker configuration used by both hosts and the site functions. */

const REASONING_VALUES = new Set(["low", "medium", "high", "off", "model-default"]);

/** Keep reasoning on the fixed server allow-list; invalid values fall back instead of reaching a provider. */
export function normalizeReasoning(value, fallback = "model-default") {
  return REASONING_VALUES.has(value) ? value : fallback;
}

/** Turn the normalized setting into the OpenAI-wire object, or omit it for the model default. */
export function reasoningBody(value) {
  if (value === "low" || value === "medium" || value === "high") return { effort: value };
  if (value === "off") return { enabled: false };
  return undefined;
}

/**
 * N1 (L1 finding 3): per-task reasoning and deadlines, the same on both hosts. Ranking the skill map and answering a
 * student are short, judged-afterwards outputs: reasoning OFF (the L1 ranking spent ~8,000 output tokens, mostly
 * reasoning, ~100 s). Objectives and the plan keep the configured default. A task not listed keeps the default.
 * On the site the SERVER applies this from the task name; a client still cannot send a reasoning value.
 */
export const TASKS = Object.freeze(["rank", "answer", "answer_adult", "objectives", "suggest", "plan"]);
/*
 * N5 (PM decision on item 6, 18 Nov; record docs/verification/2026-11-18-n5-helper-tuning.md): the helper's reasoning
 * follows the course's recorded ages, the switch N4 uses (student.mjs adultCourse). Under 18, or no ages: "answer",
 * reasoning OFF (with the clarify prompt rule). 18+: "answer_adult", reasoning LOW (every eval bar passed at low).
 * The host picks the task name from the course, never from a request field; both keep the 20 s deadline.
 */
export const TASK_REASONING = Object.freeze({ rank: "off", answer: "off", answer_adult: "low" });
export const TASK_TIMEOUT_MS = Object.freeze({ rank: 25_000, answer: 20_000, answer_adult: 20_000 });

/** N5: the helper's task name for a course: "answer_adult" only for a strict-true 18+ course. */
export function answerTask(adult) {
  return adult === true ? "answer_adult" : "answer";
}

/** The reasoning a task runs with: its fixed setting, or the configured default. */
export function taskReasoning(task, configured) {
  return Object.hasOwn(TASK_REASONING, task) ? TASK_REASONING[task] : configured;
}

/** A task's deadline: its own, when shorter than the configured one. */
export function taskTimeoutMs(task, configured) {
  const own = Object.hasOwn(TASK_TIMEOUT_MS, task) ? TASK_TIMEOUT_MS[task] : Infinity;
  return Math.min(own, configured);
}

export const DEFAULT_TYPICAL_SECONDS = Object.freeze({
  objectives: Object.freeze([2, 10]),
  // H (14 Nov): the plan cap went 4000 -> 16000 tokens, so a long plan legitimately takes longer; the
  // "usually" range widens to match (the function's own deadline is unchanged at 115 s).
  plan: Object.freeze([10, 60]),
  answer: Object.freeze([2, 15]),
});

const tasks = Object.keys(DEFAULT_TYPICAL_SECONDS);
const copyDefaults = () => Object.fromEntries(tasks.map((task) => [task, [...DEFAULT_TYPICAL_SECONDS[task]]]));
const validRange = (value) => Array.isArray(value)
  && value.length === 2
  && value.every((n) => Number.isInteger(n) && n > 0)
  && value[0] <= value[1];

/** Parse optional per-task wait ranges. Invalid JSON or invalid task entries leave the defaults intact. */
export function typicalSecondsFromJson(raw) {
  const out = copyDefaults();
  if (typeof raw !== "string") return out;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const task of tasks) {
    if (validRange(parsed[task])) out[task] = [...parsed[task]];
  }
  return out;
}
