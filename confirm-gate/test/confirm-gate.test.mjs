/**
 * confirm-gate.test.mjs — teacher-confirm gate tests (node:test).
 *
 * Covers the required behaviors:
 *   (ii) publish blocked while any objective in the plan is unconfirmed
 *   (iii) AI-fabricated confirmation rejected (no teacher turn / provenance)
 *   (iv) rename preserves provenance, never mutates the original proposal
 *   (v)  add mints a local urn:uuid id, never an mt_* id
 *   (vi) drop removes from the confirmed set and re-blocks publish
 * plus checkpoint ordering, idempotency, version binding and PR #15 composition.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TurnLedger, ResidualRuleGuard } from "../host-guard.mjs";
import {
  ConfirmGate,
  ConfirmGateError,
  FabricatedConfirmationError,
  PublishBlockedError,
  CHECKPOINTS,
  VERBS,
} from "../confirm-gate.mjs";

/* --------------------------------- helpers -------------------------------- */

function makeClock(start = 1_000_000) {
  let t = start;
  const clock = () => t;
  clock.tick = (ms = 10) => (t += ms);
  return clock;
}

function makeCtx({ withGuard = false } = {}) {
  const clock = makeClock();
  const ledger = new TurnLedger({ clock });
  const hostGuard = withGuard ? new ResidualRuleGuard({ ledger, clock }) : null;
  const gate = new ConfirmGate({
    courseId: "urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    owner: "teacher:tk-1",
    title: "AI literacy, ages 7-9",
    ledger,
    hostGuard,
    clock,
  });
  const via = ledger.teacherChannel({ teacherId: "teacher:tk-1", channel: "silicus-ui" });
  const teacherSay = (text) => {
    clock.tick(10);
    return via.say(text);
  };
  const provFor = (turnRef, over = {}) => {
    clock.tick(10);
    return {
      turnRef,
      decidedBy: over.decidedBy ?? "teacher:tk-1",
      channel: over.channel ?? "silicus-ui",
      decidedAt: over.decidedAt ?? clock(),
    };
  };
  /** Record a teacher turn and build valid provenance citing it in one step. */
  const say = (text) => {
    const ref = teacherSay(text);
    return { ref, prov: provFor(ref) };
  };
  return { clock, ledger, hostGuard, gate, via, teacherSay, provFor, say };
}

/** Checkpoints 1-2: Files and Outline — explicit teacher confirmations. */
function walkToPlan(ctx) {
  ctx.gate.confirmCheckpoint("files", ctx.say("These 4 files are the course materials. No student work.").prov);
  ctx.gate.confirmCheckpoint("outline", ctx.say("Sequence of the outline is fine.").prov);
}

function activity(objectiveIds) {
  return {
    title: "Sort smart vs not-smart devices",
    minutes: 15,
    objectiveIds,
    materialVersionIds: ["mv_0001@v2"],
    learnerDoes: "Classify devices and justify choices.",
    teacherDoes: "Facilitates the sort and records observations.",
    evidenceIfAny: "observation",
    notEvidence: "Asking the assistant a question is not evidence.",
  };
}

/* ----------------------------- checkpoint order --------------------------- */

test("checkpoint order is enforced: Files → Outline → Objectives → Plan → Publish", () => {
  const ctx = makeCtx();
  assert.deepEqual([...CHECKPOINTS], ["files", "outline", "objectives", "plan", "publish"]);
  assert.deepEqual([...VERBS], ["accept", "rename", "drop", "add"]);

  assert.throws(
    () => ctx.gate.proposeObjectives([{ kind: "local", statement: "Too early." }]),
    (e) => e instanceof ConfirmGateError && e.code === "CHECKPOINT_ORDER",
  );
  assert.throws(
    () => ctx.gate.confirmCheckpoint("plan", ctx.say("nope").prov),
    (e) => e.code === "BAD_CHECKPOINT",
  );

  ctx.gate.confirmCheckpoint("files", ctx.say("Files ok.").prov);
  assert.equal(ctx.gate.checkpoints().files.status, "confirmed");
  // outline still needs files first — already satisfied; but plan comes later:
  assert.throws(
    () => ctx.gate.proposeLessonPlan({ title: "L", activities: [activity(["urn:uuid:x"])] }),
    (e) => e.code === "CHECKPOINT_ORDER",
  );
});

