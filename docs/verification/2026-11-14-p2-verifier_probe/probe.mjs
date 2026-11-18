// P2V verifier probe: my own cases against the plan normaliser (via PlanWorker.draft + in-memory fetch).
// usage: TREE=<export> node probe.mjs   -> exit 0 only if every expectation holds
const { PlanWorker } = await import(`${process.env.TREE}/host/worker.mjs`);
const { stageForAges } = await import(`${process.env.TREE}/host/ages.mjs`);
const OBJ = [{ id: "urn:uuid:aaa", statement: "Students can explain what an algorithm is." }];
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log("FAIL:", m); } };
async function norm(plan, ages) {
  const f = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: "stop" }] }) });
  return new PlanWorker({ url: "https://example.test/v1", model: "m", fetchImpl: f }).draft({ objectives: OBJ, ages });
}
const act = (extra = {}) => ({ title: "A", minutes: 5, objectiveIds: ["urn:uuid:aaa"], learnerDoes: "x", teacherDoes: "y", evidenceIfAny: "observation", ...extra });
const plan = (extra = {}, aextra = {}) => ({ title: "T", activities: [act(aextra)], ...extra });

// stage boundaries (own table)
for (const [min, st] of [[4,1],[7,1],[8,2],[11,2],[12,3],[14,3],[15,4],[18,4]]) ok(stageForAges({ min }) === st, `stage for min=${min}`);
ok(stageForAges(null) === null && stageForAges(undefined) === null && stageForAges({}) === null && stageForAges({ min: "x" }) === null, "no ages -> null stage");

// clamp table, every stage x every value x with/without first-try + alternative
const EXPECT = { // stage -> input -> output
  1: { forbidden: "forbidden", permitted: "forbidden", required: "forbidden" },
  2: { forbidden: "forbidden", permitted: "permitted", required: "permitted" },
  3: { forbidden: "forbidden", permitted: "permitted", required: "permitted" },
  4: { forbidden: "forbidden", permitted: "permitted", required: "required" },
};
const AGES = { 1: { min: 5, max: 7 }, 2: { min: 9, max: 10 }, 3: { min: 13, max: 14 }, 4: { min: 16, max: 18 } };
for (const st of [1,2,3,4]) for (const inp of Object.keys(EXPECT[st])) for (const first of [false, true]) for (const alt of [false, true]) {
  const s = await norm(plan({}, { aiStatus: inp, ...(first ? { learnerFirst: "guess" } : {}), ...(alt ? { noAiAlternative: "pencil" } : {}) }), AGES[st]);
  ok(s.activities[0].aiStatus === EXPECT[st][inp], `stage ${st} ${inp}(first=${first},alt=${alt}) -> ${s.activities[0].aiStatus}, want ${EXPECT[st][inp]}`);
  if (EXPECT[st][inp] !== inp) ok((s.notes ?? []).some((x) => /clamped/.test(x)), `stage ${st} ${inp}: clamp note missing`);
  if (EXPECT[st][inp] === inp) ok(!(s.notes ?? []).some((x) => /clamped/.test(x)), `stage ${st} ${inp}: spurious clamp note`);
  if (st === 3 && EXPECT[st][inp] !== "forbidden" && !first) ok((s.notes ?? []).some((x) => /first try/.test(x)), `stage 3 ${inp} no first try: note missing`);
  if (EXPECT[st][inp] !== "forbidden" && !alt) ok((s.notes ?? []).some((x) => /noAiAlternative/.test(x)), `stage ${st} ${inp} no alt: note missing`);
}
// never required below stage 4; required kept at 4
for (const st of [1,2,3]) { const s = await norm(plan({}, { aiStatus: "required" }), AGES[st]); ok(s.activities[0].aiStatus !== "required", `stage ${st} required leaked`); }

