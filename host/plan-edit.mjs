/**
 * plan-edit.mjs — N3 (owner decision, 18 Nov): "everything generated should be editable".
 *
 * The AI proposes the plan's text; the teacher may change any of it. This module is the one place that
 * knows WHICH fields a teacher may edit, how each value is bounded (the same `clean` and the same limits
 * the model's output goes through), and how an edit is applied to a plan. It is pure: course.mjs records
 * the edit as a `plan.edited` event and re-proposes the edited plan to the gate, so the gate's own rules
 * (cited objectives, evidence kinds) still hold for a teacher's text.
 *
 * What an edit is NOT:
 *   - not a re-clamp. The stage rule clamps MODEL output only (worker.mjs). A teacher who sets an AI status
 *     the rule would not allow keeps it; the activity carries `teacherOverride` so the page says so.
 *   - not a silent change to a published version. An edit always produces a NEW draft plan bound to the next
 *     course version; the sealed version keeps its own record. The teacher confirms the edited plan.
 *   - not a provenance claim from the client. The client sends {path, value}; the host computes the hash of
 *     the value it replaces and records only the cleaned value.
 */
import { clean } from "./worker.mjs";
import { lengthNotes, TEXT_LIMITS } from "./lesson-length.mjs";
import { sha256Hex } from "./lib/sha256.mjs";

export class PlanEditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlanEditError";
    this.code = code;
  }
}

const AI_STATUSES = ["forbidden", "permitted", "required"];
/** The most edits one Save may carry: one activity's fields, never a whole replacement plan. */
export const MAX_EDITS = 12;
const MAX_LESSON_MINUTES = 180;

/** Activity fields a teacher may edit. `gate` fields live on the gate's record; the rest are host design. */
const ACTIVITY_FIELDS = Object.freeze({
  title: { kind: "text", max: TEXT_LIMITS.activityTitle, required: true, gate: true, label: "title" },
  minutes: { kind: "minutes", gate: true, label: "minutes" },
  phase: { kind: "phase", label: "phase" },
  learnerFirst: { kind: "text", max: 300, label: "learners first" },
  learnerDoes: { kind: "text", max: TEXT_LIMITS.does, required: true, gate: true, label: "learners" },
  teacherDoes: { kind: "text", max: TEXT_LIMITS.does, required: true, gate: true, label: "teacher" },
  decisionAfterHelp: { kind: "text", max: 300, label: "then they decide" },
  aiStatus: { kind: "aiStatus", label: "AI status" },
  noAiAlternative: { kind: "text", max: 300, label: "without AI" },
  evidenceIfAny: { kind: "evidence", gate: true, label: "evidence" },
  notEvidence: { kind: "text", max: 300, gate: true, label: "not evidence" },
});
/** The gate's evidence kinds. Student chat is never one (the gate refuses it too). */
const EVIDENCE = ["none", "observation", "work-product"];
const SESSION_FIELDS = Object.freeze({
  whatLearnerProduces: { kind: "text", max: 400, required: true, label: "evidence for this session" },
});
const REVIEW_FIELDS = Object.freeze({
  whatChanges: { kind: "text", max: 300, required: true, label: "what changes" },
  prompt: { kind: "text", max: 400, required: true, label: "prompt" },
});

/** The field paths the UI offers, for tests and docs. */
export const EDITABLE_PATHS = Object.freeze([
  "title",
  ...Object.keys(ACTIVITY_FIELDS).map((f) => `activities.N.${f}`),
  "sessions.N.evidence.whatLearnerProduces",
  ...Object.keys(REVIEW_FIELDS).map((f) => `spacedReviews.N.${f}`),
]);

/**
 * A path the teacher may edit, parsed against the plan it would change. Throws BAD_EDIT for anything else.
 * @returns {{path: string, scope: "plan"|"activity"|"session"|"review", index: number|null, field: string, spec: object}}
 */