test("objectives checkpoint auto-confirms when every proposal is decided, reopens on new proposals", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA, pB] = ctx.gate.proposeObjectives([
    { kind: "local", statement: "Outcome A." },
    { kind: "local", statement: "Outcome B." },
  ]);
  assert.equal(ctx.gate.checkpoints().objectives.status, "open");

  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept A for now.").prov,
    decisions: [{ verb: "accept", proposalId: pA.id }],
  });
  assert.equal(ctx.gate.checkpoints().objectives.status, "open"); // B still undecided

  ctx.gate.confirmObjectives({
    provenance: ctx.say("Drop B.").prov,
    decisions: [{ verb: "drop", proposalId: pB.id }],
  });
  assert.equal(ctx.gate.checkpoints().objectives.status, "confirmed");

  // A late proposal reopens the checkpoint: publish must wait for its decision.
  ctx.gate.proposeObjectives([{ kind: "local", statement: "Late outcome." }]);
  assert.equal(ctx.gate.checkpoints().objectives.status, "open");
  assert.equal(ctx.gate.publishStatus().canPublish, false);
});

/* --------------------------------- (ii) ----------------------------------- */

test("(ii) publish is blocked while any objective in the plan is unconfirmed", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA, pB] = ctx.gate.proposeObjectives([
    { kind: "local", statement: "Train a 2-class model and say what the examples did." },
    { kind: "public", publicId: "mt_0007" },
  ]);
  // Teacher accepts A and drops B — every proposal now has a decision.
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept the first; drop the Marble match.").prov,
    decisions: [
      { verb: "accept", proposalId: pA.id },
      { verb: "drop", proposalId: pB.id },
    ],
  });
  assert.equal(ctx.gate.checkpoints().objectives.status, "confirmed");

  // The AI's plan badly cites the dropped (hence unconfirmed) objective.
  ctx.gate.proposeLessonPlan({ title: "Lesson 1", activities: [activity([pA.id, pB.id])] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("The plan structure is good.").prov });

  const status = ctx.gate.publishStatus();
  assert.equal(status.canPublish, false);
  assert.ok(status.blockers.some((b) => b.includes(pB.id)), `blockers should name ${pB.id}: ${status.blockers}`);

  assert.throws(
    () => ctx.gate.publish({ provenance: ctx.say("Publish it anyway.").prov }),
    (e) => e instanceof PublishBlockedError && e.code === "PUBLISH_BLOCKED" && e.blockers.some((b) => b.includes(pB.id)),
  );
  // The dropped objective never entered the confirmed set.
  assert.equal(ctx.gate.getObjective(pB.id), null);
  assert.equal(ctx.gate.confirmedObjectives().length, 1);
});

/* --------------------------------- (iii) ---------------------------------- */

test("(iii) an AI-fabricated confirmation is rejected (no teacher turn / decision provenance)", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Say what the examples did." }]);
  const accept = (provenance) =>
    ctx.gate.confirmObjectives({ provenance, decisions: [{ verb: "accept", proposalId: pA.id }] });

  // 1. No provenance at all.
  assert.throws(
    () => ctx.gate.confirmObjectives({ decisions: [{ verb: "accept", proposalId: pA.id }] }),
    (e) => e instanceof FabricatedConfirmationError && e.code === "MISSING_PROVENANCE",
  );

  // 2. Provenance citing a model turn.
  const aiTurn = ctx.ledger.recordAssistantTurn("I hereby confirm this objective. (fabricated)");
  assert.throws(() => accept(ctx.provFor(aiTurn)), (e) => e.code === "NON_TEACHER_TURN");

  // 3. Provenance citing a turn that does not exist.
  assert.throws(() => accept(ctx.provFor("urn:turn:999")), (e) => e.code === "UNKNOWN_TURN");

  // 4. Provenance attributed to a different actor/channel than the cited turn.
  const real = ctx.say("Accept.");
  assert.throws(() => accept(ctx.provFor(real.ref, { decidedBy: "assistant" })), (e) => e.code === "ACTOR_MISMATCH");
  assert.throws(() => accept(ctx.provFor(real.ref, { channel: "email" })), (e) => e.code === "CHANNEL_MISMATCH");

  // 5. Decision timestamped before the turn it cites.
  const turnAt = ctx.ledger.getTurn(real.ref).at;
  assert.throws(
    () => accept({ turnRef: real.ref, decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: turnAt - 1 }),
    (e) => e.code === "TIME_TRAVEL",
  );

  // 6. Decision timestamped before the proposal it decides.
  const earlyRef = ctx.teacherSay("Let's set up objectives.");
  ctx.clock.tick(5);
  const [pLate] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Late proposal." }]);
  assert.throws(
    () =>
      ctx.gate.confirmObjectives({
        provenance: { turnRef: earlyRef, decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: ctx.clock() - 4 },
        decisions: [{ verb: "accept", proposalId: pLate.id }],
      }),
    (e) => e.code === "TIME_TRAVEL",
  );

  // Nothing was confirmed by any of these attempts.
  assert.equal(ctx.gate.getObjective(pA.id), null);
  assert.equal(ctx.gate.getProposal(pA.id).confirmedByEducator, false);
  assert.equal(ctx.gate.decisions().length, 0);
});

