/**
 * plan-schema-v2.test.mjs — the learning-design fields (P2): every new field optional
 * (a v1 plan passes unchanged), every value validated, unknown values dropped with a
 * note, learner AI use the stage does not allow clamped with a note, and no aiStatus
 * or aiPolicy on a course with no structured ages. The stage is computed by the host
 * from ages.min, never by the model.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PlanWorker } from "../worker.mjs";
import { planDesignOf } from "../worker.mjs";
import { anchorPrerequisites } from "../knowledge.mjs";
import { startMockWorker } from "./mock-worker.mjs";

const MOCKS = [];
after(() => MOCKS.forEach((m) => m.close()));

const OBJECTIVES = [
  { id: "urn:uuid:aaa", statement: "Students can explain what an algorithm is." },
  { id: "urn:uuid:bbb", statement: "Learners can find the claim in an AI answer." },
];

const V1_PLAN = {
  title: "T",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    { title: "A", minutes: 20, objectiveIds: ["urn:uuid:aaa"], learnerDoes: "x", teacherDoes: "y", evidenceIfAny: "observation" },
  ],
};

const V2_PLAN = {
  title: "Seeing the claim",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  sessions: [
    { session: 1, evidence: { kind: "work-product", whatLearnerProduces: "The learner's marked transcript with one reason." } },
  ],
  spacedReviews: [
    { afterDays: 7, form: "near-transfer", whatChanges: "a new AI answer on a different topic", prompt: "Mark the claim in it." },
  ],
  aiPolicy: "AI in this course: teacher-led and projected to the whole class, only after children state their own view first; no child uses AI alone.",
  activities: [
    {
      title: "What do we think it is?", minutes: 10, objectiveIds: ["urn:uuid:aaa"],
      learnerDoes: "Say which picture uses AI and why.", teacherDoes: "Ask what they think first.", evidenceIfAny: "observation",
      phase: 1, supportingPhase: 2, targetOperation: "distinguish an AI use from a non-AI one",
      operationDoneBy: "learner", learnerFirst: "Each pair gives a guess and its reason.", helpAfter: "teacher",
      aiStatus: "forbidden", noAiAlternative: "The same two pictures on paper, no screen at all.",
      decisionAfterHelp: "Each pair keeps or changes the guess and says why.",
      channels: ["speaking", "handling"], session: 1,
    },
  ],
};

async function workerWith(reply, opts = {}) {
  const mock = await startMockWorker({ reply, ...opts });
  MOCKS.push(mock);
  return { mock, worker: new PlanWorker({ url: mock.url, model: "test-model" }) };
}
const draft = async (plan, extra = {}) => (await workerWith(plan)).worker.draft({ objectives: OBJECTIVES, ...extra });

test("a v1 plan passes unchanged: no v2 key appears and no notes key is invented", async () => {
  const spec = await draft(V1_PLAN, { ages: { min: 8, max: 10 } });
  assert.deepEqual(spec, V1_PLAN, "a v1 plan is byte-identical (keys, not just values)");
  const legacy = await draft(V1_PLAN, {});
  assert.deepEqual(legacy, V1_PLAN, "the same holds on a legacy course");
});

test("every schema-v2 field round-trips on a valid plan", async () => {
  const spec = await draft(V2_PLAN, { ages: { min: 8, max: 10 } });
  const a = spec.activities[0];
  assert.equal(a.phase, 1);
  assert.equal(a.supportingPhase, 2);
  assert.equal(a.targetOperation, "distinguish an AI use from a non-AI one");
  assert.equal(a.operationDoneBy, "learner");
  assert.equal(a.learnerFirst, "Each pair gives a guess and its reason.");
  assert.equal(a.helpAfter, "teacher");
  assert.equal(a.aiStatus, "forbidden");
  assert.equal(a.noAiAlternative, "The same two pictures on paper, no screen at all.");
  assert.equal(a.decisionAfterHelp, "Each pair keeps or changes the guess and says why.");
  assert.deepEqual(a.channels, ["speaking", "handling"]);
  assert.equal(a.session, 1);
  assert.deepEqual(spec.sessions, V2_PLAN.sessions);
  assert.deepEqual(spec.spacedReviews, V2_PLAN.spacedReviews);
  assert.equal(spec.aiPolicy, V2_PLAN.aiPolicy);
});

test("unknown values are dropped with a note the teacher can see", async () => {
  const plan = {
    ...V2_PLAN,
    aiPolicy: "learners may use AI freely", // contradicts stage 2 -> replaced
    activities: [{ ...V2_PLAN.activities[0],
      phase: 5, supportingPhase: 0, operationDoneBy: "the class", helpAfter: "the internet",
      aiStatus: "sometimes", channels: ["visual", "speaking", "listening"], session: 1.5,
    }],
  };
  const spec = await draft(plan, { ages: { min: 8, max: 10 } });
  const a = spec.activities[0];
  assert.equal("phase" in a, false);
  assert.equal("supportingPhase" in a, false);
  assert.equal("operationDoneBy" in a, false);
  assert.equal("helpAfter" in a, false);
  assert.equal("aiStatus" in a, false, "an unknown status is dropped, not guessed");
  assert.deepEqual(a.channels, ["speaking"]); // visual/listening are labels or non-channels
  assert.equal("session" in a, false);
  assert.equal(spec.aiPolicy, "AI in this course: teacher-led and projected to the whole class, only after children state their own view first; no child uses AI alone.", "the stage rule replaces a contradicting line");
  assert.ok(spec.notes.some((n) => n.startsWith('dropped aiStatus "sometimes"')));
  assert.ok(spec.notes.some((n) => n.startsWith("dropped phase:")));
  assert.ok(spec.notes.some((n) => n.startsWith('dropped channel "visual"')));
  assert.ok(spec.notes.some((n) => n.startsWith("replaced aiPolicy")));
});

test("stage 1 clamps every non-forbidden aiStatus to forbidden, with a note", async () => {
  const plan = {
    ...V2_PLAN,
    aiPolicy: "children may use AI with the teacher",
    activities: [
      { ...V2_PLAN.activities[0], aiStatus: "permitted" },
      { ...V2_PLAN.activities[0], title: "B", objectiveIds: ["urn:uuid:bbb"], aiStatus: "required" },
    ],
  };
  const spec = await draft(plan, { ages: { min: 4, max: 7 } });
  assert.equal(spec.activities[0].aiStatus, "forbidden");
  assert.equal(spec.activities[1].aiStatus, "forbidden");
  assert.ok(spec.notes.some((n) => n.startsWith('aiStatus "permitted" clamped to "forbidden"')));
  assert.ok(spec.notes.some((n) => n.startsWith('aiStatus "required" clamped to "forbidden"')));
  assert.ok(spec.notes.some((n) => n.startsWith("replaced aiPolicy")), "a contradictory stage-1 line is replaced");
});

test("stage 2 clamps required to permitted, with a note; stage 3 never leaves required; stage 4 keeps required", async () => {
  const required = { ...V2_PLAN, activities: V2_PLAN.activities.map((a) => ({ ...a, aiStatus: "required", learnerFirst: "a first try", noAiAlternative: "paper cards" })) };
  const s2 = await draft(required, { ages: { min: 8, max: 11 } });
  assert.equal(s2.activities[0].aiStatus, "permitted", "teacher-led projected use is the stage-2 ceiling");
  assert.ok(s2.notes.some((n) => n.startsWith('aiStatus "required" clamped to "permitted"') && /teacher-led/.test(n)));

  const s3 = await draft(required, { ages: { min: 12, max: 14 } });
  assert.equal(s3.activities[0].aiStatus, "permitted", "never required below stage 4");
  assert.ok(s3.notes.some((n) => n.startsWith('aiStatus "required" clamped to "permitted"') && /first try/.test(n)));

  const s4 = await draft(required, { ages: { min: 15, max: 17 } });
  assert.equal(s4.activities[0].aiStatus, "required");
  assert.equal(s4.notes.some((n) => n.startsWith("aiStatus")), false, "stage 4 clamps nothing");
});

test("stage 3: a permitted use must follow a first try the teacher has seen", async () => {
  const plan = { ...V2_PLAN, activities: V2_PLAN.activities.map(({ learnerFirst, ...rest }) => ({ ...rest, aiStatus: "permitted", noAiAlternative: "paper cards" })) };
  const spec = await draft(plan, { ages: { min: 12, max: 14 } });
  assert.ok(spec.notes.some((n) => /first try the teacher has seen/.test(n)));
});

test("a permitted or required use without a noAiAlternative is noted", async () => {
  const plan = { ...V2_PLAN, activities: V2_PLAN.activities.map(({ noAiAlternative, ...rest }) => ({ ...rest, aiStatus: "permitted" })) };
  const spec = await draft(plan, { ages: { min: 15, max: 17 } });
  assert.ok(spec.notes.some((n) => n.includes("needs a noAiAlternative")));
});

test("a course with no structured ages gets no aiStatus or aiPolicy claims, and says so in a note", async () => {
  const spec = await draft(V2_PLAN, {}); // no ages -> legacy course
  assert.equal("aiStatus" in spec.activities[0], false);
  assert.equal("aiPolicy" in spec, false);
  assert.ok(spec.notes.some((n) => n === "dropped aiStatus: this course has no structured ages."));
  assert.ok(spec.notes.some((n) => n === "dropped aiPolicy: this course has no structured ages."));
  // the rest of the design still carries
  assert.equal(spec.activities[0].phase, 1);
  assert.ok(Array.isArray(spec.sessions));
});

test("stages 3 and 4 never carry a plan-level aiPolicy line", async () => {
  const s3 = await draft(V2_PLAN, { ages: { min: 12, max: 14 } });
  assert.equal("aiPolicy" in s3, false);
  assert.ok(s3.notes.some((n) => n.includes("only stages 1 and 2")));
});

test("a v1 plan on an aged course is NOT widened with a host aiPolicy (absent stays absent)", async () => {
  const spec = await draft(V1_PLAN, { ages: { min: 8, max: 10 } });
  assert.equal("aiPolicy" in spec, false);
});

test("sessions: invalid entries are dropped with a note, chat is never a kind, duplicates are noted, order is sorted", async () => {
  const plan = {
    ...V2_PLAN,
    sessions: [
      { session: "one", evidence: { kind: "observation", whatLearnerProduces: "x" } },
      { session: 4, evidence: { kind: "chat", whatLearnerProduces: "the transcript" } },
      { session: 2, evidence: { kind: "work-product", whatLearnerProduces: "y" } },
      { session: 1, evidence: { kind: "observation", whatLearnerProduces: "z" } },
      { session: 2, evidence: { kind: "observation", whatLearnerProduces: "y2" } },
      { session: 3, evidence: { whatLearnerProduces: "w" } },
    ],
  };
  const spec = await draft(plan, { ages: { min: 8, max: 10 } });
  assert.deepEqual(spec.sessions.map((s) => s.session), [1, 2, 2], "only whole numbered sessions with a real kind survive, sorted; duplicates stay and are flagged");
  assert.ok(spec.notes.some((n) => n.includes("chat is never evidence")));
  assert.ok(spec.notes.some((n) => n.startsWith("more than one evidence entry names session 2")));
});

test("spacedReviews: bad entries are dropped, the rest are sorted by afterDays", async () => {
  const plan = {
    ...V2_PLAN,
    spacedReviews: [
      { afterDays: -1, form: "near-transfer", whatChanges: "x", prompt: "y" },
      { afterDays: "soon", form: "near-transfer", whatChanges: "x", prompt: "y" },
      { afterDays: 7, form: "worksheet", whatChanges: "x", prompt: "y" },
      { afterDays: 30, form: "recall-without-support", whatChanges: "no cards", prompt: "Recite it." },
      { afterDays: 2, form: "near-transfer", whatChanges: "a shop picture", prompt: "Spot the AI." },
    ],
  };
  const spec = await draft(plan, { ages: { min: 8, max: 10 } });
  assert.deepEqual(spec.spacedReviews.map((r) => r.afterDays), [2, 30]);
  assert.ok(spec.notes.some((n) => n.includes("afterDays must be a whole number")));
  assert.ok(spec.notes.some((n) => n.includes('dropped a spaced review: whatChanges and prompt')) || spec.notes.some((n) => n.startsWith('dropped review form "worksheet"')));
});

test("planDesignOf extracts only the schema-v2 slice, and null when there is none", () => {
  const design = planDesignOf(V2_PLAN);
  assert.deepEqual(Object.keys(design).sort(), ["activities", "aiPolicy", "sessions", "spacedReviews"]);
  assert.deepEqual(Object.keys(design.activities[0]).sort(),
    ["aiStatus", "channels", "decisionAfterHelp", "helpAfter", "learnerFirst", "noAiAlternative", "operationDoneBy", "phase", "session", "supportingPhase", "targetOperation"]);
  assert.equal(planDesignOf(V1_PLAN), null, "a v1 plan has no design slice");
  assert.equal(planDesignOf(null), null);
});

test("anchorPrerequisites asks sources only when there is an anchor, and degrades safely", async () => {
  const rows = [{ id: "mt_x", name: "X", evidence: ["e1"] }];
  const withMethod = { anchorPrerequisites: async () => rows, id: "marble" };
  assert.deepEqual(await anchorPrerequisites([withMethod], "mt_anchor"), rows);
  assert.deepEqual(await anchorPrerequisites([withMethod], null), [], "no anchor, no call");
  assert.deepEqual(await anchorPrerequisites([{ id: "plain" }], "mt_anchor"), [], "a source without the capability is skipped");
  assert.deepEqual(await anchorPrerequisites([{ anchorPrerequisites: async () => { throw new Error("down"); } }], "mt_anchor"), [], "a failing source degrades");
  assert.deepEqual(await anchorPrerequisites([withMethod], "mt_anchor"), rows, "first source with rows wins");
});

/* ---- Prompt snapshots (P2): the pinned base prompt, and the anchored prompt that alone names the prereq ---- */

