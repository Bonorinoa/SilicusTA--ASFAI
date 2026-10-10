/**
 * host-guard.test.mjs — residual rule + turn ledger tests (node:test).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TurnLedger,
  TurnLedgerError,
  TeacherChannel,
  ResidualRuleGuard,
  GUARD_STATE,
} from "../host-guard.mjs";

/** Deterministic monotonic clock. */
function makeClock(start = 1_000_000) {
  let t = start;
  const clock = () => t;
  clock.tick = (ms = 10) => (t += ms);
  return clock;
}

function makeGuard() {
  const clock = makeClock();
  const ledger = new TurnLedger({ clock });
  const guard = new ResidualRuleGuard({ ledger, clock });
  const via = ledger.teacherChannel({ teacherId: "teacher:tk-1", channel: "silicus-ui" });
  return { clock, ledger, guard, via };
}

/* -------------------------------------------------------------------------- */

test("(i) second prepare_outline after state=clarifying is blocked until a teacher turn is observed, allowed after", () => {
  const { guard, via } = makeGuard();
  // Round 1: prepare_outline asks the teacher things the AI cannot answer.
  guard.onPrepareOutlineResult({ state: "clarifying", questionIds: ["topic", "course"], receipt: "rcpt-1" });
  assert.equal(guard.state, GUARD_STATE.CLARIFYING);

  // The residual rule: NO second prepare_outline until the teacher replies.
  const plain = guard.beforePrepareOutline();
  assert.equal(plain.allowed, false);
  assert.equal(plain.code, "AWAITING_TEACHER_REPLY");

  // Echoing the receipt obtained in that round without asking is refused too.
  const echo = guard.beforePrepareOutline({ receipt: "rcpt-1" });
  assert.equal(echo.allowed, false);
  assert.equal(echo.code, "RECEIPT_NOT_ARMED");

  // A genuine teacher turn lands (recorded via the transport's TeacherChannel).
  const turnRef = guard.onTeacherReply("Topic: AI literacy for ages 7-9. Course: Gathering demo.", { via });
  assert.match(turnRef, /^urn:turn:\d+$/);
  assert.equal(guard.state, GUARD_STATE.READY);

  // Now the second prepare_outline is allowed — with the armed receipt.
  const after = guard.beforePrepareOutline({ receipt: "rcpt-1" });
  assert.equal(after.allowed, true);
});

test("(i) an assistant turn never unblocks the residual rule", () => {
  const { guard, ledger } = makeGuard();
  guard.onPrepareOutlineResult({ state: "clarifying", questionIds: ["topic"], receipt: "rcpt-1" });

  // The model "answers" its own questions. This must change nothing.
  ledger.recordAssistantTurn("Let me invent a topic: robotics for teens.");
  assert.equal(guard.state, GUARD_STATE.CLARIFYING);
  assert.equal(guard.beforePrepareOutline().allowed, false);
  assert.equal(guard.beforePrepareOutline({ receipt: "rcpt-1" }).allowed, false);
});

test("(i) the guard re-blocks on a later clarifying round (the rule is per round)", () => {
  const { guard, via } = makeGuard();
  guard.onPrepareOutlineResult({ state: "clarifying", questionIds: ["audience"], receipt: "rcpt-1" });
  guard.onTeacherReply("Ages 7-9.", { via });
  assert.equal(guard.beforePrepareOutline({ receipt: "rcpt-1" }).allowed, true);

  // Second round asks again (e.g. confirm_intake); a new receipt appears.
  guard.onPrepareOutlineResult({ state: "clarifying", questionIds: ["confirm_intake"], receipt: "rcpt-2" });
  assert.equal(guard.beforePrepareOutline({ receipt: "rcpt-2" }).code, "RECEIPT_NOT_ARMED");
  assert.equal(guard.beforePrepareOutline().code, "AWAITING_TEACHER_REPLY");

  guard.onTeacherReply("Confirmed those values.", { via });
  assert.equal(guard.beforePrepareOutline({ receipt: "rcpt-2" }).allowed, true);
});