export function parsePath(path, plan) {
  if (typeof path !== "string" || path.length > 80) throw new PlanEditError("BAD_EDIT", "an edit needs a field path");
  if (path === "title") return { path, scope: "plan", index: null, field: "title", spec: { kind: "text", max: TEXT_LIMITS.planTitle, required: true, gate: true, label: "plan title" } };
  let m = /^activities\.(\d{1,2})\.([A-Za-z]+)$/.exec(path);
  if (m) {
    const index = Number(m[1]);
    const spec = Object.hasOwn(ACTIVITY_FIELDS, m[2]) ? ACTIVITY_FIELDS[m[2]] : null;
    if (!spec) throw new PlanEditError("BAD_EDIT", `an activity's ${m[2]} cannot be edited here`);
    if (index >= plan.activities.length) throw new PlanEditError("BAD_EDIT", `the plan has no activity ${index + 1}`);
    return { path, scope: "activity", index, field: m[2], spec };
  }
  m = /^sessions\.(\d{1,2})\.evidence\.whatLearnerProduces$/.exec(path);
  if (m) {
    const index = Number(m[1]);
    if (!plan.sessions?.[index]?.evidence) throw new PlanEditError("BAD_EDIT", `the plan has no evidence line for session ${index + 1}`);
    return { path, scope: "session", index, field: "whatLearnerProduces", spec: SESSION_FIELDS.whatLearnerProduces };
  }
  m = /^spacedReviews\.(\d{1,2})\.([A-Za-z]+)$/.exec(path);
  if (m) {
    const index = Number(m[1]);
    const spec = Object.hasOwn(REVIEW_FIELDS, m[2]) ? REVIEW_FIELDS[m[2]] : null;
    if (!spec) throw new PlanEditError("BAD_EDIT", `a later review's ${m[2]} cannot be edited here`);
    if (!plan.spacedReviews?.[index]) throw new PlanEditError("BAD_EDIT", `the plan has no later review ${index + 1}`);
    return { path, scope: "review", index, field: m[2], spec };
  }
  throw new PlanEditError("BAD_EDIT", `\"${clean(path, 60)}\" is not a field a teacher edits`);
}

/** The teacher's value, bounded exactly like model output. `null` removes an optional field. */
export function normalizeValue(parsed, value, { hasAges = false } = {}) {
  const { spec } = parsed;
  switch (spec.kind) {
    case "text": {
      const v = typeof value === "string" ? clean(value, spec.max) : "";
      if (!v) {
        if (spec.required) throw new PlanEditError("BAD_EDIT", `the ${spec.label} cannot be empty`);
        return null;
      }
      return v;
    }
    case "minutes":
      if (!Number.isInteger(value) || value < 0 || value > MAX_LESSON_MINUTES) {
        throw new PlanEditError("BAD_EDIT", `minutes must be a whole number from 0 to ${MAX_LESSON_MINUTES}`);
      }
      return value;
    case "phase":
      if (value === null) return null;
      if (!Number.isInteger(value) || value < 1 || value > 4) throw new PlanEditError("BAD_EDIT", "a phase is a whole number from 1 to 4");
      return value;
    case "evidence":
      if (!EVIDENCE.includes(value)) throw new PlanEditError("BAD_EDIT", "evidence is none, observation or work-product; student chat is not evidence");
      return value;
    case "aiStatus":
      if (!hasAges) throw new PlanEditError("BAD_EDIT", "this course has no ages, so its activities carry no AI status");
      if (!AI_STATUSES.includes(value)) throw new PlanEditError("BAD_EDIT", "the AI status is forbidden, permitted or required");
      return value;
    default:
      throw new PlanEditError("BAD_EDIT", "unknown field kind");
  }
}

/** The value a path holds now (undefined when absent). */
export function valueAt(plan, parsed) {
  if (parsed.scope === "plan") return plan.title;
  if (parsed.scope === "activity") return plan.activities[parsed.index]?.[parsed.field];
  if (parsed.scope === "session") return plan.sessions?.[parsed.index]?.evidence?.whatLearnerProduces;
  return plan.spacedReviews?.[parsed.index]?.[parsed.field];
}

/** The hash a recorded edit keeps of the value it replaced: the record proves what it changed without copying it. */
export function valueSha(v) {
  return sha256Hex(JSON.stringify(v === undefined ? null : v));
}

/**
 * The stage rule for a learner AI status, as worker.mjs clamps MODEL output (same order, same outcomes).
 * Returns the status the rule would leave, or null when the rule allows `status` as it is.
 */
export function aiRuleFor(stage, status, learnerFirst) {
  let s = status;
  if (stage === 1 && s !== "forbidden") s = "forbidden";
  else if ((stage === 2 || stage === 3) && s === "required") s = "permitted";
  if (stage === 3 && s === "permitted" && !learnerFirst) s = "forbidden";
  return s === status ? null : s;
}

