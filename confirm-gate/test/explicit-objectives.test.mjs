/**
 * explicit-objectives.test.mjs — checkpoint 3 in `explicit` mode (R4).
 *
 * The gate's default stays `"auto"`: the checkpoint confirms itself once every proposal has a teacher
 * decision. With `objectivesConfirm: "explicit"` a decision never confirms it — the teacher closes it with
 * `confirmObjectivesCheckpoint`, which refuses while a proposal waits (OBJECTIVES_PENDING), when nothing is
 * decided (NO_OBJECTIVES) and on an auto-mode course (OBJECTIVES_AUTO). New proposals after a confirm reopen
 * it exactly as in auto mode.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TurnLedger } from "../host-guard.mjs";
import { ConfirmGate, FabricatedConfirmationError } from "../confirm-gate.mjs";

function makeClock(start = 1_000_000) {
  let t = start;
  const clock = () => t;
  clock.tick = (ms = 10) => (t += ms);
  return clock;
}

function makeCtx({ objectivesConfirm = "explicit" } = {}) {
  const clock = makeClock();
  const ledger = new TurnLedger({ clock });
  const gate = new ConfirmGate({
    courseId: "urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    owner: "teacher:tk-1",
    title: "AI literacy, ages 7-9",
    ledger,
    clock,
    objectivesConfirm,
  });
  const via = ledger.teacherChannel({ teacherId: "teacher:tk-1", channel: "silicus-ui" });
  const say = (text) => {
    clock.tick(10);
    const ref = via.say(text);
    clock.tick(10);
    return { ref, prov: { turnRef: ref, decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: clock() } };
  };
  gate.confirmCheckpoint("files", say("These are the materials.").prov);
  gate.confirmCheckpoint("outline", say("The outline is fine.").prov);
  return { clock, ledger, gate, say };
}

const twoProposals = (ctx) =>
  ctx.gate.proposeObjectives([
    { kind: "local", statement: "Outcome A." },
    { kind: "local", statement: "Outcome B." },
  ]);

test("the default mode stays auto: deciding every proposal confirms checkpoint 3", () => {
  const ctx = makeCtx({ objectivesConfirm: "auto" });
  const [pA, pB] = twoProposals(ctx);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept both.").prov,
    decisions: [{ verb: "accept", proposalId: pA.id }, { verb: "accept", proposalId: pB.id }],
  });
  assert.equal(ctx.gate.checkpoints().objectives.status, "confirmed");
});

test("explicit: deciding the last proposal does NOT confirm; the teacher must close it", () => {
  const ctx = makeCtx();
  const [pA, pB] = twoProposals(ctx);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept both.").prov,
    decisions: [{ verb: "accept", proposalId: pA.id }, { verb: "accept", proposalId: pB.id }],
  });
  assert.equal(ctx.gate.checkpoints().objectives.status, "open");
  // Nothing downstream can start on an open checkpoint.
  assert.throws(
    () => ctx.gate.proposeLessonPlan({ title: "L", activities: [{ title: "A", objectiveIds: [pA.id], learnerDoes: "x", teacherDoes: "y" }] }),
    (e) => e.code === "CHECKPOINT_ORDER",
  );
  assert.ok(ctx.gate.publishBlockers().some((b) => b.includes("objectives")));

  const cp = ctx.gate.confirmObjectivesCheckpoint({ provenance: ctx.say("These are my objectives.").prov });
  assert.equal(cp.status, "confirmed");
  assert.equal(cp.provenance.decidedBy, "teacher:tk-1");
  assert.equal(ctx.gate.checkpoints().objectives.status, "confirmed");
});

test("explicit: confirm refuses while a proposal still waits (OBJECTIVES_PENDING)", () => {
  const ctx = makeCtx();
  const [pA] = twoProposals(ctx);
  ctx.gate.confirmObjectives({ provenance: ctx.say("Accept the first.").prov, decisions: [{ verb: "accept", proposalId: pA.id }] });
  assert.throws(
    () => ctx.gate.confirmObjectivesCheckpoint({ provenance: ctx.say("Confirm.").prov }),
    (e) => e.code === "OBJECTIVES_PENDING",
  );
  assert.equal(ctx.gate.checkpoints().objectives.status, "open");
});

test("explicit: confirm refuses when nothing is decided (NO_OBJECTIVES)", () => {
  const ctx = makeCtx();
  const [pA, pB] = twoProposals(ctx);
  // Every proposal decided — but all dropped, so the confirmed set is empty: there is nothing to confirm.
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Drop both.").prov,
    decisions: [{ verb: "drop", proposalId: pA.id }, { verb: "drop", proposalId: pB.id }],
  });
  assert.throws(
    () => ctx.gate.confirmObjectivesCheckpoint({ provenance: ctx.say("Confirm now.").prov }),
    (e) => e.code === "NO_OBJECTIVES",
  );
});

test("explicit: a decision made after the teacher's confirm keeps the checkpoint confirmed (it does not silently reopen)", () => {
  // Pins the actual gate behaviour (the comment at confirm-gate.mjs:623 was corrected to match it): a confirm
  // is a close of the set. A later decision still records, but the checkpoint stays confirmed — the studio says
  // so ("Removing one the plan uses means drafting a new plan"), and the host refuses a plan draft that cites
  // nothing. A new PROPOSAL is what reopens it (below).
  const ctx = makeCtx();
  const [pA, pB] = twoProposals(ctx);
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Accept both.").prov,
    decisions: [{ verb: "accept", proposalId: pA.id }, { verb: "accept", proposalId: pB.id }],
  });
  ctx.gate.confirmObjectivesCheckpoint({ provenance: ctx.say("These are my objectives.").prov });
  // Post-confirm decision: dropping the second.
  ctx.gate.confirmObjectives({
    provenance: ctx.say("Actually drop the second.").prov,
    decisions: [{ verb: "drop", proposalId: pB.id }],
  });
  assert.equal(ctx.gate.checkpoints().objectives.status, "confirmed", "a decision after confirm does not reopen the checkpoint");
  assert.equal(ctx.gate.checkpoints().objectives.note, "the teacher confirmed the objectives", "the confirm note survives the later decision");

  // A new proposal, by contrast, reopens it (auto and explicit behave alike).
  ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome C." }]);
  assert.equal(ctx.gate.checkpoints().objectives.status, "open", "new proposals reopen the checkpoint, in both modes");
});

test("explicit: an auto-mode course refuses the explicit confirm (OBJECTIVES_AUTO)", () => {
  const ctx = makeCtx({ objectivesConfirm: "auto" });
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);
  ctx.gate.confirmObjectives({ provenance: ctx.say("Accept.").prov, decisions: [{ verb: "accept", proposalId: pA.id }] });
  assert.throws(
    () => ctx.gate.confirmObjectivesCheckpoint({ provenance: ctx.say("Confirm.").prov }),
    (e) => e.code === "OBJECTIVES_AUTO",
  );
});

test("explicit: a new proposal after the confirm reopens the checkpoint", () => {
  const ctx = makeCtx();
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);
  ctx.gate.confirmObjectives({ provenance: ctx.say("Accept.").prov, decisions: [{ verb: "accept", proposalId: pA.id }] });
  ctx.gate.confirmObjectivesCheckpoint({ provenance: ctx.say("These are my objectives.").prov });
  assert.equal(ctx.gate.checkpoints().objectives.status, "confirmed");

  ctx.gate.proposeObjectives([{ kind: "local", statement: "Late outcome." }]);
  assert.equal(ctx.gate.checkpoints().objectives.status, "open");
  assert.equal(ctx.gate.publishStatus().canPublish, false);
});

test("explicit: the confirm needs a real teacher turn", () => {
  const ctx = makeCtx();
  const [pA] = ctx.gate.proposeObjectives([{ kind: "local", statement: "Outcome A." }]);
  ctx.gate.confirmObjectives({ provenance: ctx.say("Accept.").prov, decisions: [{ verb: "accept", proposalId: pA.id }] });

  assert.throws(() => ctx.gate.confirmObjectivesCheckpoint({}), (e) => e instanceof FabricatedConfirmationError && e.code === "MISSING_PROVENANCE");
  const aiTurn = ctx.ledger.recordAssistantTurn("Confirm it. (fabricated)");
  assert.throws(
    () => ctx.gate.confirmObjectivesCheckpoint({ provenance: { turnRef: aiTurn, decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: ctx.clock() } }),
    (e) => e.code === "NON_TEACHER_TURN",
  );
  assert.equal(ctx.gate.checkpoints().objectives.status, "open");
});

test("an unknown objectivesConfirm value is refused at construction", () => {
  assert.throws(
    () => new ConfirmGate({ courseId: "urn:uuid:x", owner: "t", objectivesConfirm: "sometimes" }),
    (e) => e.code === "BAD_INPUT",
  );
});
