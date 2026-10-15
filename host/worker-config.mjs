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

export const DEFAULT_TYPICAL_SECONDS = Object.freeze({
  objectives: Object.freeze([3, 15]),
  plan: Object.freeze([5, 25]),
  answer: Object.freeze([2, 8]),
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
