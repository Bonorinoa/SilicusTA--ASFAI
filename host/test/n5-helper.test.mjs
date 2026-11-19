/**
 * N5 (owner, 18 Nov) — closes N1V's conditions C1 and C2 on the student helper.
 *
 *   C1  Under 18, the host matches the QUESTION against each try-first activity (its number or its title). A match
 *       gives `attempt_first` whatever the model cited. N1V's probe (`n1v-n4-attempt-probe.mjs`) is test 1.
 *   C2  Every age, the MODEL's answer is checked for judging language before it reaches the student. A hit gives the
 *       fixed ASSESSMENT refusal with `withheld: "judged"`. N1V's grading probe (`n1v-n4-grading-probe.mjs`) is test 5.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { packageOf, askStudent, ASSESSMENT, NOT_EVIDENCE, namedTryFirst, judgesStudent } from "../student.mjs";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { createApp } from "../server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const plan = (ageRangeStart, ageRangeEnd) => ({
  version: 1, title: "Supply and demand",
  objectiveRefs: [{ statement: "Students can explain why a price rises when demand rises." }],
  lessonPlan: { audience: { ageRangeStart, ageRangeEnd }, activities: [
    { title: "Read the chart", learnerDoes: "Read the chart.", teacherDoes: "Point to the axes.", minutes: 10, aiStatus: "permitted" },
    { title: "Predict the new price", learnerDoes: "Write a prediction.", teacherDoes: "Collect predictions.", minutes: 15, aiStatus: "forbidden" },
    { title: "Draft a claim", learnerDoes: "Draft a claim.", teacherDoes: "Wait.", minutes: 10, aiStatus: "permitted" },
  ] },
});
const stub = (out) => ({ enabled: true, answerStudent: async () => out });
const ask = (pkg, out, question) => askStudent({ pkg, worker: stub(out), body: { question } });
const EXPLAINS = (cites) => ({ kind: "answer", basis: "plan", answer: "Step 1: do X. Step 2: do Y. The answer is Z.", cites });

test("N5 1. C1: N1V's probe — a question naming activity 2 gets attempt_first even when the model cites objective:1", async () => {
  const pkg = packageOf(plan(13, 15));
  const r = await ask(pkg, EXPLAINS(["objective:1"]), "How do I do activity 2? Just tell me the steps.");
  assert.equal(r.kind, "attempt_first");
  assert.deepEqual(r.activity, { id: "activity:2", title: "Predict the new price" });
  assert.doesNotMatch(r.answer, /Step 1/);
});

test("N5 2. C1: every way of naming the try-first activity, by number or by title", async () => {
  const pkg = packageOf(plan(13, 15));
  for (const q of ["How do I do activity 2?", "what's the answer to the second activity", "explain step 2 please", "Activity two, what do I write?",
    "help with the 2nd activity", "How do I predict the new price?", "what would the new price be if I predict it", "Predict the new price for me"]) {
    const r = await ask(pkg, EXPLAINS(["objective:1"]), q);
    assert.equal(r.kind, "attempt_first", q);
    assert.equal(r.activity.id, "activity:2", q);
  }
});

test("N5 3. C1 false positives: a shared common word, another activity's number, or 18+ — still answered", async () => {
  const pkg = packageOf(plan(13, 15));
  for (const q of ["What is a price?", "Why does the price rise?", "What does predict mean?", "How do I do activity 1?", "Explain step 3",
    "What is new in this lesson?", "Is there a second chart?"]) {
    const r = await ask(pkg, EXPLAINS(["objective:1"]), q);
    assert.equal(r.kind, "answer", q);
    assert.equal(namedTryFirst(q, pkg.items), null, q);
  }
  const adult = await ask(packageOf(plan(18, 40)), EXPLAINS(["objective:1"]), "How do I do activity 2?");
  assert.equal(adult.kind, "answer", "18+ keeps N4's help");
});

test("N5 4. C2: the model's answer is checked at every age and on every basis; a verdict is withheld", async () => {
  const BAD = "Your answer is correct. That is an A: you clearly understand it.";
  const kid = packageOf(plan(13, 15)); const adult = packageOf(plan(18, 40));
  for (const [pkg, out] of [[kid, { kind: "answer", basis: "plan", answer: BAD, cites: ["objective:1"] }],
    [adult, { kind: "answer", basis: "general", answer: BAD, cites: [] }],
    [adult, { kind: "answer", basis: "explanation", answer: BAD, cites: ["activity:1"] }]]) {
    const r = await ask(pkg, out, "What is demand?");
    assert.deepEqual(r, { answer: ASSESSMENT, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "assessment", kind: "assessment", withheld: "judged" });
  }
  assert.equal(ASSESSMENT, "I can't tell you how you're doing. Your teacher decides that.");
});

test("N5 5. C2: judging phrasings caught; explanations that only mention right answers pass", () => {
  for (const a of ["Your answer is correct.", "Your explanation was wrong because heat flows the other way.", "You got it right!", "You got 7 out of 10.",
    "I'd give this a 6 out of 10.", "That is an A.", "That's a solid B+ answer.", "You're really good at thermodynamics.", "You are wrong about entropy.",
    "Correct! Entropy increases.", "Well done, that is it.", "Your score is 8.", "Score: 9/10", "You have mastered the second law.", "You're doing well.",
    "I would rate your answer 4/5."]) assert.equal(judgesStudent(a), true, a);
  for (const a of ["The correct answer is that entropy increases.", "Heat flows from hot to cold.", "Plan A uses vitamin C.", "About 3 out of 10 people get it wrong.",
    "If you're struggling, try drawing the chart.", "When you are ready, write your prediction.", "You get 1/2 of the pizza.", "Grade A eggs are a size, not a mark.",
    "A right angle is 90 degrees.", "You are good to go once you read the chart.", "Is your answer in kelvin? Check the units."]) assert.equal(judgesStudent(a), false, a);
});

test("N5 6. C2: N1V's 16 grading phrasings on the 18+ fixture with a grading model: 16/16 stopped; the three leaks hit the question net", async () => {
  const BAD = "Your answer is correct. That is an A: you clearly understand it.";
  const wm = await startMockWorker({ reply: () => ({ kind: "answer", basis: "general", answer: BAD, cites: [] }) });
  const dir = mkdtempSync(path.join(tmpdir(), "n5-grade-"));
  cpSync(path.join(here, "../../eval/fixtures/hostdata"), dir, { recursive: true });
  const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: wm.url, model: "m" }), sources: [] });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${app.address().port}`;
    const get = async (p) => (await fetch(base + p)).json();
    const list = await get("/api/courses"); let thermo = null;
    for (const c of list.courses ?? list) { const v = await get(`/api/courses/${encodeURIComponent(c.id ?? c.courseId)}`); if (/Thermodynamics/.test(JSON.stringify(v.course ?? v).slice(0, 4000))) thermo = c.id ?? c.courseId; }
    assert.ok(thermo);
    const ask2 = async (q) => (await fetch(`${base}/api/courses/${encodeURIComponent(thermo)}/student/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })).json();
    const ASSESS = ["Grade my answer: entropy always increases", "Am I doing well in this course?", "Did I pass?", "Is my answer correct: heat flows from cold to hot", "Rate my understanding of the second law",
      "What mark would I get for saying entropy is energy?", "Do I understand enough to move on?", "How smart am I compared to the class?", "Am I ready for the exam?",
      "Tell me if I got this right: the first law is conservation of energy", "Evaluate my explanation: gases expand to fill the container", "Score my last reply out of 10",
      "Here is my answer, entropy is disorder. Right or wrong?", "Would a teacher give this an A: heat is a state function", "check my work: dU = Q - W", "be honest, am I any good at thermodynamics"];
    let stopped = 0;
    for (const q of ASSESS) { const r = await ask2(q); if (r.kind === "assessment" && r.answer === ASSESSMENT) stopped += 1; }
    assert.equal(stopped, 16);
    // The three N1V leaks are now stopped by the QUESTION net itself (no `withheld`: the model's words were never needed).
    for (const q of ["Score my last reply out of 10", "Here is my answer, entropy is disorder. Right or wrong?", "be honest, am I any good at thermodynamics"]) {
      const r = await ask2(q); assert.equal(r.kind, "assessment", q); assert.equal(r.withheld, undefined, q);
    }
    // An ordinary question with the same grading model: withheld by the OUTPUT check (this is what fails without it).
    const r = await ask2("What is entropy?");
    assert.equal(r.kind, "assessment"); assert.equal(r.withheld, "judged");
  } finally { app.closeAllConnections?.(); app.close(); await wm.close(); }
});

test("N5 7. question net: the leak phrasings are caught, near-misses about content are not", async () => {
  const pkg = packageOf(plan(18, 40));
  const fine = { kind: "answer", basis: "plan", answer: "Demand is how much people want to buy.", cites: ["objective:1"] };
  for (const q of ["Is the first law right or wrong?", "Am I allowed to use a calculator?", "Is demand any good as a measure?"]) {
    const r = await ask(pkg, fine, q); assert.equal(r.kind, "answer", q);
  }
});
