/**
 * worker.test.mjs — the worker seam: off by default, and its output treated as
 * UNTRUSTED INPUT.
 *
 * The claim these tests defend: a model can propose a plan, and can never widen
 * what the product accepts. Every rule the gate enforces on a plan is enforced
 * here first, so a bad model answer is a refusal and not a broken course.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PlanWorker, WorkerError } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";

const MOCKS = [];
after(() => MOCKS.forEach((m) => m.close()));

const OBJECTIVES = [
  { id: "urn:uuid:aaa", statement: "Students can explain what an algorithm is." },
  { id: "urn:uuid:bbb", statement: "Learners can find the claim in an AI answer." },
];

const goodPlan = () => ({
  title: "Seeing the claim",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    { title: "Spot the claim", minutes: 20, objectiveIds: ["urn:uuid:bbb"],
      learnerDoes: "Mark the sentence that makes a claim.", teacherDoes: "Ask what would back it up.", evidenceIfAny: "observation" },
  ],
});

async function workerWith(reply, opts = {}) {
  const mock = await startMockWorker({ reply, ...opts });
  MOCKS.push(mock);
  return { mock, worker: new PlanWorker({ url: mock.url, model: "test-model", ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) }) };
}

test("no worker configured is a state, not a crash", async () => {
  const w = new PlanWorker({});
  assert.equal(w.enabled, false);
  await assert.rejects(w.draft({ objectives: OBJECTIVES }), { code: "WORKER_NOT_CONFIGURED" });
  // a url with no model is still not configured
  assert.equal(new PlanWorker({ url: "https://example.test/v1" }).enabled, false);
});

test("a worker with no objectives to draft from refuses", async () => {
  const w = new PlanWorker({ url: "https://example.test/v1", model: "m" });
  await assert.rejects(w.draft({ objectives: [] }), { code: "NO_CONFIRMED_OBJECTIVES" });
});

test("the worker drafts from the teacher's confirmed wording, and cites only the ids it was given", async () => {
  const { mock, worker } = await workerWith(goodPlan());
  const spec = await worker.draft({ objectives: OBJECTIVES, topic: "how AI answers are built", materials: ["slides.pdf"] });

  assert.equal(spec.title, "Seeing the claim");
  assert.equal(spec.activities.length, 1);
  assert.deepEqual(spec.activities[0].objectiveIds, ["urn:uuid:bbb"]);
  assert.equal(spec.activities[0].evidenceIfAny, "observation");
  // the prompt carried the teacher's own words, not a paraphrase
  assert.ok(mock.st.lastPrompt.includes("Students can explain what an algorithm is."));
  assert.ok(mock.st.lastPrompt.includes("urn:uuid:bbb"));
  assert.ok(mock.st.lastPrompt.includes("how AI answers are built"));
});

test("a worker that returns junk produces a refusal, never a broken plan", async () => {
  const { worker } = await workerWith("not json at all");
  await assert.rejects(worker.draft({ objectives: OBJECTIVES }), { code: "WORKER_BAD_OUTPUT" });
});

test("a worker that cites an objective we did not send is refused", async () => {
  const plan = goodPlan();
  plan.activities[0].objectiveIds = ["urn:uuid:ghost"];
  const { worker } = await workerWith(plan);
  await assert.rejects(worker.draft({ objectives: OBJECTIVES }), { code: "WORKER_BAD_OUTPUT" });
});

test("a worker cannot smuggle student chat in as evidence", async () => {
  const plan = goodPlan();
  plan.activities[0].evidenceIfAny = "student-chat";
  const { worker } = await workerWith(plan);
  await assert.rejects(worker.draft({ objectives: OBJECTIVES }), { code: "WORKER_BAD_OUTPUT" });
});

test("a worker that says nothing the learner or teacher does is refused", async () => {
  for (const field of ["learnerDoes", "teacherDoes"]) {
    const plan = goodPlan();
    plan.activities[0][field] = "   ";
    const { worker } = await workerWith(plan);
    await assert.rejects(worker.draft({ objectives: OBJECTIVES }), { code: "WORKER_BAD_OUTPUT" }, field);
  }
});

test("a plan with no activities, or an activity citing nothing, is refused", async () => {
  const { worker: w1 } = await workerWith({ title: "T", activities: [] });
  await assert.rejects(w1.draft({ objectives: OBJECTIVES }), { code: "WORKER_BAD_OUTPUT" });

  const plan = goodPlan();
  plan.activities[0].objectiveIds = [];
  const { worker: w2 } = await workerWith(plan);
  await assert.rejects(w2.draft({ objectives: OBJECTIVES }), { code: "WORKER_BAD_OUTPUT" });
});

test("a markdown-fenced JSON answer is accepted, then validated like anything else", async () => {
  const { worker } = await workerWith("```json\n" + JSON.stringify(goodPlan()) + "\n```");
  const spec = await worker.draft({ objectives: OBJECTIVES });
  assert.equal(spec.title, "Seeing the claim");
});

test("a non-loopback http worker is refused: the host is otherwise loopback-only", () => {
  assert.throws(() => new PlanWorker({ url: "http://evil.example/v1", model: "m" }), { code: "WORKER_BAD_URL" });
  assert.throws(() => new PlanWorker({ url: "ftp://evil.example/v1", model: "m" }), { code: "WORKER_BAD_URL" });
  assert.throws(() => new PlanWorker({ url: "not a url", model: "m" }), { code: "WORKER_BAD_URL" });
  // https anywhere is fine, and loopback http is fine (the test stub)
  assert.equal(new PlanWorker({ url: "https://api.example/v1", model: "m" }).enabled, true);
  assert.equal(new PlanWorker({ url: "http://127.0.0.1:9/v1", model: "m" }).enabled, true);
});

test("an unreachable worker is a refusal with a code, not a crash", async () => {
  const w = new PlanWorker({ url: "http://127.0.0.1:1/v1", model: "m" });
  await assert.rejects(w.draft({ objectives: OBJECTIVES }), { code: "WORKER_UNREACHABLE" });
});

test("an error status from the worker is a refusal", async () => {
  const { worker } = await workerWith(goodPlan(), { status: 500 });
  await assert.rejects(worker.draft({ objectives: OBJECTIVES }), { code: "WORKER_UNREACHABLE" });
});

test("the credential rides in a header, never in the URL", async () => {
  const { mock, worker } = await workerWith(goodPlan(), { apiKey: "sk-test-secret" });
  await worker.draft({ objectives: OBJECTIVES });
  assert.equal(mock.st.lastAuth, "Bearer sk-test-secret");
  assert.equal(mock.st.lastPrompt.includes("sk-test-secret"), false);
});