// the model can never set the stage
const lie = { stage: 4, audience: { ageRangeStart: 16, ageRangeEnd: 18, stage: 4 } };
let s = await norm(plan(lie, { aiStatus: "required", stage: 4 }), AGES[1]);
ok(s.activities[0].aiStatus === "forbidden" && !("stage" in s) && !("stage" in s.activities[0]), "model-claimed stage 4 must not beat host stage 1");
s = await norm(plan(lie, { aiStatus: "required" }), AGES[2]);
ok(s.activities[0].aiStatus === "permitted", "model-claimed audience 16 must not beat host stage 2");
// no ages -> no aiStatus / aiPolicy, even when the model's own audience says 16
for (const ages of [null, undefined, {}, { min: "x" }]) {
  s = await norm(plan({ ...lie, aiPolicy: "anything" }, { aiStatus: "required", noAiAlternative: "n" }), ages);
  ok(!("aiStatus" in s.activities[0]) && !("aiPolicy" in s), `no ages (${JSON.stringify(ages)}): aiStatus/aiPolicy must be absent`);
  ok((s.notes ?? []).length >= 2, "no ages: notes explain the drop");
}
// aiPolicy: stage 1-2 owned by the host, 3-4 dropped, absent stays absent
for (const st of [1,2]) { s = await norm(plan({ aiPolicy: "Go wild with AI" }), AGES[st]); ok(s.aiPolicy && !/wild/.test(s.aiPolicy) && s.notes.some((x) => /replaced aiPolicy/.test(x)), `stage ${st} aiPolicy replaced`); s = await norm(plan(), AGES[st]); ok(!("aiPolicy" in s), `stage ${st}: absent aiPolicy stays absent`); }
for (const st of [3,4]) { s = await norm(plan({ aiPolicy: "x" }), AGES[st]); ok(!("aiPolicy" in s) && s.notes.some((x) => /dropped aiPolicy/.test(x)), `stage ${st} aiPolicy dropped`); }

// v1 plan: byte-identical to what v1 produced (key for key), no notes invented
const v1 = { title: "Seeing", audience: { ageRangeStart: 8, ageRangeEnd: 10 }, activities: [act(), act({ title: "B" })] };
for (const ages of [null, AGES[1], AGES[2], AGES[3], AGES[4]]) {
  s = await norm(v1, ages);
  ok(!("notes" in s) && !("sessions" in s) && !("spacedReviews" in s) && !("aiPolicy" in s), "v1: no invented plan keys");
  ok(JSON.stringify(Object.keys(s.activities[0])) === JSON.stringify(["title","minutes","objectiveIds","learnerDoes","teacherDoes","evidenceIfAny"]), "v1: activity keys exactly the v1 set: " + Object.keys(s.activities[0]));
}
// unknown values dropped with a note (and never retained)
s = await norm(plan({ sessions: [{ session: 0, evidence: { kind: "chat", whatLearnerProduces: "x" } }, { session: 1, evidence: { kind: "chat", whatLearnerProduces: "x" } }], spacedReviews: [{ afterDays: -1, form: "recall-without-support", whatChanges: "a", prompt: "b" }, { afterDays: 3, form: "vibes", whatChanges: "a", prompt: "b" }] },
  { phase: 9, supportingPhase: "2", operationDoneBy: "robot", helpAfter: "wizard", channels: ["visual", "drawing", "drawing", 7], session: 0, aiStatus: "bogus", targetOperation: 12 }), AGES[4]);
const a0 = s.activities[0];
ok(["phase","supportingPhase","operationDoneBy","helpAfter","session","aiStatus","targetOperation"].every((k) => !(k in a0)), "unknown values dropped: " + Object.keys(a0));
ok(JSON.stringify(a0.channels) === '["drawing"]', "channels filtered/deduped: " + JSON.stringify(a0.channels));
ok(!s.sessions && !s.spacedReviews, "bad sessions/reviews dropped entirely");
ok(s.notes.length >= 10, "each drop has a note, got " + s.notes.length);
// hostile enum values: note size (observation printed, asserted only as a bound check)
const big = "Z".repeat(20000);
s = await norm(plan({}, { operationDoneBy: big, channels: [big] }), AGES[4]);
const longest = Math.max(...s.notes.map((x) => x.length));
console.log("OBS note-length with 20000-char hostile enum:", longest);
// contradictory sibling fields at stage 1/2 (observations, not asserted)
s = await norm(plan({}, { aiStatus: "permitted", helpAfter: "ai", operationDoneBy: "ai", learnerFirst: "g", noAiAlternative: "n" }), AGES[1]);
console.log("OBS stage1 permitted+helpAfter=ai+operationDoneBy=ai ->", JSON.stringify({ aiStatus: s.activities[0].aiStatus, helpAfter: s.activities[0].helpAfter, operationDoneBy: s.activities[0].operationDoneBy }));
s = await norm(plan({}, { helpAfter: "ai", operationDoneBy: "ai" }), AGES[1]);
console.log("OBS stage1 no aiStatus, helpAfter=ai ->", JSON.stringify({ aiStatus: s.activities[0].aiStatus, helpAfter: s.activities[0].helpAfter, operationDoneBy: s.activities[0].operationDoneBy, notes: s.notes }));
console.log(`probe: ${n - fails}/${n} expectations hold`);
process.exit(fails ? 1 : 0);
