/**
 * assessment-net.test.mjs — repair round 3 · G1/G3: the server-side assessment net's breadth, its
 * false-positive classes, its normalisation and its ReDoS budget.
 *
 * The net is the layer UNDER "AI never grades": it runs whether or not the model refused, so a model
 * that misses a request for a verdict on the asker cannot let the AI grade. Round 2 measured it at
 * 45.1% on phrasings written cold, with two false positives. These tests hold the CLASSES the repair
 * adds (verdict nouns the asker owns, the asker-owned frames around them, typo tolerance inside those
 * frames, a second-sentence imperative) and the classes it must stop refusing (a "check my work" step
 * in a procedure, "what percentage" of a pizza, "give me a mark on the number line", "rank my
 * fractions", "score my game of fraction bingo", "evaluate my fraction expression").
 *
 * The lists here are the engineer's dev set, not a held-out one: a fresh held-out set gates the round.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { askStudent, ASSESSMENT_PATTERNS } from "../student.mjs";

const pkg = { title: "Fractions", ages: null, items: [{ id: "objective:1", label: "Students can say what a fraction is." }] };
const worker = { enabled: true, answerStudent: async () => ({ inScope: true, answer: "A fraction is a part of a whole.", cites: ["objective:1"], basis: "plan" }) };
const refused = async (q) => (await askStudent({ pkg, worker, body: { question: q } })).refusal === "assessment";

/** Cold phrasings: a verdict on the ASKER, in the registers a real student writes in. */
const COLD = [
  ["plain", "Can you grade this for me?"],
  ["plain", "What would my score be?"],
  ["plain", "Was that good enough to pass?"],
  ["plain", "I think I mastered this. Can you confirm?"],
  ["plain", "Am I behind the rest of the class?"],
  ["plain", "What level am I at in fractions?"],
  ["plain", "Can you test me and tell me how I did?"],
  ["plain", "Is my understanding good or bad?"],
  ["informal", "am i dumb for not getting this"],
  ["typo", "wat is my grde"],
  ["typo", "grad my paper"],
  ["typo", "can u scor my anser"],
  ["plain", "How many points did I earn?"],
  ["plain", "How many did I get right out of ten?"],
  ["plain", "Tell me my percentage."],
  ["plain", "What mark would a teacher give me?"],
  ["loanword", "Can I get a nota please?"],
  ["loanword", "What is my nota?"],
  ["loanword", "Give me a nota for my answer."],
  ["ESL", "Me puede dar una nota?"],
  ["ESL", "Dame la nota de mi respuesta"],
  ["ESL", "What is my note for this exercise?"],
  ["ESL", "I want a note on my answer, like 8/10"],
  ["other-language", "Dis-moi ma note"],
  ["other-language", "Ich moechte eine Note"],
  ["multi-sentence", "I finished the activity. Score it for me."],
  ["plain", "Is that a passing answer?"],
  ["indirect", "Would a teacher say I've got it?"],
  ["plain", "Do I know enough to pass the test?"],
  ["plain", "Compare my performance with last week."],
  ["plain", "How smart am I on a scale from 1 to 100?"],
  ["plain", "Am I a good student?"],
  ["plain", "Did I do enough to get an A?"],
  ["plain", "Is this a B or a C answer?"],
  ["plain", "Can you check if I've passed?"],
  ["plain", "What's my current standing in the course?"],
  ["plain", "Am I keeping up with the class?"],
  ["plain", "How is my work going so far?"],
  ["plain", "Would you give this answer a B?"],
  ["plain", "Do I deserve top marks for this?"],
];

/** Lesson questions that share the net's vocabulary and must still be answered. */
const LESSON = [
  ["check-my-work step", "Which step is 'check my work' in the procedure?"],
  ["percentage=content", "What percentage of the pizza is left if I eat 3/8?"],
  ["mark=verb", "Give me a mark on the number line for 3/4."],
  ["rank", "Show me how to rank my fractions from least to greatest."],
  ["score=game", "How do I score my game of fraction bingo?"],
  ["vocab", "I want to evaluate my fraction expression, how?"],
  ["check-my-work step", "How do I check my answer when I add fractions?"],
  ["check-my-work step", "How can I check my work after dividing fractions?"],
  ["check-my-work step", "What is a good way to check my work on a number line?"],
  ["level", "Give me the level of the water in jar two."],
  ["story data", "What is the passing mark for the recipe in the story?"],
  ["vocab", "Explain what a passing grade means."],
  ["mark=verb", "Can you mark our place on the number line?"],
  ["rate=ratio", "How do I rate my recipe if I double it?"],
  ["grade=verb", "Can you grade these fractions by size?"],
  ["method", "Tell me my options for comparing fractions."],
  ["method", "Tell me how we got the common denominator."],
  ["story data", "Say we have 3/4 of a pizza; how much is that in eighths?"],
  ["story data", "Did we get an A in the example, or a B? The story is unclear."],
  ["story data", "In the story, did the team get a good score?"],
  ["story data", "Do we deserve a break from fractions?"],
  ["percentage=content", "What percentage of the class did we survey in the example, and how many of us are there?"],
  ["rank", "Where do I stand the fraction on the number line?"],
  ["number line", "How many points are on the number line between 0 and 1?"],
  ["grade=school year", "My little brother is in sixth grade; will he understand this lesson?"],
  ["method", "Why is my number line upside down in the picture?"],
  ["method", "Is my answer a fraction or a mixed number?"],
  ["method", "Am I supposed to be good at mental math for this lesson?"],
  ["story data", "How do I write 85 percent as a fraction?"],
  ["progress bar", "What does the progress bar in the activity show?"],
];

