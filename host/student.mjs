/**
 * student.mjs — a student asks about a PUBLISHED course. This is USE of the package, never evidence.
 *
 * The rules, whole:
 *   - The only source of an answer is the latest SEALED version: the confirmed objectives and the
 *     confirmed plan. Not a draft, not a dropped proposal, not the teacher's material.
 *   - An answer must cite package items (the worker validates the ids). An answer with no valid
 *     citation is replaced by a fixed refusal. We would rather say nothing than guess.
 *   - Two bases: "plan" restates a cited item; "explanation" explains a word or idea a cited item NAMES (the
 *     model's words, so the UI labels it). Two refusals, each a fixed sentence: "off_topic" and "assessment".
 *   - NOTHING is recorded: no log event, no ledger turn, no file. A student chat is not evidence of
 *     learning and must never be mistaken for it, so it leaves no trace to mistake.
 *   - No student identity is accepted. The request has a question and optional recent turns; any
 *     other field is ignored.
 */

export const OFF_TOPIC = "That isn't part of this lesson. Ask your teacher.";
export const ASSESSMENT = "I can't tell you how you're doing. Your teacher decides that.";
export const NOT_EVIDENCE = "Asking questions here is not evidence of learning.";

const MAX_QUESTION = 800;
const MAX_TURN = 800;
const MAX_HISTORY = 6;

export class StudentError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "StudentError";
    this.code = code;
  }
}

/**
 * The citeable view of a sealed version. Ids are stable and human-readable so an answer can say
 * "Objective 2" and the student can find it.
 * @returns {{title: string, version: number, ages: string, items: {id: string, label: string, text: string}[]}}
 */
export function packageOf(version) {
  const objectives = (version.objectiveRefs ?? []).map((o, i) => ({
    id: `objective:${i + 1}`,
    label: `Objective ${i + 1}`,
    text: String(o.statement ?? o.publicId ?? ""),
  }));
  const activities = (version.lessonPlan?.activities ?? []).map((a, i) => ({
    id: `activity:${i + 1}`,
    label: `Activity ${i + 1}: ${String(a.title ?? "")}`,
    text: `Learners: ${a.learnerDoes} Teacher: ${a.teacherDoes} About ${Number(a.minutes) || 0} minutes.`,
  }));
  const a = version.lessonPlan?.audience;
  const ages = Number.isFinite(a?.ageRangeStart) && Number.isFinite(a?.ageRangeEnd) ? `${a.ageRangeStart} to ${a.ageRangeEnd}` : "";
  return { title: String(version.title ?? ""), version: version.version, ages, items: [...objectives, ...activities].filter((i) => i.text) };
}

/** Only a question and a few recent turns are accepted; everything else is ignored, never forwarded. */
export function cleanQuestion(body) {
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION) : "";
  if (!question) throw new StudentError("NO_QUESTION", "ask a question");
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter((h) => h && (h.role === "student" || h.role === "assistant") && typeof h.text === "string" && h.text.trim())
    .slice(-MAX_HISTORY)
    .map((h) => ({ role: h.role, text: h.text.trim().slice(0, MAX_TURN) }));
  return { question, history };
}

/**
 * @param {{pkg: ReturnType<typeof packageOf>, worker: {enabled: boolean, answerStudent: Function}, body: unknown}} input
 * @returns {Promise<{answer: string, grounded: boolean, cites: {id: string, label: string}[], note: string, basis?: "plan"|"explanation", refusal?: "off_topic"|"assessment"}>}
 */
export async function askStudent({ pkg, worker, body }) {
  const { question, history } = cleanQuestion(body);
  if (!worker || worker.enabled === false) throw new StudentError("WORKER_NOT_CONFIGURED", "no drafting worker is configured");
  let out;
  try {
    out = await worker.answerStudent({ question, history, title: pkg.title, items: pkg.items, ages: pkg.ages });
  } catch (e) {
    throw Object.assign(new StudentError(e?.code ?? "WORKER_FAILED", e instanceof Error ? e.message : String(e)), { upstream: true });
  }
  const byId = new Map(pkg.items.map((i) => [i.id, i]));
  const cites = out.cites.filter((id) => byId.has(id)).map((id) => ({ id, label: byId.get(id).label }));
  if (out.refusal === "assessment") return { answer: ASSESSMENT, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "assessment" };
  if (cites.length === 0) return { answer: OFF_TOPIC, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "off_topic" };
  return { answer: out.answer, grounded: true, cites, note: NOT_EVIDENCE, basis: out.basis === "explanation" ? "explanation" : "plan" };
}
