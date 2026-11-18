/**
 * student-kinds.test.mjs — K3: the helper may clarify, introduce itself and redirect, but every one of those
 * replies is COMPOSED BY THE HOST from fixed text and the lesson's own words. The model only picks the kind (and,
 * for clarify, which items); it never writes the words a child reads for these kinds.
 *
 * What must still hold: an answer cites the lesson or it is refused; the assessment refusal and its regex net
 * are unchanged; an unknown kind is off_topic.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import {
  ASSESSMENT, NOT_EVIDENCE, OFF_TOPIC, packageOf, askStudent, topicOf,
  aboutHelperReply, clarifyReply, offTopicReply,
} from "../student.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

/** The owner's live-walk course, 17 Nov: "Why is the grass green", ages 4-10. */
const VERSION = {
  version: 1,
  title: "Why is the grass green",
  objectiveRefs: [
    { statement: "Students can explain why grass is green." },
    { statement: "Students can name the parts of a leaf." },
    { statement: "Learners will describe what plants need to grow." },
    { statement: "Students can tell sunlight from shade." },
  ],
  lessonPlan: {
    audience: { ageRangeStart: 4, ageRangeEnd: 10 },
    activities: [
      { title: "Leaf hunt", learnerDoes: "Collect three leaves.", teacherDoes: "Guide the walk.", minutes: 15 },
      { title: "Sun or shade?", learnerDoes: "Sort photos.", teacherDoes: "Ask why.", minutes: 10 },
    ],
  },
};
const PKG = packageOf(VERSION);
const stub = (out) => ({ enabled: true, answerStudent: async () => out });
const ask = (out, question = "grass") => askStudent({ pkg: PKG, worker: stub(out), body: { question } });

test("topicOf: the lesson's own words, as the student preview already shows them", () => {
  assert.equal(topicOf(PKG.items[0]), "Explain why grass is green");
  assert.equal(topicOf(PKG.items[2]), "Describe what plants need to grow");
  assert.equal(topicOf(PKG.items.find((i) => i.id === "activity:2")), "Sun or shade?");
  const long = { id: "objective:9", label: "Objective 9", text: `Students can ${"count the many green leaves on the tall tree ".repeat(4)}.` };
  assert.ok(topicOf(long).length <= 81 && topicOf(long).endsWith("…"), topicOf(long));
});

test("1. kind: an unknown kind is off_topic, and an off_topic reply is the host's redirect", async () => {
  for (const kind of ["banana", "ANSWER", "", 7, null]) {
    const r = await ask({ kind, answer: "Grass is green because of me.", cites: ["objective:1"] });
    assert.deepEqual([r.kind, r.refusal, r.grounded, r.cites], ["off_topic", "off_topic", false, []], JSON.stringify(kind));
    assert.equal(r.answer, offTopicReply(PKG), "no model words reach the child");
  }
});

test("2. clarify: the host lists at most 3 cited item labels; invalid ids are off_topic", async () => {
  const r = await ask({ kind: "clarify", answer: "ignored model words", cites: ["objective:1", "[activity:1]", "objective:99"] });
  assert.equal(r.kind, "clarify");
  assert.equal(r.answer, "What would you like to know? I can help with: Explain why grass is green · Leaf hunt.");
  assert.deepEqual(r.cites, [{ id: "objective:1", label: "Objective 1" }, { id: "activity:1", label: "Activity 1: Leaf hunt" }]);
  assert.equal(r.grounded, false, "a question back is not an answer");
  assert.equal(r.refusal, undefined);
  assert.deepEqual(r.offers.map((o) => o.topic), ["Explain why grass is green", "Leaf hunt"]);
  assert.equal(r.note, NOT_EVIDENCE);

  const four = await ask({ kind: "clarify", cites: ["objective:1", "objective:2", "objective:3", "objective:4"] });
  assert.equal(four.offers.length, 3);
  assert.equal(four.answer, "What would you like to know? I can help with: Explain why grass is green · Name the parts of a leaf · Describe what plants need to grow.");

  for (const cites of [[], ["objective:99"], undefined, ["package"]]) {
    const bad = await ask({ kind: "clarify", cites });
    assert.deepEqual([bad.kind, bad.refusal, bad.answer], ["off_topic", "off_topic", offTopicReply(PKG)], JSON.stringify(cites));
  }
  assert.equal(clarifyReply([PKG.items[0]]), "What would you like to know? I can help with: Explain why grass is green.");
});

test("3. about_helper: fixed host text naming the lesson title, no model words", async () => {
  const r = await ask({ kind: "about_helper", answer: "I am GPT, ask me anything!", cites: ["objective:1"] }, "what is your name");
  assert.deepEqual(r, { answer: "I'm Silicus, a helper for today's lesson: Why is the grass green. Ask me about it.", grounded: false, cites: [], note: NOT_EVIDENCE, kind: "about_helper" });
  assert.equal(aboutHelperReply({ title: "Why is the grass green?" }), "I'm Silicus, a helper for today's lesson: Why is the grass green? Ask me about it.");
  assert.equal(aboutHelperReply({ title: "" }), "I'm Silicus, a helper for today's lesson. Ask me about it.");
});