/** A deep, plain copy of a viewed plan: what an edit is applied to. */
function copy(plan) {
  return JSON.parse(JSON.stringify(plan));
}

function setAt(plan, parsed, v) {
  const put = (obj, key) => { if (v === null) delete obj[key]; else obj[key] = v; };
  if (parsed.scope === "plan") plan.title = v;
  else if (parsed.scope === "activity") put(plan.activities[parsed.index], parsed.field);
  else if (parsed.scope === "session") plan.sessions[parsed.index].evidence.whatLearnerProduces = v;
  else put(plan.spacedReviews[parsed.index], parsed.field);
}

const MISSING_NOTE = /^Activity (\d+) ".*" gives no minutes; it counts as 0\.$/;
const TOTAL_NOTE = /^Activities add up to \d+ min; you asked for \d+\. (Trim|Lengthen) or edit\.$/;

/**
 * Apply cleaned edits to a VIEWED plan (gate record + design overlay). Returns the edited copy.
 * The K2 minutes check re-runs on the result; the AI-status override is marked, never re-clamped.
 * @param {object} plan the viewed plan
 * @param {{parsed: object, value: unknown}[]} edits already parsed and normalized
 * @param {{stage: number|null, ages: {min:number,max:number}|null, lessonMinutes: number|null}} course
 */
export function applyEdits(plan, edits, { stage = null, ages = null, lessonMinutes = null } = {}) {
  const out = copy(plan);
  const notes = Array.isArray(out.notes) ? [...out.notes] : [];
  const missing = new Set(notes.map((n) => MISSING_NOTE.exec(n)).filter(Boolean).map((m) => Number(m[1]) - 1));
  for (const { parsed, value } of edits) {
    setAt(out, parsed, value);
    if (parsed.scope !== "activity") continue;
    const a = out.activities[parsed.index];
    if (parsed.field === "minutes") missing.delete(parsed.index);
    if (parsed.field === "aiStatus") {
      // The teacher's own status: the Silicus clamp marker no longer describes this activity.
      delete a.clamped;
      a.aiStatusBy = "teacher";
    }
  }
  // The override mark follows the teacher's status and the activity as it now reads (stage 3 needs a first try).
  for (const a of out.activities) {
    if (a.aiStatusBy !== "teacher") continue;
    const rule = aiRuleFor(stage, a.aiStatus, a.learnerFirst);
    if (rule) a.teacherOverride = { aiStatus: a.aiStatus, rule, ...(ages ? { ages: { min: ages.min, max: ages.max } } : {}) };
    else delete a.teacherOverride;
  }
  // K2: the minutes check re-runs. Only its own notes are replaced; every other note stays as Silicus wrote it.
  const kept = notes.filter((n) => !MISSING_NOTE.test(n) && !TOTAL_NOTE.test(n));
  const length = lengthNotes(out.activities.map((a, i) => ({ title: a.title, minutes: a.minutes, minutesMissing: missing.has(i) })), lessonMinutes);
  const next = [...length, ...kept];
  if (next.length > 0) out.notes = next; else delete out.notes;
  return out;
}

/** The trace line for one edit: "Activity 3: then they decide", "Plan title", "Later review 1: prompt". */
export function editLabel(parsed) {
  if (parsed.scope === "plan") return "Plan title";
  if (parsed.scope === "activity") return `Activity ${parsed.index + 1}: ${parsed.spec.label}`;
  if (parsed.scope === "session") return parsed.index === 0 ? "Evidence for this session" : `Session ${parsed.index + 1}: evidence`;
  return `Later review ${parsed.index + 1}: ${parsed.spec.label}`;
}

/** The gate's slice of an edited plan: the v1 fields, with the activity ids kept so the edit is the same activity. */
export function gateSpecOf(plan) {
  return {
    title: plan.title,
    ...(plan.audience ? { audience: { ...plan.audience } } : {}),
    activities: plan.activities.map((a) => ({
      id: a.id, title: a.title, minutes: a.minutes, objectiveIds: [...a.objectiveIds],
      materialVersionIds: [...(a.materialVersionIds ?? [])], learnerDoes: a.learnerDoes, teacherDoes: a.teacherDoes,
      evidenceIfAny: a.evidenceIfAny, ...(a.notEvidence !== undefined ? { notEvidence: a.notEvidence } : {}),
    })),
  };
}