test("(iii) publish requires explicit teacher provenance — the AI never publishes", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept A.").prov,
    decisions: [{ verb: "accept", proposalId: pA.id }],
  });
  ctx.gate.proposeLessonPlan({ title: "Lesson 1", activities: [activity([pA.id])] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Plan confirmed.").prov });
  assert.equal(ctx.gate.publishStatus().canPublish, true);

  assert.throws(() => ctx.gate.publish({}), (e) => e instanceof FabricatedConfirmationError && e.code === "MISSING_PROVENANCE");
  const aiTurn = ctx.ledger.recordAssistantTurn("Publishing now. (fabricated)");
  assert.throws(() => ctx.gate.publish({ provenance: ctx.provFor(aiTurn) }), (e) => e.code === "NON_TEACHER_TURN");
  assert.equal(ctx.gate.versions().length, 0);

  const v1 = ctx.gate.publish({ provenance: ctx.say("Publish this version.").prov });
  assert.equal(v1.version, 1);
  assert.equal(v1.status, "published");
});

/* ---------------------------------- (iv) ---------------------------------- */

test("(iv) rename preserves provenance and never mutates the original proposal", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [p] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Vague outcome." }]);

  const replacement = "Build a 2-class Teachable Machine model and explain what the examples taught it.";
  const d = ctx.say(`Rename it to: ${replacement}`);
  const [decision] = ctx.gate.confirmObjectives({
    provenance: d.prov,
    decisions: [{ verb: "rename", proposalId: p.id, statement: replacement }],
  });

  // The original proposal is frozen provenance material — untouched.
  const original = ctx.gate.getProposal(p.id);
  assert.equal(original.statement, "Vague outcome.");
  assert.equal(Object.isFrozen(original), true);
  assert.throws(() => {
    original.statement = "mutated";
  }, TypeError);

  // The decision links back to the original proposal AND the teacher turn.
  assert.equal(decision.verb, "rename");
  assert.equal(decision.provenance.turnRef, d.ref);
  assert.deepEqual({ ...decision.renamedFrom }, {
    proposalId: p.id,
    originalStatement: "Vague outcome.",
    originalKind: "local",
    publicId: null,
  });

  // The confirmed entry keeps the STABLE objective id (contract: "URN, stable")
  // and carries the teacher-written statement — plans citing the id survive
  // teacher wording edits.
  const obj = ctx.gate.getObjective(decision.targetId);
  assert.equal(obj.id, p.id);
  assert.match(obj.id, /^urn:uuid:/);
  assert.equal(obj.statement, replacement);
  assert.equal(obj.kind, "local");
  assert.equal(obj.confirmedByEducator, true);
  assert.equal(obj.provenance.turnRef, d.ref);
  assert.equal(obj.renamedFrom.originalStatement, "Vague outcome.");

  // Renaming the same statement again is refused (that would be an accept).
  assert.throws(
    () => ctx.gate.confirmObjectives({ provenance: ctx.say("rename again").prov, decisions: [{ verb: "rename", proposalId: p.id, statement: replacement }] }),
    (e) => e.code === "STATEMENT_UNCHANGED" || e.code === "ALREADY_DECIDED",
  );
});

test("(iv) rename of a public proposal keeps the Marble reference as metadata, not as identity", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [p] = ctx.gate.proposeObjectives([
    { kind: "public", publicId: "mt_0007", alignment: { publicId: "mt_0007", relationship: "closeMatch" } },
  ]);
  assert.match(p.id, /^urn:uuid:/); // local id even for public proposals
  const [decision] = ctx.gate.confirmObjectives({
    provenance: ctx.say("Rename with my own wording.").prov,
    decisions: [{ verb: "rename", proposalId: p.id, statement: "Teacher wording for the Marble outcome." }],
  });
  const obj = ctx.gate.getObjective(decision.targetId);
  assert.equal(obj.kind, "public");
  assert.equal(obj.publicId, "mt_0007");
  assert.equal(obj.statement, "Teacher wording for the Marble outcome.");
  assert.equal(obj.alignment.confirmedByEducator, true);
});

