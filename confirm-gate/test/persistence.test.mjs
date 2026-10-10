/**
 * persistence.test.mjs — the replay seam (Silicus TA 3.0, Sprint 1).
 *
 * Durable course state is event-sourced: the host appends every mutation to an
 * event log and rebuilds gate state by replaying it. Replay is only exact if
 * local ids and timestamps are reproducible, which is why ConfirmGate takes an
 * injectable `idFactory` (see deterministicIdFactory) and an injectable clock.
 *
 * This file is the proof of the seam, and its falsification:
 *   1. the deterministic factory yields identical ids across runs;
 *   2. replaying a recorded event log reproduces state byte-for-byte;
 *   3. a recorded log replayed with RANDOM ids fails loudly (random is not replayable).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ConfirmGate, deterministicIdFactory } from "../confirm-gate.mjs";
import { TurnLedger } from "../host-guard.mjs";

const SEED = "urn:uuid:course-0001";
const COURSE = "urn:uuid:1f9c1f5e-9ab2-4b2f-a0a2-9c0b1a2d3e4f";
const OWNER = "teacher:tk-1";
const CHANNEL = "silicus-host";
const TITLE = "Lesson 3 | AI literacy";

/** A fresh gate on its own ledger; `clock` reads a mutable per-op time. */
function freshGate(idFactory) {
  let now = 0;
  const ledger = new TurnLedger({ clock: () => now });
  const teacher = ledger.teacherChannel({ teacherId: OWNER, channel: CHANNEL });
  const gate = new ConfirmGate({
    courseId: COURSE,
    owner: OWNER,
    title: TITLE,
    ledger,
    clock: () => now,
    ...(idFactory ? { idFactory } : {}),
  });
  const prov = (turnRef, decidedAt) => ({ turnRef, decidedBy: OWNER, channel: CHANNEL, decidedAt });
  return { gate, teacher, setNow: (t) => { now = t; }, prov };
}

const PLAN_SPEC = (p1, p2, addedId) => ({
  title: "Seeing the claim: how AI answers are built",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    {
      title: "Spotting the claim",
      minutes: 20,
      objectiveIds: [p1, p2],
      learnerDoes: "Read one AI answer and mark the sentence that makes a claim.",
      teacherDoes: "Ask what would count as evidence for it.",
      evidenceIfAny: "observation",
    },
    {
      title: "Ask one honest question",
      minutes: 20,
      objectiveIds: [addedId],
      learnerDoes: "Write one question about how the tool reached its answer.",
      teacherDoes: "Collect the questions for next lesson.",
      evidenceIfAny: "work-product",
    },
  ],
});

/**
 * Drive a gate through the one-teacher flow and emit the HOST-SHAPED event log
 * (literal ids, one timestamp per event: the host uses a fixed clock per op).
 */
function authorLog(idFactory) {
  const { gate, teacher, setNow, prov } = freshGate(idFactory);
  const log = [];

  setNow(1000);
  const t1 = teacher.say("Confirm the material list.", 1000);
  gate.confirmCheckpoint("files", prov(t1, 1000));
  log.push({ kind: "checkpoint", id: "files", turnText: "Confirm the material list.", at: 1000 });

  setNow(2000);
  const t2 = teacher.say("Confirm the outline.", 2000);
  gate.confirmCheckpoint("outline", prov(t2, 2000));
  log.push({ kind: "checkpoint", id: "outline", turnText: "Confirm the outline.", at: 2000 });

  setNow(3000);
  const items = [
    { kind: "local", statement: "Students can explain what an algorithm is." },
    { kind: "public", publicId: "mt_alpha", statement: "Learners can find the claim in an AI answer." },
  ];
  const [p1, p2] = gate.proposeObjectives(items).map((r) => r.id);
  log.push({ kind: "propose", items, at: 3000 });

  const RENAME = "Learners can find the claim in an AI answer and name what evidence would back it up.";
  const ADD = "Students can ask one honest question about how an AI tool works.";
  setNow(4000);
  const t3 = teacher.say("Decide the proposals.", 4000);
  gate.confirmObjectives({
    provenance: prov(t3, 4000),
    decisions: [
      { verb: "accept", proposalId: p1 },
      { verb: "rename", proposalId: p2, statement: RENAME },
      { verb: "add", statement: ADD },
    ],
  });
  const addedId = gate.decisions().find((d) => d.verb === "add").targetId;
  log.push({ kind: "decide", turnText: "Decide the proposals.", at: 4000, decisions: [
    { verb: "accept", proposalId: p1 },
    { verb: "rename", proposalId: p2, statement: RENAME },
    { verb: "add", statement: ADD },
  ] });

  setNow(5000);
  const spec = PLAN_SPEC(p1, p2, addedId);
  const plan = gate.proposeLessonPlan(spec);
  log.push({ kind: "proposePlan", at: 5000, spec });

  setNow(6000);
  const t4 = teacher.say("Confirm the lesson plan.", 6000);
  gate.confirmLessonPlan({ provenance: prov(t4, 6000) });
  log.push({ kind: "confirmPlan", at: 6000, planId: plan.id, turnText: "Confirm the lesson plan." });

  setNow(7000);
  const t5 = teacher.say("Publish the course package.", 7000);
  gate.publish({ provenance: prov(t5, 7000), note: "first version" });
  log.push({ kind: "publish", at: 7000, turnText: "Publish the course package.", note: "first version" });

  return { log, ids: { p1, p2, addedId, planId: plan.id } };
}

