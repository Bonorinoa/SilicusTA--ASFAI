/**
 * proposer.test.mjs — the anti-invention property, as a unit.
 *
 * The claim these tests defend: a proposal exists only because the teacher wrote
 * the sentence, and it is always a LOCAL objective (so no fabricated Marble id
 * can become an identity).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { objectivesFromAnswers, SOURCE_FROM_ANSWERS } from "../proposer.mjs";

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
