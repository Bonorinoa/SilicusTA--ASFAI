/**
 * scripted-course.mjs — ONE teacher story, scripted against the API, for proving the two hosts agree.
 *
 * `runScriptedCourse(call)` drives a whole course through `call(method, path, body) -> {status, json}`:
 * name it, confirm the material list, answer the host's own questions (outcomes from material), confirm the
 * outline, propose from a pasted material, decide (accept / rename / drop / add, with forged provenance keys a
 * host must cut away), draft and confirm a plan, publish, pin, ask as a student, and read everything back.
 * The Node host (disk log, real node:crypto) and the browser host (IndexedDB, the shared SHA-256) each run it;
 * the parity tests compare the transcripts and the logs byte for byte.
 *
 * `chatCompletion(prompt)` is the deterministic stand-in "model": it speaks the OpenAI chat-completions wire
 * (what PlanWorker sends and what the site's /api/worker returns), so the real worker client runs.
 */

/** The teacher's pasted material. Its distinctive phrase must never reach any storage. */
export const MATERIAL_SECRET = "TANGERINE-OCELOT-5521";
export const MATERIAL = {
  name: "Lesson notes",
  text: `Plants make their own food.\nThe phrase ${MATERIAL_SECRET} appears only in the teacher's notes.\nLight, water and air become sugar.`,
};

/** What the stand-in model answers to each of the three prompts the worker sends. */
export function modelReply(prompt) {
  const p = String(prompt ?? "");
  if (p.startsWith("Propose learning objectives")) {
    const names = [...p.matchAll(/^=== MATERIAL: (.+) ===$/gm)].map((m) => m[1]);
    return { objectives: [
      { statement: "Students can explain how a plant makes its food.", from: [names[0]] },
      { statement: "Students can name what a plant needs to make sugar.", from: names },
      { statement: "Students can draw a leaf.", from: [names[0]] },
    ] };
  }
  if (p.startsWith("Draft one lesson plan")) {
    const ids = [...p.matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
    const refs = [...p.matchAll(/^- \[([a-z]+:[^\]]+)\]/gm)].map((m) => m[1]);   // reference material, if any was retrieved
    // K2: the v1 activities share 45 minutes (the wizard's default lesson), so a 45-minute course gets no length note.
    const share45 = (i) => Math.floor(45 / ids.length) + (i < 45 % ids.length ? 1 : 0);
    return { title: "How plants eat", audience: { ageRangeStart: 8, ageRangeEnd: 10 },
      activities: ids.map((id, i) => ({ title: `Activity ${i + 1}`, minutes: share45(i), objectiveIds: [id], learnerDoes: "Look at a leaf.", teacherDoes: "Ask what it needs.", evidenceIfAny: "observation",
        ...(refs[i] ? { citations: [refs[i]] } : {}) })) };
  }
  if (p.startsWith("RANK skill-map topics")) return scriptedRankMap(p);
  if (p.startsWith("You are a study helper")) {
    return { inScope: true, answer: "A plant uses light, water and air to make sugar.", cites: ["[objective:1]", "activity:1"] };
  }
  return { error: "unexpected prompt" };
}

/**
 * M1 · SCRIPTED ranking for "Why is the grass green?", ages 4–10: the real snapshot ids the D1 sketch uses. The
 * ranks, thread names and "why" lines are scripted, not a model's, and every "why" says so. Only ids that the
 * prompt actually listed are returned, so a course at other ages gets fewer (or none).
 */
export const SCRIPTED_RANKING = [
  { id: "mt_gLy3ZgZWiN", thread: "Light", why: "[scripted] Colour is light we see: reflection is the core idea." },
  { id: "mt_lutxvMlkwS", thread: "Plants", why: "[scripted] Staying green and healthy is about what plants need." },
  { id: "mt_4i-FKXDDXh", thread: "Light", why: "[scripted] Comes right before Reflecting Light; a warm-up for the younger ones." },
  { id: "mt_3v0VNkwquK", thread: "Plants", why: "[scripted] The younger version of what plants need." },
  { id: "mt_6xsEXxKdUX", thread: "Plants", why: "[scripted] Leaves make food: a bridge to why they are green." },
  { id: "mt_nwSWPTENmv", thread: "Light", why: "[scripted] Seeing is a sense: eyes detect light." },
];
export function scriptedRankMap(prompt) {
  const listed = new Set([...String(prompt).matchAll(/^(mt_[A-Za-z0-9_-]+):/gm)].map((m) => m[1]));
  return { suggestions: SCRIPTED_RANKING.filter((s) => listed.has(s.id)) };
}

