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
 *   - K3 (owner, 17 Nov): the model also picks a reply KIND: answer | clarify | about_helper | off_topic | assessment.
 *     Only "answer" carries model words. clarify, about_helper and the off_topic redirect are COMPOSED HERE from fixed
 *     text plus the lesson's own words (objective statements as the student preview shows them, activity titles).
 *     An unknown kind is off_topic. The assessment refusal and its regex net are unchanged and win over every kind.
 *   - N4 (owner, 18 Nov): the helper by age, keyed on the course's recorded ages (youngest < 18, or no ages, is the
 *     under-18 mode). Under 18, an answer resting on an ATTEMPT-FIRST activity (aiStatus "forbidden", or a learner-first
 *     try before help) is replaced by the host's `attempt_first` reply naming the activity; the cite check is
 *     unchanged. 18+, a question on the course's subject that the lesson does not cover may get a general explanation
 *     (basis "explanation", general: true, no cites, labelled in the UI), and an attempt-first activity gets help led by
 *     one host-composed nudge line. The assessment refusal and its net still win first at every age.
 *   - N5 (owner, 18 Nov, N1V C1/C2): under 18 the host ALSO matches the question against each try-first activity
 *     (number or title, `namedTryFirst`), so attempt_first no longer rests on the model's cite; and every answer's
 *     model words pass an output check (`judgesStudent`) — a verdict on the student is withheld (`withheld: "judged"`).
 *   - NOTHING is recorded: no log event, no ledger turn, no file. A student chat is not evidence of
 *     learning and must never be mistaken for it, so it leaves no trace to mistake.
 *   - No student identity is accepted. The request has a question and optional recent turns; any
 *     other field is ignored.
 */

/** The plain off_topic sentence, used only when the lesson has no objective to point back to. */
export const OFF_TOPIC = "That isn't part of today's lesson. Ask your teacher.";
export const ASSESSMENT = "I can't tell you how you're doing. Your teacher decides that.";
export const NOT_EVIDENCE = "Asking questions here is not evidence of learning.";
/** N4: the under-18 attempt-first reply ends with this fixed sentence (the activity is named before it). */
export const ATTEMPT_FIRST = "Ask me after you've had a go.";
/** N4: the one host-composed line that leads an adult's help on an attempt-first activity. */
export const NUDGE = "Worth trying this yourself first. Here's a nudge:";
/** N4: the age at which the helper may give general explanations and nudges instead of attempt-first replies. */
export const ADULT_AGE = 18;

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

/** N4: an activity the student tries before any help: AI forbidden, or a learner-first try before help. */
export function isAttemptFirst(activity) {
  return activity?.aiStatus === "forbidden" || (typeof activity?.learnerFirst === "string" && activity.learnerFirst.trim() !== "");
}

/** N4: 18+ mode only when the youngest recorded age is known and at least 18. No ages is the under-18 mode. */
export function adultCourse(pkg) {
  return Number.isFinite(pkg?.minAge) && pkg.minAge >= ADULT_AGE;
}

/**
 * The citeable view of a sealed version. Ids are stable and human-readable so an answer can say
 * "Objective 2" and the student can find it. `ages` is the course's recorded {min, max} (G2a); it wins over the
 * plan's audience for the youngest age, which sets the N4 mode.
 * @returns {{title: string, version: number, ages: string, minAge: number|null, items: {id: string, label: string, text: string, tryFirst?: true}[]}}
 */
export function packageOf(version, { ages: courseAges = null } = {}) {
  const objectives = (version.objectiveRefs ?? []).map((o, i) => ({
    id: `objective:${i + 1}`,
    label: `Objective ${i + 1}`,
    text: String(o.statement ?? o.publicId ?? ""),
  }));
  const activities = (version.lessonPlan?.activities ?? []).map((a, i) => ({
    id: `activity:${i + 1}`,
    label: `Activity ${i + 1}: ${String(a.title ?? "")}`,
    text: `Learners: ${a.learnerDoes} Teacher: ${a.teacherDoes} About ${Number(a.minutes) || 0} minutes.`,
    ...(isAttemptFirst(a) ? { tryFirst: true } : {}),
  }));
  const a = version.lessonPlan?.audience;
  const recorded = Number.isFinite(courseAges?.min) && Number.isFinite(courseAges?.max);
  const ages = recorded ? `${courseAges.min} to ${courseAges.max}` : Number.isFinite(a?.ageRangeStart) && Number.isFinite(a?.ageRangeEnd) ? `${a.ageRangeStart} to ${a.ageRangeEnd}` : "";
  const minAge = recorded ? courseAges.min : Number.isFinite(a?.ageRangeStart) ? a.ageRangeStart : null;
  return { title: String(version.title ?? ""), version: version.version, ages, minAge, items: [...objectives, ...activities].filter((i) => i.text) };
}

/* ------------------------------ K3: host-composed replies ------------------------------ */

const MAX_OFFERS = 3;
const MAX_TOPIC = 80;

/**
 * An item in the lesson's own words, as a child reads them on the student preview: an objective without its
 * "Students can" lead (capitalised, no full stop, the same rule as Learn.tsx `kid`), an activity by its title.
 */
export function topicOf(item) {
  const id = String(item?.id ?? "");
  let t = id.startsWith("activity:")
    ? String(item?.label ?? "").replace(/^Activity \d+:\s*/, "")
    : String(item?.text ?? "").replace(/^(students|learners)\s+(can|will)\s+/i, "").replace(/\.$/, "");
  t = t.replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
  if (t.length > MAX_TOPIC) t = `${t.slice(0, MAX_TOPIC).replace(/\s+\S*$/, "")}…`;
  return t;
}

const offersOf = (items) => items.slice(0, MAX_OFFERS).map((i) => ({ id: i.id, topic: topicOf(i) })).filter((o) => o.topic);
const listOf = (offers) => offers.map((o) => o.topic).join(" · ");
const endSentence = (t) => (/[.?!…]$/.test(t) ? t : `${t}.`);