test("a receipt is single-use once echoed on a call", () => {
  const { guard, via } = makeGuard();
  guard.onPrepareOutlineResult({ state: "clarifying", questionIds: ["topic"], receipt: "rcpt-1" });
  guard.onTeacherReply("Topic is AI literacy.", { via });
  assert.equal(guard.beforePrepareOutline({ receipt: "rcpt-1" }).allowed, true);

  // The host echoes the receipt on the actual call; the result is recorded.
  guard.onPrepareOutlineResult({ state: "ready_to_draft", echoedReceipt: "rcpt-1", draftAuthorization: "da-1" });
  const replay = guard.beforePrepareOutline({ receipt: "rcpt-1" });
  assert.equal(replay.allowed, false);
  assert.equal(replay.code, "RECEIPT_ALREADY_USED");
  assert.equal(guard.hasDraftAuthorization(), true);
});

test("teacher turns can only be recorded through a TeacherChannel of this ledger", () => {
  const { guard, ledger } = makeGuard();
  const otherGuard = new ResidualRuleGuard({ ledger: new TurnLedger() });
  const foreignVia = otherGuard.ledger.teacherChannel({ teacherId: "teacher:tk-1" });

  guard.onPrepareOutlineResult({ state: "clarifying", questionIds: ["topic"] });
  assert.throws(() => guard.onTeacherReply("hello", { via: {} }), (e) => e instanceof TurnLedgerError && e.code === "NOT_A_TEACHER_CHANNEL");
  assert.throws(() => guard.onTeacherReply("hello", { via: foreignVia }), (e) => e.code === "NOT_A_TEACHER_CHANNEL");
  // Still blocked: no valid teacher turn was recorded.
  assert.equal(guard.beforePrepareOutline().allowed, false);

  // An assistant object is not a channel either.
  assert.throws(() => guard.onTeacherReply("hello", { via: ledger.recordAssistantTurn("x") }), (e) => e.code === "NOT_A_TEACHER_CHANNEL");
});

test("ledger enforces roles: only TeacherChannel.say produces a teacher turn", () => {
  const clock = makeClock();
  const ledger = new TurnLedger({ clock });
  const via = ledger.teacherChannel({ teacherId: "teacher:tk-1", channel: "silicus-ui" });

  const t1 = via.say("Confirm the files.");
  const t2 = ledger.recordAssistantTurn("Here are the files.");
  assert.equal(ledger.getTurn(t1).role, "teacher");
  assert.equal(ledger.getTurn(t1).origin, "inbound-user-message");
  assert.equal(ledger.getTurn(t2).role, "assistant");
  assert.equal(ledger.isTeacherTurn(t1), true);
  assert.equal(ledger.isTeacherTurn(t2), false);

  assert.throws(() => ledger.getTurn("urn:turn:99"), (e) => e.code === "UNKNOWN_TURN");
  assert.throws(() => via.say("   "), (e) => e.code === "EMPTY_TURN");
  assert.throws(() => ledger.teacherChannel({ teacherId: "" }), (e) => e.code === "BAD_CHANNEL");
  // Ledger records are frozen provenance material.
  assert.equal(Object.isFrozen(ledger.getTurn(t1)), true);
  assert.equal(Object.isFrozen(ledger.list()), true);
  assert.ok(via instanceof TeacherChannel);
});

test("guard snapshot is a portable frozen decision trace", () => {
  const { guard, via } = makeGuard();
  guard.onPrepareOutlineResult({ state: "clarifying", questionIds: ["topic"], receipt: "rcpt-1" });
  guard.onTeacherReply("Topic is AI literacy.", { via });
  const snap = guard.snapshot();
  assert.equal(Object.isFrozen(snap), true);
  assert.equal(snap.state, GUARD_STATE.READY);
  assert.equal(snap.clarifyingRound.armed, true);
  assert.match(snap.clarifyingRound.armedByTurnRef, /^urn:turn:\d+$/);
  assert.equal(snap.receipts[0].armed, true);
  assert.ok(snap.log.length >= 2);
});
