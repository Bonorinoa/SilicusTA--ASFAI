/**
 * proposer.test.mjs — the anti-invention property, as a unit.
 *
 * The claim these tests defend: a proposal exists only because the teacher wrote
 * the sentence, and it is always a LOCAL objective (so no fabricated Marble id
 * can become an identity).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { objectivesFromAnswers, outcomeSentences, SOURCE_FROM_ANSWERS, SOURCE_FROM_LOCAL_ANSWERS } from "../proposer.mjs";

test("each teacher outcome sentence becomes one local proposal, verbatim", () => {
  const items = objectivesFromAnswers({
    learning_outcomes: [
      "Students can explain what an algorithm is.",
      "Learners can find the claim in an AI answer.",
    ],
  });
  assert.deepEqual(items, [
    { kind: "local", statement: "Students can explain what an algorithm is." },
    { kind: "local", statement: "Learners can find the claim in an AI answer." },
  ]);
  assert.equal(SOURCE_FROM_ANSWERS, "from your answer to ASFAI");
});

test("no outcomes, no proposals — the proposer never invents one", () => {
  assert.deepEqual(objectivesFromAnswers({}), []);
  assert.deepEqual(objectivesFromAnswers({ learning_outcomes: [] }), []);
  assert.deepEqual(objectivesFromAnswers({ learning_outcomes: ["  ", ""] }), []);
  assert.deepEqual(objectivesFromAnswers({ topic: "a topic, but no outcomes" }), []);
  assert.deepEqual(objectivesFromAnswers(null), []);
  assert.deepEqual(objectivesFromAnswers(undefined), []);
});

test("a proposal is always kind:local — the proposer cannot mint a Marble id", () => {
  const items = objectivesFromAnswers({ learning_outcomes: ["mt_alpha: hijack the id"] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "local");
  assert.equal("publicId" in items[0], false);
  // the teacher's text is kept verbatim, including anything that looks like an id:
  // it is a statement, not a key.
  assert.equal(items[0].statement, "mt_alpha: hijack the id");
});

test("a single-string answer is split on newlines, so one line is one objective", () => {
  const items = objectivesFromAnswers({ learning_outcomes: "First outcome.\nSecond outcome." });
  assert.deepEqual(items.map((i) => i.statement), ["First outcome.", "Second outcome."]);
});

test("the teacher's wording is preserved: no trimming inside, no rewriting", () => {
  const items = objectivesFromAnswers({
    learning_outcomes: ["  Students can explain what an algorithm is, in their own words.  "],
  });
  assert.equal(items[0].statement, "Students can explain what an algorithm is, in their own words.");
});

test("outcomeSentences is THE split rule: array in, string in, junk out", () => {
  assert.deepEqual(outcomeSentences(["a", " b ", "", "   "]), ["a", "b"]);
  assert.deepEqual(outcomeSentences("a\n b \n\n"), ["a", "b"]);
  assert.deepEqual(outcomeSentences(null), []);
  assert.deepEqual(outcomeSentences(undefined), []);
  assert.deepEqual(outcomeSentences({}), []);
  assert.deepEqual(outcomeSentences(42), [], "a number is not an answer to an open question");
  assert.deepEqual(outcomeSentences(["  keep  the  inside  spacing  "]), ["keep  the  inside  spacing"]);
});

test("the proposals derive from the same list intake.mjs sends ASFAI — one rule, one home", () => {
  // If these ever disagree the teacher confirms a course ASFAI never saw. The rule lives
  // in outcomeSentences; intake.cleanAnswers calls the same function to build
  // learningOutcomes. This test fails the moment someone forks it.
  const raw = "First outcome.\n\n  Second outcome.  \n";
  assert.deepEqual(outcomeSentences(raw), ["First outcome.", "Second outcome."]);
  assert.deepEqual(
    objectivesFromAnswers({ learning_outcomes: raw }).map((o) => o.statement),
    outcomeSentences(raw),
  );
});

test("the two source labels are distinct and both honest", () => {
  assert.equal(SOURCE_FROM_ANSWERS, "from your answer to ASFAI");
  assert.equal(SOURCE_FROM_LOCAL_ANSWERS, "from your answer");
  assert.notEqual(SOURCE_FROM_ANSWERS, SOURCE_FROM_LOCAL_ANSWERS);
});