test("(iv) rename keeps the objective id stable so a plan citing it needs no revision", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [p] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Vague outcome." }]);
  const replacement = "Teacher wording for the outcome.";
  const [decision] = ctx.gate.confirmObjectives({
    provenance: ctx.say(`Rename it to: ${replacement}`).prov,
    decisions: [{ verb: "rename", proposalId: p.id, statement: replacement }],
  });
  assert.equal(decision.targetId, p.id); // stable identity (URN, stable)

  // A plan citing the original id stays valid across the rename — identity is
  // the URN, not the wording.
  ctx.gate.proposeLessonPlan({ title: "Lesson 1", activities: [activity([p.id])] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Plan confirmed.").prov });
  assert.equal(ctx.gate.currentPlan().status, "confirmed");
  const v1 = ctx.gate.publish({ provenance: ctx.say("Publish.").prov });
  assert.equal(v1.version, 1);
  assert.equal(v1.objectiveRefs.length, 1);
});

/* ----------------------------------- (v) ---------------------------------- */

test("(v) add mints a new local objective whose id is not an mt_* id", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [decision] = ctx.gate.confirmObjectives({
    provenance: ctx.say("Add an outcome of my own.").prov,
    decisions: [
      {
        verb: "add",
        statement: "Explain what a false positive is, in your own words.",
        alignment: { publicId: "mt_4242", relationship: "relatedTo" },
      },
    ],
  });

  assert.match(decision.targetId, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.doesNotMatch(decision.targetId, /^mt_/);
  const obj = ctx.gate.getObjective(decision.targetId);
  assert.equal(obj.kind, "local");
  assert.equal(obj.statement, "Explain what a false positive is, in your own words.");
  assert.equal(obj.confirmedByEducator, true);
  assert.equal(obj.proposedBy, "teacher");
  assert.equal(obj.alignment.publicId, "mt_4242");
  assert.equal(obj.alignment.relationship, "relatedTo");
  assert.equal(obj.alignment.confirmedByEducator, true);

  // Public proposals too: state is never keyed on mt_* alone.
  const [pub] = ctx.gate.proposeObjectives([{ kind: "public", publicId: "mt_0007" }]);
  assert.match(pub.id, /^urn:uuid:/);
  assert.notEqual(pub.id, pub.publicId);
  // Two proposals referencing the same Marble id stay distinct records.
  const [pub2] = ctx.gate.proposeObjectives([{ kind: "public", publicId: "mt_0007" }]);
  assert.notEqual(pub2.id, pub.id);
});

/* ---------------------------------- (vi) ---------------------------------- */

test("(vi) drop removes the objective from the confirmed set and re-blocks publish", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA, pB] = ctx.gate.proposeObjectives([
    { kind: "local", statement: "Outcome A." },
    { kind: "local", statement: "Outcome B." },
  ]);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept both.").prov,
    decisions: [
      { verb: "accept", proposalId: pA.id },
      { verb: "accept", proposalId: pB.id },
    ],
  });
  ctx.gate.proposeLessonPlan({ title: "Lesson 1", activities: [activity([pA.id, pB.id])] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Plan confirmed.").prov });
  const v1 = ctx.gate.publish({ provenance: ctx.say("Publish.").prov });
  assert.equal(v1.version, 1);
  assert.equal(v1.objectiveRefs.length, 2);

  // Teacher changes their mind AFTER publish: drop B.
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Drop the second objective after all.").prov,
    decisions: [{ verb: "drop", proposalId: pB.id }],
  });

  // Removed from the confirmed set…
  assert.equal(ctx.gate.getObjective(pB.id), null);
  assert.equal(ctx.gate.confirmedObjectives().some((o) => o.id === pB.id), false);
  // …the plan that referenced it is invalidated and its checkpoint reopened…
  assert.equal(ctx.gate.currentPlan().status, "invalidated");
  assert.equal(ctx.gate.checkpoints().plan.status, "open");
  // …and publish is blocked again.
  const status = ctx.gate.publishStatus();
  assert.equal(status.canPublish, false);
  assert.ok(status.blockers.length > 0);
  assert.throws(
    () => ctx.gate.publish({ provenance: ctx.say("Publish anyway.").prov }),
    (e) => e instanceof PublishBlockedError && e.blockers.length > 0,
  );

  // Re-confirming the SAME plan does not help while it still cites B.
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Confirm the old plan again.").prov });
  assert.equal(ctx.gate.publishStatus().canPublish, false);

  // A fixed plan (citing only confirmed objectives) can publish as version 2;
  // version 1 is never overwritten and still reflects what was published then.
  ctx.gate.proposeLessonPlan({ title: "Lesson 1 (fixed)", activities: [activity([pA.id])] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Fixed plan confirmed.").prov });
  const v2 = ctx.gate.publish({ provenance: ctx.say("Publish version 2.").prov });
  assert.equal(v2.version, 2);
  assert.equal(v2.previousVersion, 1);
  assert.equal(ctx.gate.getVersion(1).objectiveRefs.length, 2);
  assert.equal(ctx.gate.getVersion(2).objectiveRefs.length, 1);
  assert.equal(Object.isFrozen(ctx.gate.getVersion(1)), true);
  assert.throws(() => {
    ctx.gate.getVersion(1).version = 99;
  }, TypeError);
});