/** clarify: "What would you like to know? I can help with: {label} · {label}." (at most 3 items). */
export function clarifyReply(items) {
  return `What would you like to know? I can help with: ${endSentence(listOf(offersOf(items)))}`;
}

/** about_helper: fixed text and the lesson title. No model words. */
export function aboutHelperReply(pkg) {
  const title = String(pkg?.title ?? "").replace(/\s+/g, " ").trim();
  return title ? `I'm Silicus, a helper for today's lesson: ${endSentence(title)} Ask me about it.` : "I'm Silicus, a helper for today's lesson. Ask me about it.";
}

/** N4 attempt_first: "This one is for you to try first: {activity title}. Ask me after you've had a go." */
export function attemptFirstReply(title) {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  return t ? `This one is for you to try first: ${endSentence(t)} ${ATTEMPT_FIRST}` : `This one is for you to try first. ${ATTEMPT_FIRST}`;
}

const objectivesOf = (pkg) => (pkg?.items ?? []).filter((i) => String(i.id).startsWith("objective:"));

/** off_topic: a redirect to up to 3 objectives in the lesson's words, then the teacher. */
export function offTopicReply(pkg) {
  const offers = offersOf(objectivesOf(pkg));
  return offers.length ? `That isn't part of today's lesson. I can help with: ${endSentence(listOf(offers))} Or ask your teacher.` : OFF_TOPIC;
}