const BASE_PROMPT = "Draft one lesson plan for a teacher, using ONLY the objectives below.\nCite each activity's objectiveIds exactly as given. Do not invent objectives.\nAnswer with JSON only, no prose, in this shape:\n{\"title\": string, \"audience\": {\"ageRangeStart\": number, \"ageRangeEnd\": number},\n \"sessions\": [{\"session\": number, \"evidence\": {\"kind\": \"none\"|\"observation\"|\"work-product\", \"whatLearnerProduces\": string}}],\n \"spacedReviews\": [{\"afterDays\": number, \"form\": \"recall-without-support\"|\"near-transfer\"|\"far-transfer\"|\"explain-to-absent\", \"whatChanges\": string, \"prompt\": string}],\n \"aiPolicy\": string,\n \"activities\": [{\"title\": string, \"minutes\": number, \"objectiveIds\": [string],\n  \"learnerDoes\": string, \"teacherDoes\": string, \"evidenceIfAny\": \"none\"|\"observation\"|\"work-product\",\n  \"phase\": 1|2|3|4, \"supportingPhase\": 1|2|3|4, \"targetOperation\": string,\n  \"operationDoneBy\": \"learner\"|\"peer\"|\"teacher\"|\"ai\",\n  \"learnerFirst\": string, \"helpAfter\": \"none\"|\"peer\"|\"teacher\"|\"textbook\"|\"worked-example\"|\"ai\",\n  \"aiStatus\": \"forbidden\"|\"permitted\"|\"required\", \"noAiAlternative\": string,\n  \"decisionAfterHelp\": string, \"channels\": [\"speaking\"|\"drawing\"|\"writing\"|\"handling\"|\"discussion\"|\"diagram\"|\"enactment\"], \"session\": number}]}\nevidenceIfAny must be one of: none, observation, work-product.\nStudent chat is never evidence of learning.\n\nLearning design notes (every field is optional; give each one you can):\n- Who does the thinking: name the operation the objective is about (targetOperation) and who does it here (operationDoneBy: learner, peer, teacher or ai). The learner should do the thinking the objective is about.\n- First try before help: before any help (helpAfter: peer, teacher, textbook, worked-example or ai) the learner makes a first try (learnerFirst): a prediction, bet, draft or first attempt. A first try is never written by the AI or the teacher.\n- A decision after help: once help arrives the learner decides (decisionAfterHelp): keeps, changes or rejects what they had, and says why. Help does not end the task.\n- All four phases across the plan: 1 notice and guess (learners state a belief, bet or prior view, or react to a surprising item, before any explanation), 2 try and fix (attempt, err and correct, or compare with a variant), 3 check and steer (explain their own approach, pick a standard to judge by, decide what to keep or change), 4 keep and reuse (recall without support, use the idea in a new setting). Mark the main phase (phase) and optionally a second one (supportingPhase).\n- One planned piece of evidence per sitting: sessions names each sitting (session) and the ONE thing the learner says or makes there (evidence.whatLearnerProduces), fixed before the sitting. Chat is never evidence.\n- A later review or transfer: at least one spacedReviews entry with a time offset (afterDays), a learner action without support (form), what differs from the lesson (whatChanges: context, format or example) and the task (prompt).\n- Several channels and no style labels: vary how learners meet or show the idea (channels: speaking, drawing, writing, handling, discussion, diagram, enactment). Never label learners by a fixed style (no \"visual\", \"auditory\" or \"kinaesthetic learner\").\n- AI status is told before the task (aiStatus: forbidden, permitted or required). A permitted or required use has a noAiAlternative, and the learner's target operation stays with the learner.\n\nTopic: how AI answers are built\nMaterials: slides.pdf\nObjectives:\n- urn:uuid:aaa: Students can explain what an algorithm is.\n- urn:uuid:bbb: Learners can find the claim in an AI answer.";