/** The chat-completions body for a request body PlanWorker sent. */
export function chatCompletion(requestBody) {
  const prompt = requestBody?.messages?.[0]?.content ?? "";
  return { choices: [{ message: { content: JSON.stringify(modelReply(prompt)) } }] };
}

/** @param {(method: string, path: string, body?: unknown) => Promise<{status: number, json: any}>} call */
export async function runScriptedCourse(call) {
  const transcript = [];
  const step = async (method, path, body) => {
    const r = await call(method, path, body);
    transcript.push({ method, path, status: r.status, json: r.json });
    return r;
  };

  const created = await step("POST", "/api/courses", { owner: "Ada Lovelace", title: "How plants eat", materials: [{ name: MATERIAL.name }] });
  const id = created.json.courseId;
  const c = `/api/courses/${encodeURIComponent(id)}`;
  await step("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  await step("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." }); // refused: not answered yet
  await step("POST", `${c}/intake/answer`, { text: "topic", answers: { topic: "photosynthesis" } });
  await step("POST", `${c}/intake/answer`, { text: "course", answers: { course: "Science, ages 8-10" } });
  await step("POST", `${c}/intake/answer`, { text: "Propose the outcomes from my materials.", answers: { outcomes_from: "materials" } });
  await step("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const proposed = await step("POST", `${c}/materials/propose`, { materials: [MATERIAL], objectives: ["smuggled"] });
  const rows = proposed.json.proposals ?? [];
  await step("POST", `${c}/decisions`, {
    text: "Accept the first; it is right.",
    decisions: [{ verb: "accept", proposalId: rows[0]?.id, provenance: { turnRef: "forged" }, decidedBy: "attacker", channel: "x" }],
  });
  await step("POST", `${c}/decisions`, { text: "Rename the second.", decisions: [{ verb: "rename", proposalId: rows[1]?.id, statement: "Students can list what a plant needs to make food.", alignment: { publicId: "mt_1" } }] });
  await step("POST", `${c}/decisions`, { text: "Drop the third.", decisions: [{ verb: "drop", proposalId: rows[2]?.id }] });
  await step("POST", `${c}/decisions`, { text: "Add my own.", decisions: [{ verb: "add", statement: "Students can explain why leaves are green.", id: "urn:uuid:forged" }] });
  await step("GET", c);
  await step("POST", `${c}/plan`, { spec: { title: "smuggled plan" } });
  await step("POST", `${c}/plan/confirm`, { text: "Confirm this lesson plan." });
  await step("POST", `${c}/student/ask`, { question: "What do plants need?" }); // refused: not published
  await step("POST", `${c}/publish`, { text: "Publish the course package." });
  await step("GET", `${c}/anchor/1`);
  await step("POST", `${c}/student/ask`, { question: "What do plants need?", history: [{ role: "student", text: "hi" }], studentId: "s-1" });
  await step("GET", `${c}/export`);
  await step("GET", `${c}/verify`);
  await step("GET", `${c}/intake`);
  await step("GET", "/api/courses");
  await step("GET", "/api/health");
  await step("GET", "/api/courses/urn%3Auuid%3Anope");
  await step("POST", `${c}/nope`, {});
  return { courseId: id, transcript };
}

/* ============================================================================================================
 * SCRIPTED v2 PLANS: test-fixture content for the smokes and the screenshot scripts (H2b). Not a product claim,
 * not model output, and not a recommended lesson: a fixed reply the stand-in model gives so the browser shows
 * a schema-v2 plan that matches the course on screen. A v1 reply stays modelReply's own (the v1 tests use it).
 *
 * scriptedPlanV2(prompt) reads the plan prompt the host sends and picks one of two scripted plans:
 *   - stage 3 (ages 12-14): "How a computer finds things fast", whose third activity asks for AI with no first
 *     try, so the host clamps it to "forbidden" and the teacher sees the note under "Silicus adjusted";
 *   - otherwise: "Spotting AI in daily life" for the anchored smoke course (AI in Daily Life, ages 5-12),
 *     which needs no adjustment: AI forbidden everywhere and the stage's own AI line.
 * Both cite the course's own objectives (the urn:uuid ids in the prompt) and nothing else.
 * K2: each plan's activity minutes add up to 45 (10 + 20 + 15 and 10 + 15 + 20), the wizard's default lesson
 * length, so a 45-minute course gets no length note. Still scripted fixtures, not model output.
 * ============================================================================================================ */

/** The host's stage 1-2 AI lines (host/worker.mjs STAGE_AI_POLICY), copied: a plan that uses them verbatim
 *  needs no "Silicus adjusted" note. If the host's wording changes, the smoke's "no adjustment" check fails. */
const STAGE_POLICY = {
  1: "AI in this course: learners do not use AI at all; nothing a child produces enters a tool. The teacher may use AI to prepare.",
  2: "AI in this course: teacher-led and projected to the whole class, only after children state their own view first; no child uses AI alone.",
};

/** Each objective is cited at least once: activity i takes the ids at i, i+3, ...; an empty share reuses one. */
const share = (ids, i, n) => {
  const mine = ids.filter((_, k) => k % n === i);
  return mine.length ? mine : ids.length ? [ids[i % ids.length]] : [];
};

const DAILY_LIFE = [
  { title: "Smart or not? Place your bet", minutes: 10, phase: 1, session: 1,
    learnerDoes: "Opening bet on the hard prerequisite, Smart Versus Not-Smart Devices. Each child looks at four picture cards (a lamp, a toaster, a talking speaker, a tablet) and bets for each: does it decide something by itself, or only do what a switch tells it?",
    teacherDoes: "Writes the bets on the board without saying who is right, then shows what each device really does.",
    evidenceIfAny: "observation", targetOperation: "tell a device that decides from one that only follows a switch", operationDoneBy: "learner",
    learnerFirst: "Each child bets smart or not-smart for every card and gives one reason.", helpAfter: "teacher", aiStatus: "forbidden",
    decisionAfterHelp: "Each child keeps or changes each bet after the demonstration and says why.", channels: ["speaking", "handling"] },
  { title: "Sort the AI around us", minutes: 20, phase: 2, session: 1,
    learnerDoes: "Pairs sort twelve picture cards of things at home and at school into 'uses AI' and 'does not', then sort a second set in which one detail on each card has changed.",
    teacherDoes: "Walks a worked example of one card aloud, then asks each pair which card was hardest.",
    evidenceIfAny: "work-product", targetOperation: "sort everyday things by whether they use AI", operationDoneBy: "learner",
    learnerFirst: "Each pair sorts the first set alone before the worked example.", helpAfter: "worked-example", aiStatus: "forbidden",
    decisionAfterHelp: "Each pair keeps or moves each card after the class check and says why.", channels: ["handling", "writing", "discussion"] },
  { title: "Patterns, not magic", minutes: 15, phase: 3, supportingPhase: 4, session: 1,
    learnerDoes: "Each child explains to a partner how one AI they found learns from patterns in data, then draws that example for the class wall with a one-line caption.",
    teacherDoes: "Listens to three pairs and asks each 'how could it get this wrong?'",
    evidenceIfAny: "work-product", targetOperation: "explain that AI uses patterns and data, not magic", operationDoneBy: "learner",
    learnerFirst: "Each child draws or writes their own explanation before hearing a partner's.", helpAfter: "peer", aiStatus: "forbidden",
    decisionAfterHelp: "Each child keeps or improves the explanation after the partner's question and says what changed.", channels: ["speaking", "drawing"] },
];

const STAGE3_COMPUTING = [
  { title: "Guess the faster search", minutes: 10, phase: 1, session: 1,
    learnerDoes: "Each learner predicts which finds a name sooner in a sorted list of 64: checking from the top, or opening the middle and halving each time. They write the number of checks they expect.",
    teacherDoes: "Collects the predictions on the board, then runs both searches with a volunteer and a deck of name cards.",
    evidenceIfAny: "observation", targetOperation: "compare linear and binary search by the number of checks", operationDoneBy: "learner",
    learnerFirst: "Each learner writes a prediction and the number of checks before the demonstration.", helpAfter: "teacher", aiStatus: "forbidden",
    decisionAfterHelp: "Each learner keeps or changes the prediction after the demonstration and says why.", channels: ["writing", "enactment"] },
  { title: "Sort the deck, then check", minutes: 15, phase: 2, session: 1,
    learnerDoes: "Pairs sort a shuffled deck of 16 number cards by repeatedly swapping neighbours, counting the swaps, then try the same with the deck in reverse order.",
    teacherDoes: "Watches each pair's first pass before anyone opens a tool, then allows a chatbot to check the swap count.",
    evidenceIfAny: "work-product", targetOperation: "carry out a bubble sort and count its swaps", operationDoneBy: "learner",
    learnerFirst: "Each pair completes one full pass by hand while the teacher watches.", helpAfter: "ai", aiStatus: "permitted",
    noAiAlternative: "The pair checks its count against a printed worked trace.",
    decisionAfterHelp: "Each pair keeps or corrects its count after the check and says where it went wrong.", channels: ["handling", "discussion"] },
  { title: "Explain it in your own words", minutes: 20, phase: 3, supportingPhase: 4, session: 1,
    learnerDoes: "Each learner explains, from the halving trace on the board, why the middle-check search finds a name faster, then writes a short explanation of binary search for a younger student.",
    teacherDoes: "Reads two explanations aloud and asks the class what each one leaves out.",
    evidenceIfAny: "work-product", targetOperation: "explain why binary search needs a sorted list", operationDoneBy: "learner",
    helpAfter: "ai", aiStatus: "permitted", noAiAlternative: "The learner uses the class's demonstration notes instead.",
    decisionAfterHelp: "Each learner keeps or rewrites one sentence after the class discussion.", channels: ["writing", "speaking"] },
];

/** The scripted v2 plan for a "Draft one lesson plan" prompt. Test fixture content; see the block comment above. */
export function scriptedPlanV2(prompt) {
  const p = String(prompt ?? "");
  const ids = [...p.matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
  const refs = [...p.matchAll(/^- \[([a-z]+:[^\]]+)\]/gm)].map((m) => m[1]);
  const stage = Number(/stage (\d) \(/.exec(p)?.[1] ?? 0) || null;
  const build = (acts) => acts.map((a, i) => ({ ...a, objectiveIds: share(ids, i, acts.length), ...(refs[i] ? { citations: [refs[i]] } : {}) }));
  if (stage === 3) {
    return { title: "How a computer finds things fast", audience: { ageRangeStart: 12, ageRangeEnd: 14 },
      sessions: [{ session: 1, evidence: { kind: "work-product", whatLearnerProduces: "Each learner's written explanation of binary search for a younger student." } }],
      spacedReviews: [
        { afterDays: 3, form: "recall-without-support", whatChanges: "no cards and no notes", prompt: "How many checks does binary search need for a list of 32? Show your halving." },
        { afterDays: 14, form: "near-transfer", whatChanges: "a phone's contact list instead of number cards", prompt: "Explain how your phone could find a contact quickly, and what must be true of the list." },
      ],
      activities: build(STAGE3_COMPUTING) };
  }
  return { title: "Spotting AI in daily life", audience: { ageRangeStart: 5, ageRangeEnd: 12 },
    sessions: [{ session: 1, evidence: { kind: "work-product", whatLearnerProduces: "Each pair's sorted card strip, with one written or drawn reason for the hardest card." } }],
    spacedReviews: [
      { afterDays: 2, form: "recall-without-support", whatChanges: "no cards on the table this time", prompt: "Name two things at home that decide something by themselves, and one that only follows a switch." },
      { afterDays: 7, form: "far-transfer", whatChanges: "a picture of a shop instead of the lesson's cards", prompt: "Spot the AI in this shop picture and say how you know." },
    ],
    ...(stage === 1 || stage === 2 ? { aiPolicy: STAGE_POLICY[stage] } : {}),
    activities: build(DAILY_LIFE) };
}

/**
 * H3 C2 — UNIT-TEST-ONLY fixture: the same stage-3 plan, but the third activity's prose still
 * tells learners to ask a chatbot, as a real model reply might before anyone reworded it. The
 * host clamps the aiStatus and never rewrites the prose; the test proves the clamped marker
 * shows on the activity even though its text still mentions AI. The smokes and the screenshots
 * use `scriptedPlanV2`'s reworded text instead.
 */
export function staleStage3PlanV2(prompt) {
  const p = String(prompt ?? "");
  const stage = Number(/stage (\d) \(/.exec(p)?.[1] ?? 0) || null;
  if (stage !== 3) throw new Error("staleStage3PlanV2 is only defined for a stage-3 prompt");
  const plan = scriptedPlanV2(prompt);
  return {
    ...plan,
    activities: plan.activities.map((a, i) => i === 2
      ? { ...a, learnerDoes: "Each learner asks a chatbot why halving is faster, then writes a short explanation of binary search for a younger student." }
      : a),
  };
}