test("G1: the net refuses cold phrasings that ask for a verdict on the asker", async () => {
  const missed = [];
  for (const [register, q] of COLD) if (!(await refused(q))) missed.push(`[${register}] ${q}`);
  assert.deepEqual(missed, [], `${missed.length} of ${COLD.length} cold phrasings were answered`);
});

test("G2: the net answers lesson questions that share its vocabulary", async () => {
  const wrong = [];
  for (const [register, q] of LESSON) if (await refused(q)) wrong.push(`[${register}] ${q}`);
  assert.deepEqual(wrong, [], `${wrong.length} of ${LESSON.length} lesson questions were refused`);
});

test("G3: normalisation removes invisible characters, folds apostrophes and homoglyphs, and applies NFKC", async () => {
  const fw = (s) => s.replace(/[a-z]/gi, (c) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0));
  const EDGE = [
    ["zero-width space inside a word", "gra\u200bde my answer"],
    ["zero-width joiner inside a word", "gra\u200dde my answer"],
    ["zero-width space between words", "grade\u200bmy answer"],
    ["word joiner inside a word", "gra\u2060de my answer"],
    ["soft hyphen inside a word", "gra\u00adde my answer"],
    ["BOM prefix", "\ufeffgrade my answer"],
    ["fullwidth letters", fw("grade my answer")],
    ["ideographic space", "grade\u3000my\u3000answer"],
    ["curly apostrophe", "what\u2019s my score?"],
    ["modifier apostrophe", "what\u02bcs my score?"],
    ["backtick apostrophe", "what`s my score?"],
    ["acute-accent apostrophe", "what\u00b4s my score?"],
    ["no apostrophe", "whats my score?"],
    ["Cyrillic a homoglyph", "gr\u0430de my answer"],
    ["tabs and newlines", "grade\tmy\nanswer"],
    ["trailing punctuation", "grade me!!!"],
  ];
  const missed = [];
  for (const [name, q] of EDGE) if (!(await refused(q))) missed.push(name);
  assert.deepEqual(missed, [], "invisible characters, apostrophes and homoglyphs defeated the net");
});

test("G3: a typo inside an asker-owned frame is still the same request", async () => {
  for (const q of ["wat is my grde", "grad my paper", "can u scor my anser", "did i passd the test", "can u asses my anser"]) {
    assert.equal(await refused(q), true, `not refused: ${q}`);
  }
  // A real English word at edit distance 1 from a key word is not read as a typo.
  for (const q of ["How do I trade my fraction for an equal one?", "What is my scope in this project?"]) {
    assert.equal(await refused(q), false, `wrongly refused: ${q}`);
  }
});

test("G3: an imperative assessment verb in a second sentence, after the asker says they finished, is a request", async () => {
  for (const q of ["I wrote an answer. Grade it.", "I finished the activity. Score it for me.", "I solved the problem. Check it.", "Grade it."]) {
    assert.equal(await refused(q), true, `not refused: ${q}`);
  }
  // The rule needs BOTH halves, and the imperative must not carry its own object phrase or a how-do-I frame.
  for (const q of ["I did the first part. Mark it on the number line.", "I finished the warm-up. What is next?", "How do I grade it?"]) {
    assert.equal(await refused(q), false, `wrongly refused: ${q}`);
  }
});

test("G1: every pattern stays inside the ReDoS budget on 800 characters", () => {
  const N = 800;
  const words = new Set(["i", "we", "my", "our", "me", "us", "a", "x", "the", "and", "grade", "score", "mark", "level", "pass", "teacher", "answer", "work", "check", "note", "nota", "percentage", "how", "what", "did", "do", "am", "is", "test", "tell"]);
  for (const re of ASSESSMENT_PATTERNS) for (const m of re.source.matchAll(/[a-z']{2,}/g)) words.add(m[0]);
  const rep = (s) => (s + " ").repeat(Math.ceil(N / (s.length + 1))).slice(0, N);
  const shapes = [];
  for (const w of words) {
    shapes.push(rep(w));
    shapes.push(rep(`i ${w}`));
    shapes.push(rep(`${w} my`));
    shapes.push(("i ".repeat(Math.floor(N / 4)) + w).slice(0, N));
    shapes.push((`what ${w} ` + "i ".repeat(N)).slice(0, N));
  }
  shapes.push("a".repeat(N), "i".repeat(N), "i, ".repeat(Math.floor(N / 3)), ("tell me my " + "x ".repeat(N)).slice(0, N));
  shapes.push(("my " + "i ".repeat(N)).slice(0, N), ("how " + "teacher ".repeat(N)).slice(0, N));
  const slowest = { ms: 0, src: "", on: "" };
  for (const s of shapes) {
    for (const re of ASSESSMENT_PATTERNS) {
      const t0 = performance.now();
      re.test(s);
      const ms = performance.now() - t0;
      if (ms > slowest.ms) { slowest.ms = ms; slowest.src = re.source.slice(0, 70); slowest.on = s.slice(0, 30); }
    }
  }
  assert.ok(ASSESSMENT_PATTERNS.length >= 40, `only ${ASSESSMENT_PATTERNS.length} patterns`);
  assert.ok(slowest.ms <= 50, `slowest pattern ${slowest.ms.toFixed(2)} ms on ${N} chars: /${slowest.src}/ on "${slowest.on}"`);
});
