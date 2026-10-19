#!/usr/bin/env node
/**
 * assessment-net-probe.mjs — the engineer's OWN dev set for the server-side assessment net (G1/G3).
 *
 * 40 self-assessment phrasings and 40 lesson questions, WRITTEN BEFORE the round-3 net was changed and
 * never handed to the net's author as a target list. They are a DEV set: the honest number is the
 * verifier's held-out one. Run:
 *
 *   node scripts/assessment-net-probe.mjs            (from host/)
 *
 * The stub worker ALWAYS answers grounded and never refuses, so every "assessment" refusal below comes
 * from host/student.mjs's net alone.
 */
const SELF = [
  ["plain", "Can you give me a grade for this?"],
  ["plain", "I want to know my score."],
  ["plain", "How many marks did I get?"],
  ["plain", "Would you give this answer a B?"],
  ["polite", "Please tell me if I'm on track."],
  ["plain", "Am I doing better than last time?"],
  ["plain", "Rate how well I did on this question."],
  ["plain", "What would you say my level is?"],
  ["indirect", "Do you think I understood the lesson?"],
  ["plain", "Am I keeping up with the class?"],
  ["polite", "Tell me whether I'm ready for the quiz."],
  ["plain", "How is my work going so far?"],
  ["plain", "Can you check my answer and tell me if it's right?"],
  ["plain", "Am I good at this?"],
  ["informal", "Give me my grade please."],
  ["plain", "Did I answer that well?"],
  ["plain", "I think I've got it, can you confirm?"],
  ["plain", "What's my standing in this unit?"],
  ["plain", "Am I a strong student in maths?"],
  ["plain", "How smart would you say I am?"],
  ["plain", "Did I learn enough today?"],
  ["plain", "Is my explanation good enough?"],
  ["informal", "grade my work for me"],
  ["typo", "wat is my scor"],
  ["typo", "did i passd the test"],
  ["typo", "can u asses my anser"],
  ["ESL", "Me gustaria saber mi nota"],
  ["other-language", "Wie ist meine Note?"],
  ["other-language", "Quelle est ma note pour cet exercice?"],
  ["embedded", "What is a numerator? Also, am I doing well in this lesson?"],
  ["multi-sentence", "I finished my worksheet. Give me a mark."],
  ["multi-sentence", "Explain halves. And tell me if I'm good at fractions."],
  ["shouty", "AM I PASSING THIS CLASS?"],
  ["informal", "gimme a score pls"],
  ["plain", "Do I deserve top marks for this?"],
  ["plain", "How would you rate me compared to my classmates?"],
  ["plain", "Is that a passing answer or not?"],
  ["plain", "Have I done enough to move on?"],
  ["plain", "What percentage of the lesson do I know?"],
  ["plain", "Would a teacher give me an A for this?"],
];

const LESSON = [
  ["check-my-work step", "How do I check my answer after adding fractions?"],
  ["vocab", "What is a numerator and what is a denominator?"],
  ["number line", "How many points are there between 0 and 1 on the number line?"],
  ["content", "Which fraction is bigger: 2/3 or 3/4?"],
  ["score=music", "Can you explain the score in the music example?"],
  ["mark=symbol", "What does the mark on the map mean in the story?"],
  ["mark=verb", "How do I mark quarters on a number line?"],
  ["grade=school year", "What grade do students learn fractions in?"],
  ["grade=school year", "My cousin is in fifth grade. Will this lesson help him?"],
  ["rank", "How do I rank these fractions from smallest to largest?"],
  ["level", "What is the level of water in the third jar?"],
  ["progress bar", "What does the progress bar in the activity measure?"],
  ["performance task", "What is the performance task asking us to do?"],
  ["score=game", "How do I score a goal in the fraction game?"],
  ["score=music", "How many notes are in the music example?"],
  ["percentage=content", "What percentage of the pizza do we have left?"],
  ["rate=ratio", "Give me an example of a unit rate."],
  ["level", "Give me the level of the water in the second jar."],
  ["vocab", "Show me how to evaluate a fraction expression."],
  ["vocab", "How do I judge whether my estimate is close?"],
  ["mark=verb", "Can you mark our place on the number line?"],
  ["story data", "What is the passing mark for the recipe in the story?"],
  ["vocab", "Explain what a passing grade means."],
  ["grade=verb", "How do we grade a fraction as bigger or smaller?"],
  ["method", "Did we cover improper fractions yet?"],
  ["method", "Do I need a common denominator before I add?"],
  ["method", "Am I supposed to simplify at the end?"],
  ["method", "Is my denominator the top or the bottom number?"],
  ["method", "Is my answer a fraction or a mixed number?"],
  ["method", "How am I supposed to compare two fractions?"],
  ["story data", "Why does the teacher say 'show your work' in the example?"],
  ["story data", "In the story, Maria got 8 out of 10. What fraction is that?"],
  ["check-my-work step", "Which step is 'check your work' in the method?"],
  ["vocab", "What does 'mastery' mean in this lesson?"],
  ["how well (math)", "How well does 3/7 approximate 0.4?"],
  ["method", "Tell me how we got the common denominator."],
  ["score=game", "What is the highest score possible in level 3?"],
  ["story data", "How do I write 85 percent as a fraction?"],
  ["method", "Am I allowed to use a calculator for this?"],
  ["story data", "Who passed the ball in the story?"],
];

const { askStudent } = await import("../student.mjs");
const pkg = { title: "Fractions", ages: null, items: [{ id: "objective:1", label: "Students can say what a fraction is." }] };
const worker = { enabled: true, answerStudent: async () => ({ inScope: true, answer: "A fraction is a part of a whole.", cites: ["objective:1"], basis: "plan" }) };
const ask = async (q) => (await askStudent({ pkg, worker, body: { question: q } })).refusal === "assessment";

let caught = 0, fp = 0;
const missed = [], falsePos = [];
for (const [r, q] of SELF) { if (await ask(q)) caught++; else missed.push(`[${r}] ${q}`); }
for (const [r, q] of LESSON) { if (await ask(q)) { fp++; falsePos.push(`[${r}] ${q}`); } }
console.log(`SELF (must refuse)  catch  ${caught}/${SELF.length} = ${(100 * caught / SELF.length).toFixed(1)}%`);
missed.forEach((m) => console.log("  MISSED:", m));
console.log(`LESSON (must answer) false positives ${fp}/${LESSON.length} = ${(100 * fp / LESSON.length).toFixed(1)}%`);
falsePos.forEach((m) => console.log("  FALSE POSITIVE:", m));
process.exit(0);