const ANCHORED_PROMPT = "Draft one lesson plan for a teacher, using ONLY the objectives below.\nCite each activity's objectiveIds exactly as given. Do not invent objectives.\nAnswer with JSON only, no prose, in this shape:\n{\"title\": string, \"audience\": {\"ageRangeStart\": number, \"ageRangeEnd\": number},\n \"sessions\": [{\"session\": number, \"evidence\": {\"kind\": \"none\"|\"observation\"|\"work-product\", \"whatLearnerProduces\": string}}],\n \"spacedReviews\": [{\"afterDays\": number, \"form\": \"recall-without-support\"|\"near-transfer\"|\"far-transfer\"|\"explain-to-absent\", \"whatChanges\": string, \"prompt\": string}],\n \"aiPolicy\": string,\n \"activities\": [{\"title\": string, \"minutes\": number, \"objectiveIds\": [string],\n  \"learnerDoes\": string, \"teacherDoes\": string, \"evidenceIfAny\": \"none\"|\"observation\"|\"work-product\",\n  \"phase\": 1|2|3|4, \"supportingPhase\": 1|2|3|4, \"targetOperation\": string,\n  \"operationDoneBy\": \"learner\"|\"peer\"|\"teacher\"|\"ai\",\n  \"learnerFirst\": string, \"helpAfter\": \"none\"|\"peer\"|\"teacher\"|\"textbook\"|\"worked-example\"|\"ai\",\n  \"aiStatus\": \"forbidden\"|\"permitted\"|\"required\", \"noAiAlternative\": string,\n  \"decisionAfterHelp\": string, \"channels\": [\"speaking\"|\"drawing\"|\"writing\"|\"handling\"|\"discussion\"|\"diagram\"|\"enactment\"], \"session\": number}]}\nevidenceIfAny must be one of: none, observation, work-product.\nStudent chat is never evidence of learning.\n\nLearning design notes (every field is optional; give each one you can):\n- Who does the thinking: name the operation the objective is about (targetOperation) and who does it here (operationDoneBy: learner, peer, teacher or ai). The learner should do the thinking the objective is about.\n- First try before help: before any help (helpAfter: peer, teacher, textbook, worked-example or ai) the learner makes a first try (learnerFirst): a prediction, bet, draft or first attempt. A first try is never written by the AI or the teacher.\n- A decision after help: once help arrives the learner decides (decisionAfterHelp): keeps, changes or rejects what they had, and says why. Help does not end the task.\n- All four phases across the plan: 1 notice and guess (learners state a belief, bet or prior view, or react to a surprising item, before any explanation), 2 try and fix (attempt, err and correct, or compare with a variant), 3 check and steer (explain their own approach, pick a standard to judge by, decide what to keep or change), 4 keep and reuse (recall without support, use the idea in a new setting). Mark the main phase (phase) and optionally a second one (supportingPhase).\n- One planned piece of evidence per sitting: sessions names each sitting (session) and the ONE thing the learner says or makes there (evidence.whatLearnerProduces), fixed before the sitting. Chat is never evidence.\n- A later review or transfer: at least one spacedReviews entry with a time offset (afterDays), a learner action without support (form), what differs from the lesson (whatChanges: context, format or example) and the task (prompt).\n- Several channels and no style labels: vary how learners meet or show the idea (channels: speaking, drawing, writing, handling, discussion, diagram, enactment). Never label learners by a fixed style (no \"visual\", \"auditory\" or \"kinaesthetic learner\").\n- AI status is told before the task (aiStatus: forbidden, permitted or required). A permitted or required use has a noAiAlternative, and the learner's target operation stays with the learner.\n\nTopic: how AI answers are built\nMaterials: slides.pdf\nObjectives:\n- urn:uuid:aaa: Students can explain what an algorithm is.\n- urn:uuid:bbb: Learners can find the claim in an AI answer.\n\nAudience AI rule (the youngest age sets the stage), stage 2 (8-11): AI may be used only teacher-led and projected to the whole class, after the children have stated their own view first. No one child uses AI alone, and AI is never required. Give one plan-level aiPolicy line that states this.\n\nThe course is anchored to a skill-map topic. Its hard prerequisites are material for the OPENING activity: learners recall or bet on the prerequisite before anything else, and the activity says so.\nHard prerequisites:\n- mt_WRRv1ABECC: Following Steps (ages 8–10) — evidence: Follow and explain a short sequence of instructions.\nAlso include one spaced review that revisits this lesson's idea in a new context.";

