/**
 * reword.test.mjs — the `reword` decision verb: change the statement of an already CONFIRMED objective
 * in place, KEEPING ITS ID (so a lesson plan's citations survive).
 *
 * The contract, in the order these tests pin it:
 *   1. `reword` is a decision verb; only a confirmed (accepted / renamed / added) objective can take it.
 *      Proposed, dropped and unknown ids are refused with distinct codes; the same statement is a no-op refusal.
 *   2. id and kind never change; before/after and teacher provenance are recorded on the decision exactly
 *      as for rename. The original proposal record is never mutated.
 *   3. The confirmed lesson plan stays CONFIRMED (its cited ids are unchanged), but it was drafted from the
 *      OLD wording, so the gate says so (`rewordedSincePlan`) instead of pretending it is current. Nothing
 *      auto-reconfirms or auto-invalidates. A new draft, or a teacher re-confirmation after the reword,
 *      is the only thing that clears it.
 *   4. A sealed version never changes; publishing after a reword seals version N+1 with the new wording.
 *   5. rename stays terminal (the existing rule is untouched).
 *   6. Replay is exact.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TurnLedger } from "../host-guard.mjs";
import {
  ConfirmGate,
  ConfirmGateError,
  FabricatedConfirmationError,
  VERBS,
  deterministicIdFactory,
} from "../confirm-gate.mjs";

/* --------------------------------- helpers -------------------------------- */

const OWNER = "teacher:tk-1";
const CHANNEL = "silicus-ui";

function makeCtx(idFactory) {
  let t = 1_000_000;
  const clock = () => t;
  const tick = (ms = 10) => (t += ms);
  const ledger = new TurnLedger({ clock });
  const gate = new ConfirmGate({
    courseId: "urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    owner: OWNER,
    title: "AI literacy",
    ledger,
    clock,
    ...(idFactory ? { idFactory } : {}),
  });
  const via = ledger.teacherChannel({ teacherId: OWNER, channel: CHANNEL });
  const say = (text) => {
    tick();
    const ref = via.say(text);
    tick();
    return { ref, prov: { turnRef: ref, decidedBy: OWNER, channel: CHANNEL, decidedAt: clock() } };
  };
  const decide = (decisions, text = "Decide.") => gate.confirmObjectives({ provenance: say(text).prov, decisions });
  const reword = (id, statement, text = "Reword it.") => decide([{ verb: "reword", proposalId: id, statement }], text)[0];
  return { clock, tick, ledger, gate, via, say, decide, reword };
}

function walkToObjectives(ctx) {
  ctx.gate.confirmCheckpoint("files", ctx.say("Files ok.").prov);
  ctx.gate.confirmCheckpoint("outline", ctx.say("Outline ok.").prov);
}

const activity = (objectiveIds, title = "Sort devices") => ({
  title, minutes: 15, objectiveIds, materialVersionIds: [],
  learnerDoes: "Classify devices.", teacherDoes: "Facilitates.", evidenceIfAny: "observation",
});

const A = "Students can explain what an algorithm is.";
const B = "Students can sort a list by hand.";

