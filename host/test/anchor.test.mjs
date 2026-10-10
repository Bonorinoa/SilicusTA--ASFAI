/**
 * anchor.test.mjs — the out-of-band pin, and why it is the only thing that resolves
 * the trust anchor.
 *
 * The ledger problem: the chain is self-referential, so a writer who recomputes it
 * passes verify(). The fix is a reference the writer cannot reach. These tests show
 * a self-consistent rewrite and a tail truncation, present the host's own verdict
 * (ok:true — still fooled), and then show the PIN catching both.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";

const OWNER = "teacher:tk-1";
const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
const CLARIFY = FX.clarifying.response;
const READY = FX.ready_to_draft.response;
const ITEMS = [{ kind: "local", statement: "Students can explain what an algorithm is." }];

const logPath = (store, id) => join(store.root, id.replace(/[^A-Za-z0-9._-]/g, "_"), "events.ndjson");
const readLog = (store, id) => readFileSync(logPath(store, id), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const writeLog = (store, id, recs) => writeFileSync(logPath(store, id), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");

/** Recompute the whole chain from genesis — exactly what the host itself does. */
function rechain(records) {
  let prev = "genesis";
  for (let i = 0; i < records.length; i += 1) {
    records[i].seq = i + 1;
    records[i].prev = prev;
    records[i].digest = createHash("sha256").update(`${prev}\n${JSON.stringify(records[i].event)}`).digest("hex");
    prev = records[i].digest;
  }
  return records;
}

function sealedCourse() {
  const store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-anchor-")));
  const s = CourseSession.create(store, { owner: OWNER, title: "AI literacy" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  s.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 1500 });
  s.answerIntake({ text: "Topic: how AI answers are built.", at: 1700 });
  s.observeIntake({ state: READY.state, at: 1900 });
  s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 2000 });
  s.proposeObjectives({ items: ITEMS, at: 3000 });
  const [p1] = s.view().proposals.map((r) => r.id);
  s.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }], text: "Accept it.", at: 4000 });
  s.proposeLessonPlan({ spec: { title: "Seeing the claim", activities: [
    { title: "Spotting the claim", minutes: 20, objectiveIds: [p1], learnerDoes: "Mark it.", teacherDoes: "Ask.", evidenceIfAny: "observation" },
  ] }, at: 5000 });
  s.confirmLessonPlan({ text: "Confirm the lesson plan.", at: 6000 });
  s.publish({ text: "Publish the course package.", note: "first version", at: 7000 });
  return { store, session: s };
}

test("the anchor identifies the sealed version and the log at that moment", () => {
  const { session } = sealedCourse();
  const anchor = session.publishAnchor(1);
  assert.equal(anchor.version, 1);
  assert.equal(anchor.courseId, session.courseId);
  assert.equal(anchor.versionDigest.length, 64);
  assert.equal(anchor.events, session.view().integrity.events);
  assert.equal(anchor.head, session.view().integrity.head);
  // A version that does not exist has no anchor.
  assert.equal(session.publishAnchor(2), null);
});

test("the anchor is stable across a restart when nothing changed", () => {
  const { store, session } = sealedCourse();
  const before = session.publishAnchor(1);
  const reloaded = CourseSession.load(store, session.courseId);
  assert.deepEqual(reloaded.publishAnchor(1), before);
});

test("PIN RESOLVES THE ANCHOR: a self-consistent rewrite passes verify() but fails the pin", () => {
  const { store, session } = sealedCourse();
  const pin = session.publishAnchor(1);
  const original = session.view().objectives[0].statement;

  // Rewrite history: reword the objective that version 1 sealed, then recompute the
  // WHOLE chain so it is internally consistent from genesis.
  const records = readLog(store, session.courseId);
  const proposed = records.find((r) => r.event.kind === "objectives.proposed");
  proposed.event.items[0].statement = "Students must memorize the teacher's answers verbatim.";
  writeLog(store, session.courseId, rechain(records));

  const reloaded = CourseSession.load(store, session.courseId);
  // The host's own verdict: still fooled.
  assert.equal(reloaded.verifyLog().ok, true, "verify() cannot see a self-consistent rewrite");
  // The forgery is really served.
  assert.equal(reloaded.view().objectives[0].statement, "Students must memorize the teacher's answers verbatim.");
  assert.notEqual(reloaded.view().objectives[0].statement, original);
  // The pin catches it.
  const after = reloaded.publishAnchor(1);
  assert.notEqual(after.versionDigest, pin.versionDigest, "the pinned copy no longer matches the sealed record");
});

test("PIN RESOLVES THE ANCHOR: a tail truncation passes verify() but the pinned version is gone", () => {
  const { store, session } = sealedCourse();
  const pin = session.publishAnchor(1);
  assert.ok(pin, "we pinned version 1");

  // Drop the publication (and the rest of the tail) — the chain stays valid from genesis.
  const records = readLog(store, session.courseId);
  const publishAt = records.findIndex((r) => r.event.kind === "package.published");
  writeLog(store, session.courseId, records.slice(0, publishAt));

  const reloaded = CourseSession.load(store, session.courseId);
  assert.equal(reloaded.verifyLog().ok, true, "verify() cannot see a truncation");
  assert.equal(reloaded.view().versions.length, 0, "the publication is simply gone");
  assert.equal(reloaded.publishAnchor(1), null, "the pinned version no longer exists — visible only to the pin holder");
});