function offTopic(pkg) {
  const offers = offersOf(objectivesOf(pkg));
  return { answer: offTopicReply(pkg), grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "off_topic", kind: "off_topic", ...(offers.length ? { offers } : {}) };
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
 * It is a SAFETY NET, not a guarantee: the model prompt does the main work, and this only recognises the
 * SHAPE of a request for a verdict the AI may not give. Round 2 measured it at about 45% of phrasings
 * written cold; round 3 adds the classes below. Nothing here promises a rate.
 *
 * Five rules keep it honest, because a net that catches everything also refuses real questions:
 *
 *   (a) NORMALISE FIRST (readings). NFKC, then the zero-width and soft-hyphen characters a paste carries
 *       are REMOVED, so "gra<ZWSP>de" is "grade"; backtick and acute-accent apostrophes are folded to ';
 *       a handful of cheap, safe homoglyphs (Cyrillic а е о с р х у і ѕ ј, Greek ο) fold to ASCII.
 *       An invisible character is ambiguous — glue inside a word, a space between words — so the net
 *       reads the question BOTH ways (removed, and as a space) and refuses if either reading matches.
 *   (b) Every pattern is ANCHORED to an asker-owned frame: a verdict noun the asker OWNS ("my score"),
 *       an assessment verb aimed at the asker or at something of theirs ("grade me", "grade my answer"),
 *       or a pass/fail/mastery question with the asker as the subject. No unbounded gap anywhere: a gap
 *       is at most three words, so a verdict word later in a content question cannot pull it in.
 *   (c) A verdict noun that is really a THING — "the level of the water", "the mark on the number line",
 *       "my score in the game", "our performance task" — is a lesson question. Those nouns carry a
 *       content lookahead, and a bare verb plus a possessive only counts with an artefact or an abstract
 *       noun after it ("grade my answer", "rank my understanding"), never with a content noun
 *       ("rank my fractions", "score my game of bingo", "evaluate my fraction expression").
 *   (d) TYPO TOLERANCE, only inside those frames: a token one edit away from grade, score, master, pass,
 *       assess or evaluate is read as that word when an asker-owned word is next to it ("wat is my grde",
 *       "grad my paper", "can u scor my anser"). An ordinary English word at one edit (past, mass, trade,
 *       scope …) is never read as a typo.
 *   (e) A SECOND SENTENCE that is only an imperative assessment verb with an object pronoun ("Grade it.",
 *       "Score it for me.") is a request when an earlier sentence says the asker wrote, finished or
 *       answered something. The sentence must be nothing but that verb and its pronoun.
 *
 * "check my answer/work" is a request only when the check is the sentence's own main verb and no
 * how-do-I / step / procedure frame is talking about checking.
 *
 * The content nouns that make a verdict noun a thing (rule c). Kept as one list because it is used by
 * four patterns; each pattern carries its own copy so the array stays a plain literal.
 *   task|bar|chart|curve|goal|plan|rubric|standard|objective|book|log|example|project|sheet|activity|
 *   lesson|line|map|graph|picture|diagram|model|story|video|music|song|recipe|pizza|jar|glass|water|
 *   data|table|figure|reading|passage|text|page|step|procedure|problem|question|game|bingo|board|ruler|
 *   scale|axis|sample|survey|list|card|marker|sign|flag|notebook|workbook|worksheet|practic*
 */
export const ASSESSMENT_PATTERNS = [
  // (1) An explicit request for a verdict on the asker: "tell me I passed", "say I'm a genius".
  /\btell (me|us) (i|we)\b/,
  /\btell (me|us) (i'm|im|i am|we're|we are)\b/,
  /\btell (me|us) (if|whether) (i|we|i'm|im|i've|we've)\b/,
  /\bsay (i|we)\b(?:\s+[a-z0-9']+){0,3}\s+(pass|passed|passing|fail|failed|failing|mastered|master|right|correct|genius|proficient|good)\b/,
  /\bsay (i'm|im|i am|we're|we are)\b/,
  /\btell (me|us) (my|our)\b(?:\s+[a-z0-9']+){0,3}\s+(grade|grades|score|scores|mark|marks|rating|level|standing|percentage|points|nota|note|progress|performance|mastery|understanding)\b/,
  /\btell (me|us) how (i|we) (did|do|went|performed|am doing)\b/,
  /\b(what|which) (mark|grade|score|rating|nota|note|level|standing)\b(?:\s+[a-z0-9']+){0,3}\s+(i|we) (got|get|have|had|receive|received|earn|earned|deserve)\b/,
  /\bwhat (level|score|mark|rating|standing) (am|are) (i|we)\b/,
  /\btest (me|us)\b(?=(?:\s+[a-z0-9']+){0,4}\s+tell (me|us)\b)/,

  // (2) Pass, fail, mastery, readiness or standing with the asker as the subject.
  /\b(do|did|will|would|can|could|should|am|are|was|were|have|has) (i|we|i've|we've|i'm|im) (pass|passed|passing|fail|failed|failing)\b/,
  /\b(if|whether) (i|we|i've|we've|i'm|im)\b(?:\s+[a-z0-9']+){0,2}\s+(pass|passed|passing|fail|failed|failing|mastered|master|ready)\b/,
  /\b(going|gonna) to (pass|fail)\b/,
  /\b(pass or fail|fail me|pass me|pass\s*\/\s*fail)\b/,
  /\b(pass|fail) (me|us)\b/,
  /\benough to (pass|fail|move on|advance|go on|skip|get an? [a-f])\b/,
  /\b(do|did|have|has|will|would) (i|we) (learn|learned|learnt|master|mastered|study|studied|practi[cs]e|practi[cs]ed|revise|revised|improve|improved|know|do|done|finish|finished|complete|completed) enough\b/,
  /\bhave (i|we) (got|gotten|understood|learned|learnt|mastered|improved|done)\b/,
  /\bdid (i|we) (master|mastered|pass|passed|learn|learned|learnt|understand|understood|get it|get this|get that)\b/,
  /\bdid (i|we) (really |actually )?get (it|this|that|these|those|any of (it|this|that)|a good (grade|score|mark))\b/,
  /\bhow many (points|questions|marks|answers|problems|items)\b(?:\s+[a-z0-9']+){0,3}\s+(i|we) (get|got|earn|earned|score|scored|have|had|do|did)\b/,
  /\bhow many\b(?:\s+[a-z0-9']+){0,2}\s+(did|do|will) (i|we) (get|got|earn|earned|score|scored)\b/,
  /\bam (i|we) (behind|ahead|ahead of|behind on|behind in|keeping up|falling behind)\b/,
  /\bam (i|we)\b(?:\s+[a-z0-9']+){0,2}\s+(better|worse|smarter|faster|slower|cleverer)\b\s+(than|at)\b/,
  /\bam (i|we) (dumb|stupid|thick|smart|clever|bright|intelligent)\b/,
  /\bam (i|we) an? (good|bad|great|smart|clever|strong|weak|slow|fast|top|poor|excellent|dumb) (student|learner|kid|pupil|reader|writer|mathematician|person)\b/,
  /\bhow (smart|good|clever|talented|bright|intelligent)\b(?:\s+[a-z0-9']+){0,3}\s+(?:(i|we) (am|are)|(am|are) (i|we))\b/,
  /\bam (i|we) (mastering|getting|learning)\b/,
  /\bam (i|we) (doing|going) (well|good|ok|okay|fine|alright|great|bad|poor)\b/,
  /\bam (i|we) (right|correct|wrong)\b/,
  // N5 (N1V leak): "be honest, am I any good at thermodynamics".
  /\bam (i|we) (any|much|even|actually|really|very|pretty|quite|that) (good|bad|great|decent|smart|clever|terrible|competent|use)\b/,
  /\bam (i|we) (good|bad|great|ok|okay|fine|better|worse|improving|smart|ready|prepared)\b/,
  /\bam (i|we) on (the right )?track\b/,
  /\b(am|are) (i|we) (smart|good|well|ready|prepared|strong|clever|talented) enough\b/,
  /\bhow(?:'m| am| are we)\s+(i|we)\s+(doing|going|coming along|performing|progressing)\b/,
  /\bhow (did|do) (i|we) (do|fare|score)\b(?=\s*(?:[.!?,]|$|on |in |at |compared|so far|this|that|overall|today|here|with))/,
  /\bhow well (am i|are we|did i|did we)\b/,
  /\bhow well do (i|we) know\b/,
  /\bwhere (do|does) (i|we) stand\b(?=\s*(?:[.!?,]|$|in |with |compared|against|among|relative|on ))/,
  /\b(do|did) (i|we) know (this|it|that|these|them) (well|good|enough)\b/,
  /\b(did|do) (i|we) (do|perform|go) (better|worse|well|good|badly|ok|okay)\b/,
  /\b(did|do) (i|we) (answer|write|explain|solve) (that|this|it) (well|good|badly|right|correctly|ok|okay)\b/,
  /\bdo you think (i|we|i'm|im)\b/,
  /\b(whether|if) (i|we) (master|mastered|pass|passed|fail|failed|understand|understood|learn|learned|learnt|improve|improved|deserve)\b/,
  /\bcompare (my|our) (performance|progress|results|standing|mastery|understanding|ability|knowledge|skills|effort)\b/,

  // (3) An assessment verb aimed at the asker, or at something of theirs.
  /\b(grade|graded|grading|score|scored|scoring|mark|marked|marking|rate|rated|rating|assess|assessed|assessing|evaluate|evaluated|evaluating|judge|judged|judging|rank|ranked) (me|us)\b/,
  /\b(grade|graded|score|scored|mark|marked|rate|rated|assess|assessed|evaluate|evaluated|judge|judged) (my|our) (answer|answers|work|homework|essay|paper|response|explanation|solution|submission|reasoning|working|test|quiz|assignment|paragraph|sentence|writing|draft|report|project|understanding|mastery|progress|performance|level|standing|knowledge|ability|skills|effort|grade|score|mark|rating|points)\b/,
  /(?:^|(?:please|now|also|so|and|then|ok|okay|can you|could you|would you|will you) )(?:please )?(grade|graded|score|scored|mark|marked|rate|rated|assess|assessed|evaluate|evaluated|judge|judged) (this|it|that)\b(?=\s*(?:[.!?,]|$|for (me|us)|please|now|too))/,
  /\b(grade|score|rate|assess|evaluate|judge|rank) how (well |good )?(i|we)\b/,
  /\b(grade|score|mark|rating|level|credit|feedback|nota|note) (for|on|about) (my|our)\b/,
  /\b(score|grade|mark|rating) out of\b/,
  // N5 (N1V leak): "Score my last reply out of 10": an assessment verb, a short object, then a scale.
  /\b(grade|score|mark|rate|assess|evaluate|judge)\b(?:\s+[a-z0-9']+){0,3}\s+out of\s+(\d+|ten|five|twenty|a hundred)\b/,
  /\b(rank|rate|judge) (my|our) (understanding|mastery|progress|performance|level|standing|knowledge|ability|skills|effort|grade|score|mark|rating|answer|answers|work)\b/,
  /\bhow(?:'s|s| is| was)? (my|our) (work|answer|answers|explanation|effort|response|writing|essay|paper|solution|reasoning|draft|project)\b(?:\s+[a-z0-9']+){0,2}\s+(going|doing|looking|coming)\b/,
  /\bhow (good|bad|well) is (my|our) (answer|work|response|explanation|understanding)\b/,
  /\bis (my|our) (answer|work|response|understanding) (right|correct|wrong|ok|okay)\b/,
  /\bis (my|our) (answer|work|effort|response|explanation|solution|reasoning|writing) (good|bad|ok|okay|fine)?\s*enough\b/,
  /\bis (my|our) (understanding|knowledge|grasp|ability|progress|level|mastery|performance|work|answer) (good|bad|strong|weak|ok|okay|fine|poor|great)\b/,

  // (4) A verdict noun the asker OWNS, in a frame that asks for it: "my score", "what would my level be".
  //     The two lookaheads keep a verdict noun that is really a thing ("our performance task", "my score
  //     in the game", "my level of the water") out of the net.
  /\b(my|our) (?:current |overall |final |predicted |expected |total )?(grade|grades|score|scores|mark|marks|nota|notas|note|notes|rating|percentage|level|standing|points|mastery|progress|performance)\b(?!\s+(?:task|bar|chart|curve|goal|plan|rubric|standard|objective|book|log|example|project|sheet|activity|lesson|line|map|graph|picture|diagram|model|story|video|music|song|recipe|pizza|jar|glass|water|data|table|figure|reading|passage|text|page|step|procedure|problem|question|game|bingo|board|ruler|scale|axis|sample|survey|list|card|marker|sign|flag|notebook|workbook|worksheet|practic\w*)\b)(?!\s+(?:in|on|at|from|of)\s+(?:the|this|that|a|an)(?:\s+[a-z0-9']+){0,2}\s+(?:task|bar|chart|curve|goal|plan|rubric|standard|objective|book|log|example|project|sheet|activity|lesson|line|map|graph|picture|diagram|model|story|video|music|song|recipe|pizza|jar|glass|water|data|table|figure|reading|passage|text|page|step|procedure|problem|question|game|bingo|board|ruler|scale|axis|sample|survey|list|card|marker|sign|flag|notebook|workbook|worksheet|practic\w*)\b)/,

  // (5) Ask for a verdict, credit or a letter: "give me a score out of 100", "do I deserve an A".
  /\b(give|giving|gave|gimme|hand|handing|handed|award|awarding|awarded)\b(?:\s+(?:me|us))?(?:\s+[a-z0-9']+){0,2}\s+(grade|grades|score|scores|mark|marks|rating|percentage|level|standing|points|nota|notas|note|notes|credit|feedback)\b(?!\s+(?:task|bar|chart|curve|goal|plan|rubric|standard|objective|book|log|example|project|sheet|activity|lesson|line|map|graph|picture|diagram|model|story|video|music|song|recipe|pizza|jar|glass|water|data|table|figure|reading|passage|text|page|step|procedure|problem|question|game|bingo|board|ruler|scale|axis|sample|survey|list|card|marker|sign|flag|notebook|workbook|worksheet|practic\w*)\b)(?!\s+(?:in|on|at|from|of)\s+(?:the|this|that|a|an)(?:\s+[a-z0-9']+){0,2}\s+(?:task|bar|chart|curve|goal|plan|rubric|standard|objective|book|log|example|project|sheet|activity|lesson|line|map|graph|picture|diagram|model|story|video|music|song|recipe|pizza|jar|glass|water|data|table|figure|reading|passage|text|page|step|procedure|problem|question|game|bingo|board|ruler|scale|axis|sample|survey|list|card|marker|sign|flag|notebook|workbook|worksheet|practic\w*)\b)/,
  /\b(i|we|my|our)\b(?:\s+[a-z0-9']+){0,3}\s+\bdeserve\b(?:\s+[a-z0-9']+){0,3}\s+\b(an? [a-f]\b|full marks|top marks|credit|a (grade|score|mark|pass|better|higher))\b/,
  /\b(congratulate|compliment|praise) (me|us)\b/,
  /\b(get|got|gotten|give|giving|gave|earn|earned|deserve|deserved|receive|received|hand|handed|award|awarded|rate|rated|mark|marked|grade|graded|score|scored)\b(?:\s+[a-z0-9']+){0,3}\s+an? [a-f]\b(?!\s+(?:in|on|at|from|of)\s+(?:the|this|that|a|an)(?:\s+[a-z0-9']+){0,2}\s+(?:task|bar|chart|curve|goal|plan|rubric|standard|objective|book|log|example|project|sheet|activity|lesson|line|map|graph|picture|diagram|model|story|video|music|song|recipe|pizza|jar|glass|water|data|table|figure|reading|passage|text|page|step|procedure|problem|question|game|bingo|board|ruler|scale|axis|sample|survey|list|card|marker|sign|flag|notebook|workbook|worksheet|practic\w*)\b)/,
  /\bis (this|that|it) an? [a-f]\b/,
  /\bis (this|that|it) an? (passing|failing|acceptable|decent)\b/,
  /\bis (this|that|it) (good|fine|ok|okay|decent|acceptable) enough\b/,
  /\b(i|we)\b(?:\s+[a-z0-9']+){0,3}\s+\b(get|got)\b\s+(credit|extra credit)\b/,
  /\b(i|we)\b(?:\s+[a-z0-9']+){0,3}\s+\b(earn|earned|receive|received|deserve)\b\s+(credit|extra credit|full marks|top marks|a grade|an? [a-f]\b|a pass)\b/,

  // (6) A loanword verdict noun with its own language's determiner ("la nota", "ma note", "eine Note"),
  //     and a determiner with "nota" in English ("a nota", "the nota").
  /\b(an?|the) nota\b/,
  /\b(ma|mon|mes|mi|mis|ta|ton|tes|la|le|les|el|los|las|una?|une?|des?|eine?n?|einem|einer|mein\w*|dein\w*|das|der|die|il|della|delle)\s+(nota|notas|note|notes|noten)\b/,

  // (7) "what percentage" is a verdict only with an asker-owned knowledge or score object.
  /\bwhat percentage\b(?:\s+[a-z0-9']+){0,3}\s+(of (?:this|it|that|my (?:answer|work|score|grade|understanding|test|quiz|assignment|effort|performance))|do (i|we) know|did (i|we) (get|know|earn|score)|have (i|we) (got|learned|learnt|mastered)|am (i|we))\b/,

  // (8) A teacher's verdict, with the asker as its object: "what mark would a teacher give me?".
  /\b(what|which) (mark|grade|score|rating|nota|note|level|standing) (would|will|does|do|did) (a|the|my|your) teacher\b(?:\s+[a-z0-9']+){0,3}\s+(i|me|my|mine)\b/,
  /\b(would|could|will|does|did|do) (a|the|my|your) teacher\b(?:\s+[a-z0-9']+){0,3}\s+(say|think|give|mark|grade|score)\b(?:\s+[a-z0-9']+){0,4}\s+(i|me|my|mine)\b/,
];

/** The words the typo rule (d) may read a misspelling as. */
const TYPO_VOCAB = ["grade", "score", "master", "pass", "assess", "evaluate"];
/** Ordinary English words one edit away from a word above. A real word is never read as a typo. */
const TYPO_STOPWORDS = new Set([
  "past", "mass", "bass", "lass", "pals", "pads", "pats", "pays", "puss", "poss", "gass",
  "trade", "grace", "grave", "grate", "glade", "gade", "shade", "braid", "brade",
  "scare", "shore", "scope", "scone", "snore", "scorer", "store", "spore",
  "faster", "mister", "muster", "poster", "caster", "laster", "mastery", "masted", "mister",
  "asset", "assert", "assess",
]);
/** Words that make a frame asker-owned: the asker, or the thing of theirs the verdict is about. */
const OWNER_WORDS = new Set(["my", "our", "me", "us", "mine", "ours", "this", "it", "that"]);
/** A sentence that says the asker wrote, finished or answered something. */
const ASKER_WROTE = /\b(i|we)\b(?:\s+[a-z0-9']+){0,3}\s+(wrote|write|written|finished|finish|completed|complete|did|done|answered|answer|solved|solve|made|submitted|submit|typed|filled|practi[cs]ed|tried)\b/;
/** A sentence that is ONLY an imperative assessment verb with an object pronoun ("Grade it.", "Score it for me."). */
const BARE_ASK = /^(?:(?:please|now|also|so|and|then|ok|okay|can you|could you|would you|will you)\s+)*(?:please\s+)?(grade|score|mark|rate|assess|evaluate|judge|check)\s+(it|this|that|them|these|those|mine)(?:\s+(?:for me|for us|please|now|too|then))?$/;
/** "check my answer/work" as the sentence's own main verb, with no frame that talks ABOUT checking. */
const CHECK_TARGET = /\bcheck (my|our) (answer|answers|work|homework|understanding|mastery|progress|grade|score|mark|level|performance|effort|response|explanation|solution)\b/;
const CHECK_FRAME = /\b(how (do|can|should|would) (i|we)|what|which|step|steps|procedure|method|instructions?)\b/;
const CHECK_LEAD = /^(?:(?:please|now|also|so|and|then|ok|okay|can you|could you|would you|will you)\s+)*(?:please\s+)?check\b/;
/** A mastery claim plus a request to confirm it ("I think I mastered this. Can you confirm?"). */
const CLAIM = /\b(i|we) (?:think|feel|believe|reckon) (?:that )?(?:i|we)? ?(?:have |'ve )?(mastered|passed|got it|got this|understand|understood|learned|learnt)\b/;
const CONFIRM = /\b(confirm|verify|correct|agree|right|say so)\b/;
/** A standing the asker states about themselves, plus a request to be told it ("I'm proficient. Are you able to say?"). */
const STANDING_CLAIM = /\b(i'm|im|i am|we're|we are) (proficient|behind|ahead|on track|at grade level|at the grade level|advanced|struggling)\b/;
/** N5 (N1V leak): "Here is my answer, entropy is disorder. Right or wrong?" — a verdict on the ASKER's own answer. */
const RIGHT_OR_WRONG = /\b(right or wrong|correct or (?:not|incorrect|wrong)|right or not|wrong or right)\b/;
const ASKER_ANSWER = /\b(my|our) (answer|answers|reply|response|guess|attempt|explanation|work|idea|solution|definition)\b|\b(i|we) (said|say|think|thought|wrote|answered|guessed|put|reckon)\b/;
const ASK_TO_BE_TOLD = /\b(able to say|would you say|say so|confirm|tell (me|us) (if|whether|how (i|we))|let (me|us) know (if|whether)|is that right)\b/;

/* ------------------------------- normalisation (rule a) ------------------------------- */

/** Zero-width and soft-hyphen characters: REMOVED, never turned into a space. */
const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff\u00ad]/g;
/** Non-breaking and typographic spaces: one plain space. */
const ODD_SPACE = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g;
/** Every apostrophe a paste or another keyboard carries, folded to '. */
const APOSTROPHE = /[\u2018\u2019\u02bc\u2032\u201b\u0060\u00b4]/g;
/** Cheap, safe homoglyphs: the Cyrillic letters that look like Latin ones, and Greek omicron. */
const HOMOGLYPH = /[\u0430\u0435\u043e\u0441\u0440\u0445\u0443\u0456\u0455\u0458\u03bf]/g;
const HOMOGLYPH_ASCII = { "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0441": "c", "\u0440": "p", "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u0455": "s", "\u0458": "j", "\u03bf": "o" };

/** NFKC, homoglyph and apostrophe folding, lower case. */
function fold(question) {
  return String(question ?? "")
    .normalize("NFKC")
    .replace(HOMOGLYPH, (c) => HOMOGLYPH_ASCII[c])
    .replace(APOSTROPHE, "'")
    .toLowerCase();
}

/** One plain space between words, no leading or trailing space. */
function tidy(s) {
  return s.replace(ODD_SPACE, " ").replace(/\s+/g, " ").trim();
}

/** The folded question, lowercased. Kept for callers that only want the canonical reading. */
function normalizeQuestion(question) {
  return tidy(fold(question).replace(ZERO_WIDTH, ""));
}

/**
 * The question as the net reads it: an invisible character is ambiguous — glue inside a word
 * ("gra<ZWSP>de" is "grade") or a space between words ("grade<ZWSP>my" is "grade my") — so both
 * readings are tried. They are the same string whenever the question carries none.
 */
function readings(question) {
  const glued = normalizeQuestion(question);
  const spaced = tidy(fold(question).replace(ZERO_WIDTH, " "));
  return glued === spaced ? [glued] : [glued, spaced];
}

/* ------------------------------- the rules that need a position ------------------------------- */

/** The sentences of the question, trimmed, without their closing punctuation. */
function sentences(q) {
  return q.split(/(?<=[.!?])\s+/).map((s) => s.replace(/[.!?]+$/, "").trim()).filter(Boolean);
}

/** Levenshtein distance, but only ever asked "is it 0 or 1?" (rule d). */
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return true;
}

/** Rule (d): a misspelling of grade/score/master/pass/assess/evaluate, inside an asker-owned frame. */
function typoFrame(q) {
  const tokens = q.split(" ");
  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i];
    if (word.length < 3 || TYPO_STOPWORDS.has(word)) continue;
    // Only a MISS spelling (one edit) is read this way: a correctly spelled word is left to the patterns,
    // which carry the content lookaheads this rule has no room for.
    if (!TYPO_VOCAB.some((v) => word !== v && withinOneEdit(word, v))) continue;
    const before = tokens[i - 1] ?? "";
    const after = tokens[i + 1] ?? "";
    if (OWNER_WORDS.has(before) || OWNER_WORDS.has(after)) return true;
    // "am i gona pas": the asker, then the misspelt pass/master, within three words.
    const window = tokens.slice(Math.max(0, i - 3), i).join(" ");
    if (/\b(i|we|i'm|im|we're)\b/.test(window)) return true;
  }
  return false;
}

/** Rule (e): a bare imperative assessment verb in a second sentence, after the asker says they finished. */
function secondSentenceAsk(q) {
  const parts = sentences(q);
  for (let i = 1; i < parts.length; i += 1) {
    if (!BARE_ASK.test(parts[i])) continue;
    if (parts.slice(0, i).some((s) => ASKER_WROTE.test(s))) return true;
  }
  return false;
}

/** "check my answer/work" as a request: the check is the sentence's own main verb, and nothing is talking about checking. */
function checkRequest(q) {
  return sentences(q).some((s) => CHECK_TARGET.test(s) && !CHECK_FRAME.test(s) && CHECK_LEAD.test(s));
}

/** A mastery claim plus a request to confirm it. */
function claimAndConfirm(q) {
  return CLAIM.test(q) && CONFIRM.test(q);
}

/** N5: "right or wrong?" about something the asker answered or thinks. "Is the first law right or wrong?" is not one. */
function rightOrWrongAsk(q) {
  return RIGHT_OR_WRONG.test(q) && ASKER_ANSWER.test(q);
}

/** A standing the asker states about themselves, plus a request to be told it. */
function standingClaimAsk(q) {
  return STANDING_CLAIM.test(q) && ASK_TO_BE_TOLD.test(q);
}

function looksLikeAssessment(question) {
  for (const q of readings(question)) {
    if (ASSESSMENT_PATTERNS.some((re) => re.test(q))) return true;
    if (checkRequest(q) || secondSentenceAsk(q) || claimAndConfirm(q) || standingClaimAsk(q) || rightOrWrongAsk(q) || typoFrame(q)) return true;
  }
  return false;
}

/* ------------------------- N5 C2: the grading check on the model's ANSWER ------------------------- */

/**
 * Judging language in the MODEL's words, aimed at the student: "your answer is correct", "you got it right",
 * "that is an A", "8 out of 10", "you're good at this". It runs on every answer that would carry model words, at
 * every age, so a model that grades through any basis (plan, explanation, 18+ general) is withheld and the student
 * gets the fixed ASSESSMENT refusal instead. Like the question net it is a SAFETY NET with anchored frames, not a
 * guarantee: "you"/"your" must be the one judged, so an explanation that talks about right answers in general
 * ("the correct answer is 7") still reaches the student.
 */
export const JUDGING_PATTERNS = [
  /\byour (?:own |first |last |final )?(answer|answers|response|reply|work|explanation|reasoning|solution|essay|attempt|guess|definition|understanding|idea|thinking|calculation|claim)\b(?:\s+[a-z0-9']+){0,2}\s+(is|was|are|were|looks|seems|sounds)\s+(?:\w+ )?(correct|right|wrong|incorrect|accurate|inaccurate|perfect|excellent|great|good|poor|bad|weak|strong|spot on|on point|off|mistaken|flawed)\b/,
  /\byou('re| are| were)\s+(?:\w+ )?(correct|right|wrong|incorrect|mistaken|spot on)\b/,
  /\byou (got|get|have|scored|score|earned|earn|deserve|deserved)\b(?:\s+[a-z0-9']+){0,2}\s+(right|wrong|correct|incorrect|full marks|top marks|a pass|a fail|\d+(?:\.\d+)?\s*out of\s*\d+|\d+ ?%|\d+ points?)\b/,
  /\byou got (it|this|that|them)\b(?!\s+(?:from|by|when|if|because|in|into|out|through|wrong because))/,
  /\byou('ve| have)? (passed|failed|mastered|nailed)\b/,
  /\byou('re| are)\s+(?:(?:very|really|quite|pretty|so|not|clearly|already|definitely)\s+)*(good|bad|great|terrible|weak|strong|excellent|poor|talented|smart|clever|gifted|brilliant|proficient)\b(?!\s+to\b)/,
  /\byou('re| are) doing (well|great|badly|poorly|fine|good|ok|okay|excellent)\b/,
  /\byou (clearly|really|fully|obviously|definitely) (understand|know|grasp|get)\b/,
  /\byour (final |overall |current )?(grade|score|mark|rating|level|standing)\s+(is|would be|will be|was|:)/,
  /\b(i'd|i would|i will|i'll|i)\s+(give|grade|score|rate|mark)\s+(you|this|it|that|your)\b/,
  /\b(rating|score|grade|mark)\s*:\s*\d/,
  /^(correct|incorrect|wrong|right|exactly|well done|great job|good job|nice work|spot on|perfect)\s*[.!,:]/,
];
/** A sentence with a scale ("7 out of 10", "8/10") is a verdict only when it is aimed at the student or a mark. */
const OUT_OF = /\b\d{1,3}(?:\.\d)?\s*(?:\/|out of)\s*(?:5|10|20|100)\b/;
const OUT_OF_AIM = /\b(your|i'd|i would|i'll|score|scored|mark|grade|rating|rate|points|answer|work|reply|response)\b/;
/** A letter grade as a verdict: "That is an A", "you'd get a B+". Case kept: a capital letter, then punctuation or a grade word. */
const LETTER_GRADE = /\b(?:is|be|was|get|gets|got|earn|earns|earned|deserve|deserves|give you|gives you|worth|that's|it's|solid|easy|clear|straight)\s+(?:an?\s+)?(?:solid\s+|clear\s+|easy\s+|strong\s+)?[A-F][+-]?(?=[.,!:;)]|$|\s+(?:grade|for|from|in|on|overall|answer|work)\b)/;

/** N5 C2: does the model's answer judge the student? */
export function judgesStudent(answer) {
  const raw = String(answer ?? "").normalize("NFKC").replace(ZERO_WIDTH, "");
  if (LETTER_GRADE.test(raw)) return true;
  const q = tidy(fold(raw));
  if (JUDGING_PATTERNS.some((re) => re.test(q))) return true;
  return sentences(q).some((s) => OUT_OF.test(s) && OUT_OF_AIM.test(s));
}

/* ------------------------- N5 C1: the attempt-first backstop (under 18) ------------------------- */

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const SHORT_ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
/** Words that carry no topic: they never count toward a title match. */
const TITLE_STOPWORDS = new Set(("a an the and or but of to in on at for with by from into onto about as is are be it its this that " +
  "these those your my our their his her what which who how why when where do does did can could should would will i we you " +
  "me us them they he she just tell step steps activity activities task lesson part one some any all each new own " +
  "make makes made use using get go give help show find work do done").split(" "));
/** Lower case, letters and digits only, a crude plural fold (cells → cell). */
function words(text) {
  return tidy(fold(text).replace(ZERO_WIDTH, "").replace(/[^a-z0-9' ]+/g, " ").replace(/'/g, ""))
    .split(" ").filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * N5 C1: the try-first activity a question NAMES, by its number ("activity 2", "the second activity", "step 2",
 * "activity two") or by its title (the whole title, or at least two of its content words). Null when none.
 * A question that shares one ordinary word with a title ("what is a cell?") names nothing.
 */
export function namedTryFirst(question, items) {
  const acts = (items ?? []).filter((i) => String(i.id).startsWith("activity:"));
  const tryFirst = acts.filter((i) => i.tryFirst);
  if (tryFirst.length === 0) return null;
  const q = words(question);
  const qs = ` ${q.join(" ")} `;
  for (const item of tryFirst) {
    const n = Number(String(item.id).slice("activity:".length));
    const nums = [String(n), NUMBER_WORDS[n - 1], SHORT_ORDINALS[n - 1]].filter(Boolean);
    const byNumber = nums.some((k) => qs.includes(` activity ${k} `) || qs.includes(` activity number ${k} `) || qs.includes(` step ${k} `) || qs.includes(` task ${k} `))
      || (ORDINALS[n - 1] && new RegExp(` ${ORDINALS[n - 1]} (activity|step|task) `).test(qs))
      || (SHORT_ORDINALS[n - 1] && new RegExp(` ${SHORT_ORDINALS[n - 1]} (activity|step|task) `).test(qs));
    if (byNumber) return item;
    const title = words(topicOf(item));
    if (title.length > 0 && qs.includes(` ${title.join(" ")} `)) return item;
    const content = [...new Set(title.filter((w) => !TITLE_STOPWORDS.has(w) && w.length > 2))];
    const hits = content.filter((w) => q.includes(w)).length;
    if (content.length >= 2 && hits >= 2) return item;
  }
  return null;
}

const KINDS = new Set(["answer", "clarify", "about_helper", "off_topic", "assessment"]);

/** The reply kind: the model's own when it sent the key (unknown = off_topic); otherwise read the legacy shape. */
function kindOf(out) {
  if (out && Object.prototype.hasOwnProperty.call(out, "kind")) return KINDS.has(out.kind) ? out.kind : "off_topic";
  if (out?.refusal === "assessment") return "assessment";
  if (out?.refusal) return "off_topic";
  return "answer";
}

/**
 * @param {{pkg: ReturnType<typeof packageOf>, worker: {enabled: boolean, answerStudent: Function}, body: unknown}} input
 * @returns {Promise<{answer: string, grounded: boolean, cites: {id: string, label: string}[], note: string,
 *   kind: "answer"|"clarify"|"about_helper"|"off_topic"|"assessment"|"attempt_first", basis?: "plan"|"explanation",
 *   general?: true, nudge?: true, activity?: {id: string, title: string},
 *   refusal?: "off_topic"|"assessment", offers?: {id: string, topic: string}[]}>}
 */
export async function askStudent({ pkg, worker, body }) {
  const { question, history } = cleanQuestion(body);
  if (!worker || worker.enabled === false) throw new StudentError("WORKER_NOT_CONFIGURED", "no drafting worker is configured");
  let out;
  try {
    out = await worker.answerStudent({ question, history, title: pkg.title, items: pkg.items, ages: pkg.ages, adult: adultCourse(pkg) });
  } catch (e) {
    throw Object.assign(new StudentError(e?.code ?? "WORKER_FAILED", e instanceof Error ? e.message : String(e)), { upstream: true });
  }
  const assessment = { answer: ASSESSMENT, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "assessment", kind: "assessment" };
  // Safety net: the model may miss an assessment request; catch it here before any other kind.
  if (looksLikeAssessment(question)) return assessment;
  if (out?.refusal === "assessment") return assessment;
  const kind = kindOf(out);
  if (kind === "assessment") return assessment;
  const adultMode = adultCourse(pkg);
  // N5 C1, under 18: the host's own backstop. A question that names a try-first activity (its number or its title)
  // gets the attempt_first reply whatever the model cited, so the redirect no longer rests on the model's cite.
  if (!adultMode) {
    const named = namedTryFirst(question, pkg.items);
    if (named) {
      const title = topicOf(named);
      return { answer: attemptFirstReply(title), grounded: false, cites: [{ id: named.id, label: named.label }], note: NOT_EVIDENCE, kind: "attempt_first", activity: { id: named.id, title } };
    }
  }
  if (kind === "about_helper") return { answer: aboutHelperReply(pkg), grounded: false, cites: [], note: NOT_EVIDENCE, kind };
  const byId = new Map(pkg.items.map((i) => [i.id, i]));
  const unbracket = (c) => String(c).trim().replace(/^\[([^\[\]]+)\]$/, "$1").trim();
  const raw = Array.isArray(out?.cites) ? out.cites : [];
  if (kind === "clarify") {
    // clarify carries no model words, only a choice of items; the worker's one bracket tolerance applies.
    const ids = [...new Set(raw.map(unbracket))].filter((id) => byId.has(id));
    const chosen = ids.slice(0, MAX_OFFERS).map((id) => byId.get(id));
    if (chosen.length === 0) return offTopic(pkg);
    return { answer: clarifyReply(chosen), grounded: false, cites: chosen.map((i) => ({ id: i.id, label: i.label })), note: NOT_EVIDENCE, kind, offers: offersOf(chosen) };
  }
  if (kind !== "answer") return offTopic(pkg);
  // N5 C2: the model's own words are checked before they can reach the student, at every age and on every basis.
  // A verdict on the student is withheld; the trace says why. ASSESSMENT is the same fixed sentence.
  if (judgesStudent(out?.answer)) return { ...assessment, withheld: "judged" };
  const adult = adultMode;
  // N4, 18+ only: a general explanation on the course's subject, not resting on the lesson. It carries no cites and
  // is not grounded; the UI labels it "General explanation, not from your lesson".
  if (adult && out?.basis === "general") {
    const text = typeof out?.answer === "string" ? out.answer.trim() : "";
    if (!text) return offTopic(pkg);
    return { answer: text, grounded: false, cites: [], note: NOT_EVIDENCE, kind, basis: "explanation", general: true };
  }
  // The cite check for an answer is unchanged: exact ids the host handed out, or the redirect.
  const ids = [...new Set(raw)].filter((id) => byId.has(id));
  if (ids.length === 0) return offTopic(pkg);
  const tryFirst = ids.map((id) => byId.get(id)).find((i) => i.tryFirst);
  if (tryFirst && !adult) {
    // N4, under 18: the helper does not explain an attempt-first activity. Host words only, naming its title.
    const title = topicOf(tryFirst);
    return { answer: attemptFirstReply(title), grounded: false, cites: [{ id: tryFirst.id, label: tryFirst.label }], note: NOT_EVIDENCE, kind: "attempt_first", activity: { id: tryFirst.id, title } };
  }
  const cites = ids.map((id) => ({ id, label: byId.get(id).label }));
  const basis = out.basis === "explanation" || out.basis === "general" ? "explanation" : "plan";
  if (tryFirst) return { answer: `${NUDGE} ${out.answer}`, grounded: true, cites, note: NOT_EVIDENCE, basis, kind, nudge: true };
  return { answer: out.answer, grounded: true, cites, note: NOT_EVIDENCE, basis, kind };
}