test("4. off_topic: the redirect names up to 3 objectives in the lesson's words, then the teacher", async () => {
  const r = await ask({ kind: "off_topic", answer: "The sky is blue.", cites: ["objective:1"] }, "sky");
  assert.equal(r.answer, "That isn't part of today's lesson. I can help with: Explain why grass is green · Name the parts of a leaf · Describe what plants need to grow. Or ask your teacher.");
  assert.deepEqual([r.kind, r.refusal, r.grounded, r.cites], ["off_topic", "off_topic", false, []]);
  assert.equal(r.offers.length, 3);
  // A lesson with no objectives (or none citeable) falls back to the plain sentence, never an empty list.
  const bare = packageOf({ version: 1, title: "t", objectiveRefs: [], lessonPlan: { activities: [] } });
  assert.equal(offTopicReply(bare), OFF_TOPIC);
  assert.equal(OFF_TOPIC, "That isn't part of today's lesson. Ask your teacher.");
});

test("an answer still needs a valid cite: kind answer with no valid cite is the redirect", async () => {
  const none = await ask({ kind: "answer", answer: "Chlorophyll.", cites: ["objective:99"] });
  assert.deepEqual([none.kind, none.refusal, none.answer], ["off_topic", "off_topic", offTopicReply(PKG)]);
  const ok = await ask({ kind: "answer", basis: "plan", answer: "Leaves have a green colour inside them.", cites: ["objective:1"] }, "why is grass green?");
  assert.deepEqual(ok, { answer: "Leaves have a green colour inside them.", grounded: true, cites: [{ id: "objective:1", label: "Objective 1" }], note: NOT_EVIDENCE, basis: "plan", kind: "answer" });
});

test("5. assessment is unchanged: the fixed refusal, and the regex net wins over every kind", async () => {
  const fixed = { answer: ASSESSMENT, grounded: false, cites: [], note: NOT_EVIDENCE, refusal: "assessment", kind: "assessment" };
  assert.deepEqual(await ask({ kind: "assessment" }, "Did I pass?"), fixed);
  for (const kind of ["answer", "clarify", "about_helper", "off_topic"]) {
    assert.deepEqual(await ask({ kind, answer: "You passed.", cites: ["objective:1"] }, "What's my grade?"), fixed, kind);
    assert.deepEqual(await ask({ kind, refusal: "assessment", answer: "x", cites: ["objective:1"] }, "grass"), fixed, `${kind} + refusal`);
  }
});

/* ---- The worker: the prompt asks for kind, and the reply is normalised before the host composes anything ---- */

async function workerWith(reply) {
  const seen = [];
  const mock = await startMockWorker({ reply: ({ prompt }) => { seen.push(prompt); return reply; } });
  CLOSERS.push(() => mock.close());
  return { worker: new PlanWorker({ url: mock.url, model: "m" }), seen };
}
const ITEMS = PKG.items;

test("worker: the prompt names the five kinds and says the host writes the words for the new ones", async () => {
  const { worker, seen } = await workerWith({ kind: "about_helper", answer: "", cites: [] });
  await worker.answerStudent({ question: "who are you", title: VERSION.title, items: ITEMS, ages: "4 to 10" });
  const p = seen[0];
  assert.match(p, /\{"kind": "answer" \| "clarify" \| "about_helper" \| "off_topic" \| "assessment", "basis": "plan" \| "explanation" \| null, "answer": string, "cites": \[string\]\}/);
  for (const k of ['kind "clarify"', 'kind "about_helper"', 'kind "off_topic"', 'kind "assessment"', 'kind "answer"']) assert.ok(p.includes(k), k);
  assert.ok(p.includes("Answer only the student's question. Never answer a different question from the package."));
});

test("worker: kind is normalised (answer fails closed; unknown is off_topic; clarify keeps only known ids)", async () => {
  const cases = [
    [{ kind: "answer", basis: "plan", answer: "Green.", cites: ["[objective:1]", "x"] }, { kind: "answer", answer: "Green.", cites: ["objective:1"], basis: "plan" }],
    [{ kind: "answer", inScope: false, answer: "Green.", cites: ["objective:1"] }, { kind: "off_topic", answer: "", cites: [], refusal: "off_topic" }],
    [{ kind: "clarify", answer: "words", cites: ["objective:2", "nope", "objective:2"] }, { kind: "clarify", answer: "", cites: ["objective:2"] }],
    [{ kind: "about_helper", answer: "I'm a robot", cites: ["objective:1"] }, { kind: "about_helper", answer: "", cites: [] }],
    [{ kind: "off_topic", answer: "Blue.", cites: ["objective:1"] }, { kind: "off_topic", answer: "", cites: [], refusal: "off_topic" }],
    [{ kind: "assessment" }, { kind: "assessment", answer: "", cites: [], refusal: "assessment" }],
    [{ kind: "answer", refusal: "assessment", answer: "You passed", cites: ["objective:1"] }, { kind: "assessment", answer: "", cites: [], refusal: "assessment" }],
    [{ kind: "weird", answer: "x", cites: ["objective:1"] }, { kind: "off_topic", answer: "", cites: [], refusal: "off_topic" }],
  ];
  for (const [reply, want] of cases) {
    const { worker } = await workerWith(reply);
    assert.deepEqual(await worker.answerStudent({ question: "q", items: ITEMS }), want, JSON.stringify(reply));
  }
  const { worker } = await workerWith({ kind: "answer", answer: "", cites: ["objective:1"] });
  await assert.rejects(worker.answerStudent({ question: "q", items: ITEMS }), { code: "WORKER_BAD_OUTPUT" });
});