/** Accepted A, renamed B (from "Vague."), added C. Plan citing all three, confirmed, published as v1. */
function publishedCourse() {
  const ctx = makeCtx();
  walkToObjectives(ctx);
  const [pa, pb] = ctx.gate.proposeObjectives([{ kind: "local", statement: A }, { kind: "local", statement: "Vague." }]);
  const decisions = ctx.decide([
    { verb: "accept", proposalId: pa.id },
    { verb: "rename", proposalId: pb.id, statement: B },
    { verb: "add", statement: "Students can debug a short program." },
  ], "Decide them all.");
  const cId = decisions[2].targetId;
  const plan = ctx.gate.proposeLessonPlan({ title: "Lesson 1", activities: [activity([pa.id, pb.id]), activity([cId], "Debug")] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Plan ok.").prov });
  const v1 = ctx.gate.publish({ provenance: ctx.say("Publish.").prov, note: "first" });
  return { ctx, pa, pb, cId, plan, v1 };
}

const codeOf = (code) => (e) => e instanceof ConfirmGateError && e.code === code;

/* ------------------------------- the contract ------------------------------ */

test("reword is a decision verb", () => {
  assert.ok(VERBS.includes("reword"));
});

test("reword keeps id and kind, takes the teacher's statement, and records before/after + provenance", () => {
  const { ctx, pa, pb, cId } = publishedCourse();
  for (const [id, before, after] of [
    [pa.id, A, "Students can explain, in their own words, what an algorithm is."],
    [pb.id, B, "Students can sort ten cards by hand and say how they did it."],
    [cId, "Students can debug a short program.", "Students can find and fix one bug in a short program."],
  ]) {
    const turn = ctx.say(`Reword ${id} to: ${after}`);
    const [d] = ctx.gate.confirmObjectives({ provenance: turn.prov, decisions: [{ verb: "reword", proposalId: id, statement: after }] });
    assert.equal(d.verb, "reword");
    assert.equal(d.targetId, id, "the id is the target and does not change");
    assert.equal(d.statement, after, "after");
    assert.equal(d.rewordedFrom.previousStatement, before, "before");
    assert.equal(d.provenance.turnRef, turn.ref, "provenance comes from the teacher turn");
    assert.equal(d.provenance.decidedBy, OWNER);
    const obj = ctx.gate.getObjective(id);
    assert.equal(obj.id, id);
    assert.equal(obj.kind, "local");
    assert.equal(obj.statement, after);
    assert.equal(obj.confirmedByEducator, true);
    assert.ok(ctx.gate.confirmedObjectives().some((o) => o.id === id && o.statement === after));
  }
});

test("the original proposal record is never mutated, and the objective remembers its original wording", () => {
  const { ctx, pb } = publishedCourse();
  const d = ctx.reword(pb.id, "A third wording.");
  assert.equal(ctx.gate.getProposal(pb.id).statement, "Vague.", "the proposal stays exactly as the AI proposed it");
  assert.equal(d.rewordedFrom.originalStatement, "Vague.");
  assert.equal(d.rewordedFrom.previousStatement, B, "the rename in between is the immediate 'before'");
  const obj = ctx.gate.getObjective(pb.id);
  assert.equal(obj.renamedFrom.originalStatement, "Vague.", "the rename record is untouched");
  assert.equal(obj.rewordedFrom.previousStatement, B);
  assert.equal(obj.rewordedFrom.decisionId, d.id);
  // The objective's own confirmation (who accepted/renamed it) is not overwritten by the reword.
  assert.notEqual(obj.decisionId, d.id);
});

test("a public-kind objective keeps its kind and Marble reference; only the teacher's statement changes", () => {
  const ctx = makeCtx();
  walkToObjectives(ctx);
  const [p] = ctx.gate.proposeObjectives([{ kind: "public", publicId: "mt_0007", alignment: { publicId: "mt_0007", relationship: "closeMatch" } }]);
  ctx.decide([{ verb: "accept", proposalId: p.id }]);
  const d = ctx.reword(p.id, "Teacher wording for the Marble outcome.");
  assert.equal(d.rewordedFrom.previousStatement, null, "a public proposal with no statement has no 'before'");
  const obj = ctx.gate.getObjective(p.id);
  assert.equal(obj.kind, "public");
  assert.equal(obj.publicId, "mt_0007");
  assert.equal(obj.statement, "Teacher wording for the Marble outcome.");
  assert.match(obj.id, /^urn:uuid:/);
});

test("only a confirmed objective can be reworded: proposed, dropped and unknown ids are refused with their own codes", () => {
  const ctx = makeCtx();
  walkToObjectives(ctx);
  const [p1, p2] = ctx.gate.proposeObjectives([{ kind: "local", statement: A }, { kind: "local", statement: B }]);
  const before = ctx.gate.decisions().length;

  assert.throws(() => ctx.reword(p1.id, "New."), codeOf("NOT_CONFIRMED"));
  ctx.decide([{ verb: "drop", proposalId: p2.id }]);
  assert.throws(() => ctx.reword(p2.id, "New."), codeOf("OBJECTIVE_REVOKED"), "a never-accepted dropped proposal");
  ctx.decide([{ verb: "accept", proposalId: p1.id }]);
  ctx.decide([{ verb: "drop", proposalId: p1.id }]);
  assert.throws(() => ctx.reword(p1.id, "New."), codeOf("OBJECTIVE_REVOKED"), "a revoked confirmed objective");
  assert.throws(() => ctx.reword("urn:uuid:00000000-0000-4000-8000-000000000000", "New."), codeOf("UNKNOWN_OBJECTIVE"));
  assert.throws(() => ctx.reword("mt_0007", "New."), codeOf("UNKNOWN_OBJECTIVE"), "an mt_* id is never an objective id");
  assert.throws(() => ctx.decide([{ verb: "reword", statement: "New." }]), codeOf("UNKNOWN_OBJECTIVE"), "no id at all");
  assert.equal(ctx.gate.decisions().length, before + 3, "only the accept and the two drops were recorded; every reword left nothing");
  assert.equal(ctx.gate.confirmedObjectives().length, 0);
});

test("rewording to the same statement is a no-op refusal; empty text is refused; a reword never needs the old wording back", () => {
  const { ctx, pa } = publishedCourse();
  const n = ctx.gate.decisions().length;
  assert.throws(() => ctx.reword(pa.id, A), codeOf("STATEMENT_UNCHANGED"));
  assert.throws(() => ctx.reword(pa.id, `  ${A}  `), codeOf("STATEMENT_UNCHANGED"), "surrounding space is not a change");
  assert.throws(() => ctx.reword(pa.id, "   "), codeOf("BAD_STATEMENT"));
  assert.throws(() => ctx.reword(pa.id, undefined), codeOf("BAD_STATEMENT"));
  assert.throws(() => ctx.reword(pa.id, 42), codeOf("BAD_STATEMENT"));
  assert.equal(ctx.gate.decisions().length, n);
  assert.equal(ctx.gate.getObjective(pa.id).statement, A);
  // Back to an earlier wording is a real change and is allowed.
  ctx.reword(pa.id, "Something else.");
  ctx.reword(pa.id, A);
  assert.equal(ctx.gate.getObjective(pa.id).statement, A);
});

test("a reword needs a REAL teacher turn: no provenance, an assistant turn and a forged turn ref are refused", () => {
  const { ctx, pa } = publishedCourse();
  const n = ctx.gate.decisions().length;
  const d = [{ verb: "reword", proposalId: pa.id, statement: "Forged." }];
  assert.throws(() => ctx.gate.confirmObjectives({ provenance: undefined, decisions: d }), (e) => e instanceof FabricatedConfirmationError && e.code === "MISSING_PROVENANCE");
  assert.throws(() => ctx.gate.confirmObjectives({ provenance: { turnRef: "turn:nope", decidedBy: OWNER, channel: CHANNEL, decidedAt: ctx.clock() }, decisions: d }), (e) => e instanceof FabricatedConfirmationError && e.code === "UNKNOWN_TURN");
  const aiRef = ctx.ledger.recordAssistantTurn("I reworded it for you.", { channel: "model" });
  assert.throws(() => ctx.gate.confirmObjectives({ provenance: { turnRef: aiRef, decidedBy: OWNER, channel: CHANNEL, decidedAt: ctx.clock() }, decisions: d }), (e) => e instanceof FabricatedConfirmationError && e.code === "NON_TEACHER_TURN");
  assert.equal(ctx.gate.decisions().length, n);
  assert.equal(ctx.gate.getObjective(pa.id).statement, A);
});

test("replaying the same call is idempotent; A→B→A in one turn applies every step in order", () => {
  const { ctx, pa } = publishedCourse();
  const turn = ctx.say("Reword.");
  const spec = { provenance: turn.prov, decisions: [{ verb: "reword", proposalId: pa.id, statement: "One." }] };
  const [first] = ctx.gate.confirmObjectives(spec);
  const [again] = ctx.gate.confirmObjectives(spec);
  assert.equal(again, first, "an identical retry returns the original decision and applies nothing");
  assert.equal(ctx.gate.decisions().filter((d) => d.verb === "reword").length, 1);

  // One turn, A -> B -> A: every step lands; the middle one is not swallowed as a "replay".
  const t2 = ctx.say("Back and forth.");
  const out = ctx.gate.confirmObjectives({ provenance: t2.prov, decisions: [
    { verb: "reword", proposalId: pa.id, statement: "Two." },
    { verb: "reword", proposalId: pa.id, statement: "Three." },
    { verb: "reword", proposalId: pa.id, statement: "Two." },
  ] });
  assert.equal(out.length, 3);
  assert.notEqual(out[2], out[0], "the third is a real change back, not a replay of the first");
  assert.equal(ctx.gate.getObjective(pa.id).statement, "Two.");
});

test("rename of a confirmed objective is STILL terminal (reword is the new path, not a loosened rename)", () => {
  const { ctx, pa, pb } = publishedCourse();
  assert.throws(() => ctx.decide([{ verb: "rename", proposalId: pa.id, statement: "Nope." }]), codeOf("ALREADY_DECIDED"));
  assert.throws(() => ctx.decide([{ verb: "rename", proposalId: pb.id, statement: "Nope." }]), codeOf("ALREADY_DECIDED"));
  assert.throws(() => ctx.decide([{ verb: "accept", proposalId: pa.id }]), codeOf("ALREADY_DECIDED"));
  assert.equal(ctx.gate.getObjective(pa.id).statement, A);
});

/* ------------------------- the plan, honestly (rule) ------------------------ */

test("RULE: the confirmed plan survives a reword and stays publishable, but the gate says its objectives were reworded since", () => {
  const { ctx, pa, cId, plan } = publishedCourse();
  assert.deepEqual(ctx.gate.rewordedSincePlan(), [], "nothing reworded yet");

  const d = ctx.reword(pa.id, "Students can explain what an algorithm is and give an example.");
  // Not invalidated, not unconfirmed: the cited ids are unchanged.
  assert.equal(ctx.gate.currentPlan().id, plan.id);
  assert.equal(ctx.gate.currentPlan().status, "confirmed");
  assert.equal(ctx.gate.checkpoints().plan.status, "confirmed");
  assert.deepEqual([...ctx.gate.publishBlockers()], []);
  // ...but it is not silently "current": the plan was drafted from the old wording.
  assert.deepEqual(ctx.gate.rewordedSincePlan().map((r) => ({ ...r })), [
    { objectiveId: pa.id, before: A, after: "Students can explain what an algorithm is and give an example.", decisionId: d.id },
  ]);
  // The publish checkpoint reopens (the record differs from the sealed version).
  assert.equal(ctx.gate.checkpoints().publish.status, "pending");

  // Several rewords of one objective collapse to one entry: first 'before', latest 'after'.
  ctx.reword(pa.id, "Third.");
  const flagged = ctx.gate.rewordedSincePlan();
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].before, A);
  assert.equal(flagged[0].after, "Third.");

  // An objective the plan cites is flagged; one it does not cite is not.
  ctx.gate.proposeObjectives([{ kind: "local", statement: "A new one the plan does not cite." }]);
  const [added] = ctx.decide([{ verb: "add", statement: "Students can name one risk of AI." }]);
  ctx.reword(added.targetId, "Students can name two risks of AI.");
  assert.deepEqual(ctx.gate.rewordedSincePlan().map((r) => r.objectiveId), [pa.id]);
  assert.ok(ctx.gate.getObjective(cId));
});

