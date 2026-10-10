/**
 * archive.test.mjs — Sprint 2a: an export round-trips through an archive, and the
 * archive refuses a record that no longer matches its own digest.
 *
 * The save discipline mirrors the ASFAI storage resource for a local file store
 * (asfai-storage-local): temp file, atomic replace, REREAD, and report verified
 * only when the comparison succeeds.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { LocalArchive, digestOf } from "../archive.mjs";

const OWNER = "teacher:tk-1";
const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));
const CLARIFY = FX.clarifying.response;
const READY = FX.ready_to_draft.response;
const ITEMS = [{ kind: "local", statement: "Students can explain what an algorithm is." }];

function sealedCourse() {
  const store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-arch-")));
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
  return s;
}

test("an export round-trips through the archive with a verified digest", () => {
  const s = sealedCourse();
  const archive = new LocalArchive(mkdtempSync(join(tmpdir(), "silicus-archives-")));
  const exported = s.export();

  const receipt = archive.save(s.courseId, exported);
  assert.equal(receipt.saved, true);
  assert.equal(receipt.verified, true, "a save is only saved after the read-back matches");
  assert.equal(receipt.digest, digestOf(exported));

  const back = archive.load(s.courseId);
  // The archived form is the JSON of the export: JSON cannot carry `undefined`, so
  // compare against the round-tripped shape (the digest check above is the real
  // guarantee, and it passed).
  assert.deepEqual(back.payload, JSON.parse(JSON.stringify(exported)), "the archive returns exactly what was saved");
  assert.equal(back.digest, receipt.digest);
  assert.equal(archive.verify(s.courseId, receipt.digest).verified, true);
  assert.deepEqual(archive.list(), [s.courseId.replace(/[^A-Za-z0-9._-]/g, "_")]);
});

test("the archived export is complete enough to re-read the record", () => {
  const s = sealedCourse();
  const archive = new LocalArchive(mkdtempSync(join(tmpdir(), "silicus-archives-")));
  archive.save(s.courseId, s.export());
  const back = archive.load(s.courseId);

  assert.equal(back.payload.kind, "silicus.course.export.v1");
  assert.equal(back.payload.versions.length, 1);
  assert.equal(back.payload.versions[0].version, 1);
  assert.equal(back.payload.checkpoints.publish.status, "confirmed");
  assert.equal(back.payload.intake.outlineAuthorized, true);
  assert.equal(back.payload.integrity.head, s.view().integrity.head, "the log's head rides along");
  assert.equal(back.payload.decisions.length, 1);
});

test("the archive refuses a record that no longer matches its digest", () => {
  const s = sealedCourse();
  const archive = new LocalArchive(mkdtempSync(join(tmpdir(), "silicus-archives-")));
  archive.save(s.courseId, s.export());

  const path = join(archive.root, `${s.courseId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.payload.objectives[0].statement = "Students must memorize the teacher's answers.";
  writeFileSync(path, JSON.stringify(record, null, 2));

  assert.throws(() => archive.load(s.courseId), (e) => e.code === "ARCHIVE_DIGEST_MISMATCH");
  assert.throws(() => archive.verify(s.courseId, record.digest), (e) => e.code === "ARCHIVE_DIGEST_MISMATCH");
});

test("an unknown ref is an explicit error, not an empty record", () => {
  const archive = new LocalArchive(mkdtempSync(join(tmpdir(), "silicus-archives-")));
  assert.throws(() => archive.load("urn:uuid:nope"), (e) => e.code === "UNKNOWN_ARCHIVE");
});