/** Replay a host-shaped event log into a fresh gate. */
function applyEvents(log, idFactory) {
  const { gate, teacher, setNow, prov } = freshGate(idFactory);
  for (const e of log) {
    setNow(e.at);
    switch (e.kind) {
      case "checkpoint": {
        const turnRef = teacher.say(e.turnText, e.at);
        gate.confirmCheckpoint(e.id, prov(turnRef, e.at));
        break;
      }
      case "propose":
        gate.proposeObjectives(e.items);
        break;
      case "decide": {
        const turnRef = teacher.say(e.turnText, e.at);
        gate.confirmObjectives({ provenance: prov(turnRef, e.at), decisions: e.decisions });
        break;
      }
      case "proposePlan":
        gate.proposeLessonPlan(e.spec);
        break;
      case "confirmPlan": {
        const turnRef = teacher.say(e.turnText, e.at);
        gate.confirmLessonPlan({ planId: e.planId, provenance: prov(turnRef, e.at) });
        break;
      }
      case "publish": {
        const turnRef = teacher.say(e.turnText, e.at);
        gate.publish({ provenance: prov(turnRef, e.at), note: e.note });
        break;
      }
      default:
        throw new Error(`unknown event kind: ${e.kind}`);
    }
  }
  return gate;
}

const fingerprint = (gate) => JSON.stringify({
  checkpoints: gate.checkpoints(),
  decisions: gate.decisions(),
  confirmed: gate.confirmedObjectives(),
  plan: gate.currentPlan(),
  versions: gate.versions(),
  publish: gate.publishStatus(),
}, null, 2);

test("deterministic id factory yields identical ids across independent runs", () => {
  const a = authorLog(deterministicIdFactory(SEED));
  const b = authorLog(deterministicIdFactory(SEED));
  assert.deepEqual(b.ids, a.ids, "same seed + same call order must mint the same ids");
  assert.match(a.ids.p1, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.notEqual(a.ids.p1, a.ids.p2, "distinct mints must still be distinct ids");
});

test("replaying an event log reproduces gate state byte-for-byte", () => {
  const { log } = authorLog(deterministicIdFactory(SEED));
  const first = fingerprint(applyEvents(log, deterministicIdFactory(SEED)));
  const second = fingerprint(applyEvents(log, deterministicIdFactory(SEED)));
  assert.equal(second, first, "replaying the same log must reproduce identical state");
});

test("a replayed course reaches the same sealed version with the same objectives", () => {
  const { log, ids } = authorLog(deterministicIdFactory(SEED));
  const gate = applyEvents(log, deterministicIdFactory(SEED));
  const versions = gate.versions();
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].previousVersion, null);
  const refIds = versions[0].objectiveRefs.map((o) => o.id).sort();
  assert.deepEqual(refIds, [ids.p1, ids.p2, ids.addedId].sort());
  assert.equal(gate.publishStatus().canPublish, true);
  // A timestamp read on the replayed record equals the one recorded live.
  assert.equal(versions[0].provenance.decidedAt, 7000);
});

test("falsification: the same log replayed with RANDOM ids fails loudly", () => {
  const { log } = authorLog(deterministicIdFactory(SEED));
  // No idFactory -> the gate mints random ids; the recorded proposal ids no
  // longer resolve, so replay cannot forge a decision. This is the reason the
  // seam exists: random ids are not replayable.
  assert.throws(
    () => applyEvents(log, undefined),
    (err) => err.code === "UNKNOWN_PROPOSAL",
  );
});