test("RULE: a new draft clears the flag; so does a teacher re-confirmation made after the reword; neither is automatic", () => {
  const { ctx, pa, pb } = publishedCourse();
  ctx.reword(pa.id, "Reworded once.");
  assert.equal(ctx.gate.rewordedSincePlan().length, 1);

  // Re-confirming the plan as it reads is a deliberate teacher act made with the flag showing.
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Yes, the plan still fits.").prov });
  assert.deepEqual(ctx.gate.rewordedSincePlan(), []);

  // A reword AFTER that re-confirmation flags again.
  ctx.reword(pb.id, "Reworded after the re-confirmation.");
  assert.equal(ctx.gate.rewordedSincePlan().length, 1);

  // A fresh draft is built from the current wording: nothing to flag, and it is a DRAFT until confirmed.
  ctx.gate.proposeLessonPlan({ title: "Lesson 1b", activities: [activity([pa.id, pb.id])] });
  assert.deepEqual(ctx.gate.rewordedSincePlan(), []);
  assert.equal(ctx.gate.currentPlan().status, "draft");

  // A reword while that new draft is unconfirmed flags it too (the draft text predates the reword).
  ctx.reword(pa.id, "Reworded while a draft waits.");
  assert.equal(ctx.gate.rewordedSincePlan().length, 1);
});