test("prompt snapshot without an anchor: the pinned base prompt, no stage rule, no prereq id", async () => {
  const { mock, worker } = await workerWith(V1_PLAN);
  await worker.draft({ objectives: OBJECTIVES, topic: "how AI answers are built", materials: ["slides.pdf"] });
  assert.equal(mock.st.lastPrompt, BASE_PROMPT);
  assert.ok(!mock.st.lastPrompt.includes("mt_WRRv1ABECC"));
});

test("prompt snapshot with an anchor: the stage rule and the hard prerequisite id are in, and only the anchored prompt names the prerequisite", async () => {
  const { mock, worker } = await workerWith(V1_PLAN);
  await worker.draft({
    objectives: OBJECTIVES, topic: "how AI answers are built", materials: ["slides.pdf"],
    ages: { min: 8, max: 10 },
    anchorPrereqs: [{ id: "mt_WRRv1ABECC", name: "Following Steps (ages 8–10)", evidence: ["Follow and explain a short sequence of instructions."] }],
  });
  assert.equal(mock.st.lastPrompt, ANCHORED_PROMPT);
  assert.ok(ANCHORED_PROMPT.includes("mt_WRRv1ABECC"), "the pinned anchored prompt carries the prereq id");
  assert.ok(!BASE_PROMPT.includes("mt_WRRv1ABECC"), "the pinned base prompt does not");
});