test("drop of a never-accepted proposal keeps it out of the confirmed set", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [p] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Nope." }]);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Drop it.").prov,
    decisions: [{ verb: "drop", proposalId: p.id }],
  });
  assert.equal(ctx.gate.getObjective(p.id), null);
  assert.equal(ctx.gate.confirmedObjectives().length, 0);
  // A dropped proposal cannot be revived by a later accept.
  assert.throws(
    () => ctx.gate.confirmObjectives({ provenance: ctx.say("Accept it after all.").prov, decisions: [{ verb: "accept", proposalId: p.id }] }),
    (e) => e.code === "ALREADY_DECIDED",
  );
});

/* ------------------------------- idempotency ------------------------------ */

test("confirm calls are idempotent; conflicting re-decisions are rejected", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);

  // Same call, same teacher turn → same decision records, no double-apply.
  const acceptProv = ctx.provFor(ctx.teacherSay("Accept A."));
  const first = ctx.gate.confirmObjectives({ provenance: acceptProv, decisions: [{ verb: "accept", proposalId: pA.id }] });
  const second = ctx.gate.confirmObjectives({ provenance: acceptProv, decisions: [{ verb: "accept", proposalId: pA.id }] });
  assert.equal(first[0].id, second[0].id);
  assert.equal(ctx.gate.decisions().length, 1);
  assert.equal(ctx.gate.confirmedObjectives().length, 1);

  // A different turn cannot decide the same proposal again.
  assert.throws(
    () => ctx.gate.confirmObjectives({ provenance: ctx.say("Accept A again.").prov, decisions: [{ verb: "accept", proposalId: pA.id }] }),
    (e) => e.code === "ALREADY_DECIDED",
  );

  // add is idempotent per (turn, statement): one mint, not two.
  const addProv = ctx.provFor(ctx.teacherSay("Add outcome B."));
  const add = { verb: "add", statement: "Outcome B." };
  const a1 = ctx.gate.confirmObjectives({ provenance: addProv, decisions: [add] });
  const a2 = ctx.gate.confirmObjectives({ provenance: addProv, decisions: [add] });
  assert.equal(a1[0].id, a2[0].id);
  assert.equal(ctx.gate.confirmedObjectives().length, 2);

  // Plan confirmation and publish are idempotent too.
  ctx.gate.proposeLessonPlan({ title: "Lesson 1", activities: [activity([pA.id])] });
  const planProv = ctx.provFor(ctx.teacherSay("Plan confirmed."));
  ctx.gate.confirmLessonPlan({ provenance: planProv });
  assert.equal(ctx.gate.confirmLessonPlan({ provenance: planProv }).status, "confirmed");

  const pubProv = ctx.provFor(ctx.teacherSay("Publish."));
  const v1 = ctx.gate.publish({ provenance: pubProv });
  const v1again = ctx.gate.publish({ provenance: pubProv });
  assert.equal(v1.version, 1);
  assert.equal(v1again.version, 1);
  assert.equal(ctx.gate.versions().length, 1);
});

/* ------------------------- version binding (contract) --------------------- */