test("dropping a reworded objective still invalidates the plan that cites it, and it can no longer be reworded", () => {
  const { ctx, pa } = publishedCourse();
  ctx.reword(pa.id, "Reworded, then revoked.");
  ctx.decide([{ verb: "drop", proposalId: pa.id }]);
  assert.equal(ctx.gate.currentPlan().status, "invalidated");
  assert.throws(() => ctx.reword(pa.id, "Too late."), codeOf("OBJECTIVE_REVOKED"));
  assert.deepEqual(ctx.gate.rewordedSincePlan(), [], "an invalidated plan has its own story; no second notice");
});

/* --------------------------------- sealing ---------------------------------- */

test("a sealed version never changes; publishing after a reword seals v2 with the new wording", () => {
  const { ctx, pa, v1 } = publishedCourse();
  const frozenV1 = JSON.stringify(ctx.gate.getVersion(1));
  const after = "Students can explain what an algorithm is, with an example.";
  ctx.reword(pa.id, after);

  assert.equal(JSON.stringify(ctx.gate.getVersion(1)), frozenV1, "version 1 is byte-identical after the reword");
  assert.equal(v1.objectiveRefs.find((o) => o.id === pa.id).statement, A);
  assert.equal(ctx.gate.versions().length, 1);

  const v2 = ctx.gate.publish({ provenance: ctx.say("Publish the reworded course.").prov, note: "reworded" });
  assert.equal(v2.version, 2, "a reword makes the record dirty, so publish seals the next version");
  assert.equal(v2.previousVersion, 1);
  assert.equal(v2.objectiveRefs.find((o) => o.id === pa.id).statement, after);
  assert.equal(v2.lessonPlan.id, v1.lessonPlan.id, "same plan, same citations");
  assert.deepEqual(v2.objectiveRefs.map((o) => o.id).sort(), v1.objectiveRefs.map((o) => o.id).sort());
  assert.equal(JSON.stringify(ctx.gate.getVersion(1)), frozenV1);
  assert.equal(ctx.gate.getVersion(2).objectiveRefs.find((o) => o.id === pa.id).rewordedFrom.previousStatement, A);
});

