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
 * Three rules keep it honest, because a net that catches everything also refuses real questions:
 *   (a) The question is NORMALISED first (normalizeQuestion): lowercased, typographic apostrophes folded
 *       to ', and every run of whitespace — including the zero-width and odd space characters a paste
 *       carries — collapsed to one plain space. "Grade  my   answer" is "grade my answer" here.
 *   (b) Each pattern is ANCHORED: it needs a self-referential assessment verb, or a verdict noun the
 *       asker OWNS, inside a tight window (a few words — never an unbounded gap across the sentence).
 *       So "How did we get from one half to two quarters?", "Tell me about the Mark Twain example" and
 *       "What does our performance task ask us to do?" are lesson questions, not assessments.
 *   (c) "mastery"/"mastered"/"level" is only matched with the asker as the object ("my mastery",
 *       "have I mastered", "what's my level"), so a content question that merely says the word is
 *       untouched (A22).
 *
 * It stays a SAFETY NET: the model prompt does the main work; this only recognises the shape of a
 * request for a verdict the AI may not give.
 */
const ASSESSMENT_PATTERNS = [
  // Tell me I passed / tell me I'm a genius / say I'm right: an explicit request for a verdict on the asker.
  /\btell (me|us) (i|we)\b/,
  /\btell (me|us) (i'm|im|i am|we're|we are)\b/,
  /\bsay (i|we)\b[^.!?]*\b(pass|passed|passing|fail|failed|mastered|master|right|correct|genius)\b/,
  /\bsay (i'm|im|i am|we're|we are)\b/,
  // Tell me whether I'm good at this / tell me my grade / what mark I got.
  /\btell (me|us) (if|whether) (i|we|i'm|im)\b/,
  /\btell (me|us) (my|our)\b[^.!?]*\b(grade|score|mark|rating|level|progress|performance|mastery)\b/,
  /\b(what|which) (mark|grade|score|rating)\b[^.!?]*\b(i|we) (got|get|have|had|receive|received|earn|earned|deserve)\b/,
  // Pass / fail asked with the asker as the subject ("did I pass", "am I passing", "will I pass").
  /\b(do|did|will|would|can|could|should|am|are|was|were|have|has)\s+(i|we)\s+(pass|passed|passing|fail|failed|failing)\b/,
  /\b(going|gonna) to (pass|fail)\b/,
  /\b(pass or fail|fail me|pass me|pass\s*\/\s*fail)\b/,
  // An assessment verb aimed at the asker or something of theirs: "grade me", "rate my answer",
  // "evaluate whether I mastered this", "check my understanding".
  /\b(grade|graded|score|scored|mark|marked|rate|rated|assess|assessed|evaluate|evaluated|judge|judged|rank|ranked) (me|us|my|our)\b/,
  /\b(grade|score|rate|assess|evaluate|judge|rank) how (i|we)\b/,
  /\bcheck (my|our) (understanding|answer|answers|work|mastery|progress|grade|score|mark|level|performance)\b/,
  /\b(whether|if) (i|we) (master|mastered|pass|passed|fail|failed|understand|understood|learn|learned|learnt|improve|improved|deserve)\b/,
  // A verdict noun the asker OWNS, inside a frame that asks for it ("what's my score?", "how's my
  // progress?"). The lookahead keeps the content phrase "our performance task" out of the net.
  /\bwhat(?:'s|s| is| was)?\s+(my|our)\s+(grade|grades|score|scores|mark|marks|rating|level|mastery|progress|performance)\b(?!\s+(?:task|bar|chart|curve|goal|plan|practic\w*|rubric|standard|objective|book|log|note|example|project|sheet|activity|lesson))/,
  /\bhow(?:'s|s| is| was)?\s+(my|our)\s+(grade|score|mark|rating|level|mastery|progress|performance)\b(?!\s+(?:task|bar|chart|curve|goal|plan|practic\w*|rubric|standard|objective|book|log|note|example|project|sheet|activity|lesson))/,
  /\bhow (good|bad|well) is (my|our) (answer|work|response|explanation|understanding)\b/,
  /\bis (my|our) (answer|work|response|understanding) (right|correct|wrong|ok|okay)\b/,
  /\bis (my|our) (answer|work|effort|response) (good|bad|ok|okay|fine)?\s*enough\b/,
  // "How am I doing / how did I do / how well do I know / am I doing well" — a performance frame after
  // the pronoun, so a content question like "How do I compare two fractions?" is not caught.
  /\bhow(?:'m| am| are we)\s+(i|we)\s+(doing|going|coming along|performing|progressing)\b/,
  /\bhow (did|do) (i|we) (do|fare|score)\b/,
  /\bhow well (am i|are we|did i|did we)\b/,
  /\bhow well do (i|we) know\b/,
  /\bam (i|we) (doing|going) (well|good|ok|okay|fine|alright|great|bad|poor)\b/,
  /\bam (i|we) (right|correct|wrong)\b/,
  /\bam (i|we) (good|bad|great|ok|okay|fine|better|worse|improving|smart|ready|prepared)\b/,
  /\bam (i|we) on (the right )?track\b/,
  /\b(am|are) (i|we) (smart|good|well|ready|prepared|strong|clever|talented) enough\b/,
  /\b(do|did|have|has|will|would) (i|we) (learn|learned|learnt|master|mastered|study|studied|practi[cs]e|practi[cs]ed|revise|revised|improve|improved) enough\b/,
  /\b(do|did) (i|we) know (this|it|that|these|them) (well|good|enough)\b/,
  /\b(did|do) (i|we) (do|perform|go) (better|worse|well|good|badly|ok|okay)\b/,
  /\bwhere (do|does) (i|we) stand\b/,
  // Mastery / understanding asked about the asker.
  /\bhave (i|we) (got|gotten|understood|learned|learnt|mastered|improved)\b/,
  /\bam (i|we) (mastering|getting|learning)\b/,
  /\bdid (i|we) (master|mastered|pass|passed|learn|learned|learnt|understand|understood|get it|get this|get that)\b/,
  /\bdid (i|we) (really |actually )?get (it|this|that|these|those|any of (it|this|that)|an? [a-f]\b|a good (grade|score|mark))\b/,
  /\bdo you think (i|we|i'm|im)\b/,
  // Ask for a verdict or for credit: "do I deserve an A", "would you give me an A", "congratulate me",
  // "rank my understanding", "what percentage of this do I know", "can I get credit for effort".
  /\b(i|we|my|our)\b[^.!?]{0,40}\bdeserve\b[^.!?]*\b(an? [a-f]\b|full marks|top marks|credit|a (grade|score|mark|pass|better|higher))\b/,
  /\b(congratulate|compliment|praise) (me|us)\b/,
  /\b(give|hand|award) (me|us) an? [a-f]\b/,
  /\b(give|hand|award) (me|us)\b[^.!?]*\b(grade|score|mark|marks|rating|level|credit|feedback|pass)\b/,
  /\b(score|grade|mark|rating) out of\b/,
  /\b(grade|score|mark|rating|level|credit|feedback) (for|on|about) (my|our)\b/,
  /\bwhat percentage\b[^.!?]*\b(i|we)\b/,
  /\b(i|we)\b[^.!?]*\b(get|got)\b\s+(credit|extra credit)\b/,
  /\b(i|we)\b[^.!?]*\b(earn|earned|receive|received|deserve)\b\s+(credit|extra credit|full marks|top marks|a grade|an? [a-f]\b|a pass)\b/,
  /\brank (me|us|my|our)\b/,
];

/** Fold the shapes a paste carries — zero-width joiners/marks, non-breaking and typographic spaces, curly
 * apostrophes — and every run of whitespace into one plain space, then lowercase. */
function normalizeQuestion(question) {
  return String(question ?? "")
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, " ")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAssessment(question) {
  const q = normalizeQuestion(question);
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