test("confirmations bind to CoursePackage versions; publishes bump and never overwrite", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);
  const [decV1] = ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept A.").prov,
    decisions: [{ verb: "accept", proposalId: pA.id }],
  });
  assert.equal(decV1.boundCourseVersion, 1); // will land in version 1

  ctx.gate.proposeLessonPlan({ title: "Lesson 1", activities: [activity([pA.id])] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Plan confirmed.").prov });
  ctx.gate.publish({ provenance: ctx.say("Publish v1.").prov });

  // A post-publish teacher decision binds to the NEXT version.
  const [decV2] = ctx.gate.confirmObjectives({
    provenance: ctx.say("Add outcome C.").prov,
    decisions: [{ verb: "add", statement: "Outcome C." }],
  });
  assert.equal(decV2.boundCourseVersion, 2);

  ctx.gate.proposeLessonPlan({ title: "Lesson 2", activities: [activity([pA.id, decV2.targetId])] });
  ctx.gate.confirmLessonPlan({ provenance: ctx.say("Plan 2 confirmed.").prov });
  ctx.gate.publish({ provenance: ctx.say("Publish v2.").prov });

  assert.equal(ctx.gate.versions().map((v) => v.version).join(","), "1,2");
  // Version 1 is the frozen record of what was confirmed THEN.
  assert.equal(ctx.gate.getVersion(1).objectiveRefs.length, 1);
  assert.equal(ctx.gate.getVersion(1).objectiveRefs[0].id, pA.id);
  assert.equal(ctx.gate.getVersion(2).objectiveRefs.length, 2);
});

/* --------------------- PR #15 composition (receipts vs gates) ------------- */

test("PR #15 composition: outline checkpoint needs an observed draftAuthorization; receipts are not decisions", () => {
  const ctx = makeCtx({ withGuard: true });
  ctx.gate.confirmCheckpoint("files", ctx.say("Files ok.").prov);

  // prepare_outline round 1: clarifying — receipt issued, questions asked.
  ctx.hostGuard.onPrepareOutlineResult({
    state: "clarifying",
    questionIds: ["topic", "course", "audience", "learning_outcomes"],
    receipt: "rcpt-1",
  });
  // A receipt obtained without asking is NOT a teacher decision: the outline
  // checkpoint cannot be confirmed yet (no draftAuthorization observed).
  const early = ctx.say("Outline is fine.");
  assert.throws(
    () => ctx.gate.confirmCheckpoint("outline", early.prov),
    (e) => e instanceof ConfirmGateError && e.code === "MISSING_DRAFT_AUTHORIZATION",
  );

  // Residual rule: teacher actually replies → receipt armed → second call ok.
  assert.equal(ctx.hostGuard.beforePrepareOutline({ receipt: "rcpt-1" }).code, "RECEIPT_NOT_ARMED");
  ctx.hostGuard.onTeacherReply("Topic: AI literacy. Course: gathering demo. Ages 7-9. Outcomes: build and explain.", { via: ctx.via });
  assert.equal(ctx.hostGuard.beforePrepareOutline({ receipt: "rcpt-1" }).allowed, true);
  ctx.hostGuard.onPrepareOutlineResult({ state: "ready_to_draft", echoedReceipt: "rcpt-1", draftAuthorization: "da-1" });
  assert.equal(ctx.hostGuard.hasDraftAuthorization(), true);

  // Now the teacher's outline confirmation (with provenance) closes checkpoint 2.
  ctx.gate.confirmCheckpoint("outline", ctx.say("Outline confirmed.").prov);
  assert.equal(ctx.gate.checkpoints().outline.status, "confirmed");

  // And tool state is still not a decision: the objectives gate works as usual.
  const [p] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);
  assert.equal(p.confirmedByEducator, false);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept A.").prov,
    decisions: [{ verb: "accept", proposalId: p.id }],
  });
  assert.equal(ctx.gate.getObjective(p.id).confirmedByEducator, true);
});

/* ------------------------------ schema guards ----------------------------- */

test("student chat is rejected as evidence; activities must cite objectives", () => {
  const ctx = makeCtx();
  walkToPlan(ctx);
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept A.").prov,
    decisions: [{ verb: "accept", proposalId: pA.id }],
  });
  assert.throws(
    () => ctx.gate.proposeLessonPlan({ title: "L", activities: [{ ...activity([pA.id]), evidenceIfAny: "chat" }] }),
    (e) => e instanceof ConfirmGateError && e.code === "BAD_PLAN" && /chat is not evidence/.test(e.message),
  );
  assert.throws(
    () => ctx.gate.proposeLessonPlan({ title: "L", activities: [{ ...activity([]) }] }),
    (e) => e.code === "BAD_PLAN",
  );
  assert.throws(
    () => ctx.gate.proposeLessonPlan({ title: "L", activities: [activity(["urn:uuid:00000000-0000-4000-8000-000000000000"])] }),
    (e) => e.code === "UNKNOWN_OBJECTIVE",
  );
});
