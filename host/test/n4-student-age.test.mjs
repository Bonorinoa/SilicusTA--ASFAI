/**
 * N4 (owner, 18 Nov) — the student helper by age.
 *
 *   - Under 18 (the course's youngest recorded age < 18, or no ages at all): a question the model answers from an
 *     attempt-first activity (aiStatus "forbidden", or a learner-first try before help) gets the host-composed
 *     `attempt_first` reply naming the activity by its title. No model words reach the student.
 *   - 18+: a question on the course's subject that the lesson does not cover may be answered as a general
 *     explanation (basis "explanation", general: true, no cites). An attempt-first activity gets help, led by one
 *     host-composed nudge line. Unrelated questions are still redirected.
 *   - Every age: the assessment refusal and its net win first; the cite check for under-18 answers is unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  packageOf, askStudent, ASSESSMENT, NOT_EVIDENCE, offTopicReply,
  ATTEMPT_FIRST, NUDGE, attemptFirstReply, isAttemptFirst, adultCourse,
} from "../student.mjs";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";

const plan = (ageRangeStart, ageRangeEnd) => ({
  version: 1,
  title: "Supply and demand",
  objectiveRefs: [{ statement: "Students can explain why a price rises when demand rises." }],
  lessonPlan: {
    audience: { ageRangeStart, ageRangeEnd },
    activities: [
      { title: "Read the chart", learnerDoes: "Read the chart.", teacherDoes: "Point to the axes.", minutes: 10, aiStatus: "permitted", noAiAlternative: "Use the textbook." },
      { title: "Predict the new price", learnerDoes: "Write a prediction.", teacherDoes: "Collect predictions.", minutes: 15, aiStatus: "forbidden" },
      { title: "Draft a claim", learnerDoes: "Draft a claim.", teacherDoes: "Wait.", minutes: 10, learnerFirst: "Each learner writes a first claim alone.", helpAfter: "peer" },
    ],
  },
});
const stub = (out) => ({ enabled: true, answerStudent: async (input) => { stub.last = input; return out; } });
const ask = (pkg, out, question = "help with this one") => askStudent({ pkg, worker: stub(out), body: { question } });

test("N4 1. attempt-first: forbidden AI or a learner-first try; mode from the course's recorded ages first", () => {
  const kid = packageOf(plan(12, 14));
  assert.deepEqual(kid.items.filter((i) => i.tryFirst).map((i) => i.id), ["activity:2", "activity:3"]);
  assert.equal(isAttemptFirst({ aiStatus: "permitted" }), false);
  assert.equal(isAttemptFirst({ aiStatus: "forbidden" }), true);
  assert.equal(isAttemptFirst({ learnerFirst: "  " }), false);
  assert.equal(isAttemptFirst({ learnerFirst: "A first try." }), true);
  assert.equal(adultCourse(kid), false);
  assert.equal(adultCourse(packageOf(plan(18, 40))), true);
  // The course's recorded ages win over the plan's audience; no ages at all is the under-18 mode (fail safe).
  assert.equal(adultCourse(packageOf(plan(18, 40), { ages: { min: 16, max: 40 } })), false);
  assert.equal(adultCourse(packageOf(plan(12, 14), { ages: { min: 19, max: 60 } })), true);
  assert.equal(adultCourse(packageOf({ version: 1, title: "t", objectiveRefs: [], lessonPlan: { activities: [] } })), false);
});

test("N4 2. under 18: an answer resting on an attempt-first activity becomes the host's attempt_first reply", async () => {
  const pkg = packageOf(plan(12, 14));
  for (const id of ["activity:2"]) {
    const r = await ask(pkg, { kind: "answer", basis: "explanation", answer: "The new price is 7 dollars because…", cites: [id, "objective:1"] });
    assert.deepEqual(r, {
      answer: "This one is for you to try first: Predict the new price. Ask me after you've had a go.",
      grounded: false, cites: [{ id: "activity:2", label: "Activity 2: Predict the new price" }], note: NOT_EVIDENCE,
      kind: "attempt_first", activity: { id: "activity:2", title: "Predict the new price" },
    }, id);
  }
  assert.equal(attemptFirstReply("Predict the new price"), `This one is for you to try first: Predict the new price. ${ATTEMPT_FIRST}`);
  const lf = await ask(pkg, { kind: "answer", basis: "plan", answer: "Write: demand up, price up.", cites: ["activity:3"] });
  assert.equal(lf.kind, "attempt_first");
  assert.ok(!lf.answer.includes("demand up"), "no model words reach the student");
  // An answer on a non-attempt-first item is unchanged.
  const ok = await ask(pkg, { kind: "answer", basis: "plan", answer: "Look at the axes.", cites: ["activity:1"] });
  assert.deepEqual([ok.kind, ok.grounded, ok.basis, ok.answer], ["answer", true, "plan", "Look at the axes."]);
});

test("N4 3. under 18: the cite check is unchanged; a 'general' basis without a lesson cite is the redirect", async () => {
  const pkg = packageOf(plan(12, 14));
  const r = await ask(pkg, { kind: "answer", basis: "general", answer: "Elasticity means…", cites: [] });
  assert.deepEqual([r.kind, r.refusal, r.grounded, r.answer], ["off_topic", "off_topic", false, offTopicReply(pkg)]);
  const cited = await ask(pkg, { kind: "answer", basis: "general", answer: "Demand is…", cites: ["objective:1"] });
  assert.deepEqual([cited.kind, cited.grounded, cited.basis, cited.general], ["answer", true, "explanation", undefined]);
  assert.equal(stub.last.adult, false);
});

test("N4 4. 18+: a general explanation on the course's subject, labelled, with no lesson cite", async () => {
  const pkg = packageOf(plan(18, 40));
  const r = await ask(pkg, { kind: "answer", basis: "general", answer: "Price elasticity measures how much quantity responds to price.", cites: [] }, "what is price elasticity?");
  assert.deepEqual(r, { answer: "Price elasticity measures how much quantity responds to price.", grounded: false, cites: [], note: NOT_EVIDENCE, kind: "answer", basis: "explanation", general: true });
  assert.equal(stub.last.adult, true);
  // Unrelated questions are still redirected, and an empty general answer is not an answer.
  const off = await ask(pkg, { kind: "off_topic", basis: null, answer: "", cites: [] }, "best pizza?");
  assert.equal(off.kind, "off_topic");
  const empty = await ask(pkg, { kind: "answer", basis: "general", answer: "  ", cites: [] });
  assert.equal(empty.kind, "off_topic");
});

test("N4 5. 18+: an attempt-first activity gets help, led by the host's nudge line", async () => {
  const pkg = packageOf(plan(18, 40));
  const r = await ask(pkg, { kind: "answer", basis: "plan", answer: "Start from what happens to demand.", cites: ["activity:2"] });
  assert.deepEqual(r, {
    answer: `${NUDGE} Start from what happens to demand.`, grounded: true,
    cites: [{ id: "activity:2", label: "Activity 2: Predict the new price" }], note: NOT_EVIDENCE, basis: "plan", kind: "answer", nudge: true,
  });
  assert.equal(NUDGE, "Worth trying this yourself first. Here's a nudge:");
});

test("N4 6. every age: the assessment refusal and its net win over every new path", async () => {
  for (const pkg of [packageOf(plan(12, 14)), packageOf(plan(18, 40))]) {
    const net = await ask(pkg, { kind: "answer", basis: "general", answer: "You'd get a B+.", cites: ["activity:2"] }, "what grade would I get?");
    assert.deepEqual([net.kind, net.answer, net.cites], ["assessment", ASSESSMENT, []]);
    const model = await ask(pkg, { kind: "assessment", basis: null, answer: "", cites: [] }, "next steps?");
    assert.equal(model.kind, "assessment");
  }
});

test("N4 7. the worker prompt: try-first items are marked; only an adult course may use basis general", async (t) => {
  const seen = [];
  const mock = await startMockWorker({ reply: ({ prompt }) => { seen.push(prompt); return { kind: "answer", basis: "general", answer: "General words.", cites: [] }; } });
  t.after(() => mock.close());
  const worker = new PlanWorker({ url: mock.url, model: "m" });
  const kid = packageOf(plan(12, 14));
  const out = await worker.answerStudent({ question: "q", title: kid.title, items: kid.items, ages: kid.ages, adult: false });
  assert.equal(out.basis, "general", "the worker keeps the basis; the host decides what it may mean");
  assert.match(seen[0], /^- \[activity:2\] Activity 2: Predict the new price \(try first\): /m);
  assert.doesNotMatch(seen[0], /basis "general"/);
  const adult = packageOf(plan(18, 40));
  await worker.answerStudent({ question: "q", title: adult.title, items: adult.items, ages: adult.ages, adult: true });
  assert.match(seen[1], /basis "general"/);
  assert.match(seen[1], /unrelated to the course's subject/);
});

test("N4 8. the route keys the mode on the course's RECORDED ages (G2a) and reads the sealed plan's design (aiStatus)", async (t) => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createApp } = await import("../server.mjs");
  const general = { kind: "answer", basis: "general", answer: "A general explanation.", cites: [] };
  const reply = ({ prompt }) => {
    if (/COURSE PACKAGE/.test(prompt)) return /Student: .*activity/.test(prompt) ? { kind: "answer", basis: "plan", answer: "Start with the first sentence.", cites: ["activity:1"] } : general;
    const ids = [...String(prompt).matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
    return { title: "Steps", audience: { ageRangeStart: 8, ageRangeEnd: 10 },
      activities: ids.map((id, i) => ({ title: `Spot the claim ${i + 1}`, minutes: 15, objectiveIds: [id], learnerDoes: "Mark the claim.", teacherDoes: "Ask why.", evidenceIfAny: "observation", aiStatus: "forbidden" })) };
  };
  const wm = await startMockWorker({ reply });
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "silicus-n4-")), worker: new PlanWorker({ url: wm.url, model: "m" }), sources: [] });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  t.after(() => { app.closeAllConnections?.(); app.close(); wm.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
  const publish = async (ages) => {
    const { json: { courseId } } = await post("/api/courses", { owner: "teacher:n4", title: "Claims", ...(ages ? { ages } : {}) });
    const c = `/api/courses/${courseId}`;
    await post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
    await post(`${c}/intake/answer`, { text: "all", answers: { topic: "t", course: "c", learning_outcomes: "Students can explain what a claim is." } });
    await post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
    const { json: { proposals } } = await post(`${c}/objectives`, {});
    await post(`${c}/decisions`, { decisions: [{ verb: "accept", proposalId: proposals[0].id }], text: "Decide." });
    await post(`${c}/plan`, {});
    await post(`${c}/plan/confirm`, { text: "Confirm this lesson plan." });
    const pub = await post(`${c}/publish`, { text: "Publish the course package." });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    return c;
  };
  const ac = await publish({ min: 19, max: 40 });
  const adult = await post(`${ac}/student/ask`, { question: "What is a warrant?" });
  assert.deepEqual([adult.status, adult.json.kind, adult.json.basis, adult.json.general, adult.json.grounded], [200, "answer", "explanation", true, false]);
  const nudge = await post(`${ac}/student/ask`, { question: "help with the activity" });
  assert.deepEqual([nudge.json.kind, nudge.json.nudge, nudge.json.answer], ["answer", true, `${NUDGE} Start with the first sentence.`]);
  const kc = await publish({ min: 12, max: 14 });
  const kid = await post(`${kc}/student/ask`, { question: "What is a warrant?" });
  assert.deepEqual([kid.status, kid.json.kind, kid.json.general], [200, "off_topic", undefined]);
  const tryFirst = await post(`${kc}/student/ask`, { question: "help with the activity" });
  assert.deepEqual([tryFirst.json.kind, tryFirst.json.answer], ["attempt_first", "This one is for you to try first: Spot the claim 1. Ask me after you've had a go."]);
  const lc = await publish(null);
  const legacy = await post(`${lc}/student/ask`, { question: "What is a warrant?" });
  assert.equal(legacy.json.kind, "off_topic", "no recorded ages and an 8-10 audience: the under-18 mode");
  const legacyAct = await post(`${lc}/student/ask`, { question: "help with the activity" });
  assert.equal(legacyAct.json.kind, "answer", "no structured ages: the host drops aiStatus, so nothing is attempt-first");
});
