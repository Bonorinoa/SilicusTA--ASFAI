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
 * Heuristic: a question that asks the AI for a verdict on the ASKER — a grade, a pass/fail, mastery, a
 * level, or to be told they are right. It runs whether or not the model refused, so a model that misses
 * one cannot let the AI grade (lock: AI never grades; teacher confirms).
 *
 * It matches self-assessment INTENT, never the bare topic words. In particular "mastery"/"mastered" is
 * only matched with the asker as the object ("my mastery", "have I mastered"), so an in-domain content
 * question that merely says the word — "What does mastery learning mean in this lesson?" — is untouched (A22).
 */
const ASSESSMENT_PATTERNS = [
  // Tell me I passed / I'm right / I'm a genius: an explicit request for a verdict on the asker.
  /\btell (me|us) (i|we|i'm|im|i am|we're|we are)\b/i,
  /\btell (me|us)\b[^.!?]*\b(pass|passed|passing|fail|failed|grade|graded|score|scored|mark|marked|level|rating)\b/i,
  // "say I passed" / "say I'm a genius": the same verdict request phrased as an instruction (also inside injection).
  /\bsay (i|we)\b[^.!?]*\b(pass|passed|passing|fail|failed|mastered|master|right|correct|genius)\b/i,
  /\bsay (i'm|im|i am|we're|we are)\b/i,
  // Pass / fail asked with the asker as the subject ("did I pass", "am I passing", "will I pass", "are we going to pass").
  /\b(do|did|will|would|can|could|should|am|are|was|were|have|has)\s+(i|we)\s+(pass|passed|passing|fail|failed|failing)\b/i,
  /\b(going|gonna) to (pass|fail)\b/i,
  /\b(pass or fail|fail me|pass me)\b/i,
  // A grade / score / mark / level / rating owned by the asker, or asked of their own answer, work or understanding.
  /\b(my|our)\b[^.!?]*\b(grade|grades|score|scores|mark|marks|rating|level|mastery|progress|performance)\b/i,
  /\bwhat('s| is| was)? my (grade|score|mark|rating|level)\b/i,
  /\b(grade|score|mark|rate|rating|assess|evaluate|judge) (my|our)\b/i,
  /\bcheck (my|our) (understanding|answer|mastery|progress)\b/i,
  /\bis (my|our) (answer|work|response|understanding) (right|correct|wrong|ok|okay)\b/i,
  /\bam (i|we) (right|correct|wrong)\b/i,
  /\b(give|hand|show) (me|us)\b[^.!?]*\b(grade|score|mark|rating|level)\b/i,
  /\b(score|grade|mark|rating) out of\b/i,
  // "How am I doing / how'm I doing / how did I do / how well am I doing" — a performance verb after the
  // pronoun, so a content question like "How do I compare two fractions?" is not caught.
  /\bhow(?:'m| am| are we)\s+(i|we)\s+(doing|going|coming along)\b/i,
  /\bhow (did|do) (i|we) (do|fare|score)\b/i,
  /\bhow well (am i|are we|did i|did we)\b/i,
  // Mastery / level asked about the asker ("have I got this", "am I mastering this", "did I master it").
  /\bhave (i|we) (got|gotten|understood|learned|learnt|mastered)\b/i,
  /\bam (i|we) (mastering|getting|learning)\b/i,
  /\bdid (i|we) get\b/i,
];

function looksLikeAssessment(question) {
  const q = String(question ?? "").toLowerCase();
  return ASSESSMENT_PATTERNS.some((re) => re.test(q));
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
  // Safety net: the model may miss an assessment request; catch it here before the grounded path.
  if (looksLikeAssessment(question)) {
    return { answer: ASSESSMENT, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "assessment" };
  }
  const byId = new Map(pkg.items.map((i) => [i.id, i]));
  const cites = out.cites.filter((id) => byId.has(id)).map((id) => ({ id, label: byId.get(id).label }));
  if (out.refusal === "assessment") return { answer: ASSESSMENT, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "assessment" };
  if (cites.length === 0) return { answer: OFF_TOPIC, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "off_topic" };
  return { answer: out.answer, grounded: true, cites, note: NOT_EVIDENCE, basis: out.basis === "explanation" ? "explanation" : "plan" };
}