test("a published plan's citations survive: every cited id still resolves to a confirmed objective", () => {
  const { ctx, pa, pb, cId } = publishedCourse();
  ctx.reword(pa.id, "x1"); ctx.reword(pb.id, "x2"); ctx.reword(cId, "x3");
  const cited = new Set(ctx.gate.currentPlan().activities.flatMap((a) => a.objectiveIds));
  for (const id of cited) assert.ok(ctx.gate.getObjective(id), `${id} is still confirmed`);
  assert.equal(ctx.gate.publish({ provenance: ctx.say("Publish.").prov }).version, 2);
});

/* ---------------------------------- replay ---------------------------------- */

test("replay: the same operations over a fresh deterministic gate reproduce every record byte for byte", () => {
  const run = () => {
    const ctx = makeCtx(deterministicIdFactory("urn:uuid:reword-seed"));
    walkToObjectives(ctx);
    const [p] = ctx.gate.proposeObjectives([{ kind: "local", statement: A }]);
    ctx.decide([{ verb: "accept", proposalId: p.id }]);
    ctx.gate.proposeLessonPlan({ title: "L", activities: [activity([p.id])] });
    ctx.gate.confirmLessonPlan({ provenance: ctx.say("Plan.").prov });
    ctx.gate.publish({ provenance: ctx.say("Publish.").prov });
    ctx.reword(p.id, "Reworded.");
    ctx.gate.publish({ provenance: ctx.say("Publish 2.").prov });
    ctx.reword(p.id, "Reworded again.");
    return JSON.stringify({
      decisions: ctx.gate.decisions(), confirmed: ctx.gate.confirmedObjectives(), versions: ctx.gate.versions(),
      checkpoints: ctx.gate.checkpoints(), stale: ctx.gate.rewordedSincePlan(), publish: ctx.gate.publishStatus(),
    });
  };
  const first = run();
  assert.equal(run(), first);
  assert.match(first, /"verb":"reword"/);
});
