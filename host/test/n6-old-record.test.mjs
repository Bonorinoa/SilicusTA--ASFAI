/**
 * N6 compatibility: a byte fixture produced at d4258aa, before authorship fields.
 * Old records must replay and export exactly as they did; new fields are additive.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RecordStore, metaText } from "../record-store.mjs";
import { CourseSession } from "../course.mjs";
import { buildBackup, readBackup } from "../backup.mjs";

const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/n6-pre-authorship-record.json", import.meta.url), "utf8"));
const wire = (value) => JSON.parse(JSON.stringify(value));

function oldStore() {
  const courseId = FIXTURE.meta.courseId;
  const store = new RecordStore();
  store.load({
    metas: [{ courseId, text: metaText(FIXTURE.meta) }],
    events: FIXTURE.lines.map((line, i) => ({ courseId, seq: i + 1, line })),
  });
  return store;
}

test("the pre-N6 record verifies and exports byte-for-byte the same view", () => {
  assert.equal(FIXTURE.sourceSha, "d4258aa4a660e6eb072a0ed13de32f69e2ab85e9");
  assert.equal(FIXTURE.lines.some((line) => line.includes("proposedBy")), false);
  assert.equal(FIXTURE.lines.some((line) => line.includes("teacherEditCount")), false);

  const session = CourseSession.load(oldStore(), FIXTURE.meta.courseId);
  assert.deepEqual(session.verifyLog(), {
    ok: true,
    events: FIXTURE.expectedExport.integrity.events,
    head: FIXTURE.expectedExport.integrity.head,
  });
  assert.deepEqual(wire(session.export()), FIXTURE.expectedExport);
  assert.deepEqual(session.publishAnchor(1), FIXTURE.expectedAnchor);
  assert.equal(session.export().plan.editedByTeacher, true, "the pre-N6 host marker remains exactly as before");
  assert.equal(session.export().plan.teacherEditCount, undefined, "an old confirmation is not rewritten with a new count");
});

test("the pre-N6 record survives backup verification and replay without gaining fields", () => {
  const { file, included, skipped } = buildBackup(oldStore(), { at: 1767225600000 });
  assert.equal(included.length, 1);
  assert.deepEqual(skipped, []);

  const [{ courseId, metaText: text, lines }] = readBackup(JSON.stringify(file)).courses;
  const replay = new RecordStore();
  replay.load({
    metas: [{ courseId, text }],
    events: lines.map((line, i) => ({ courseId, seq: i + 1, line })),
  });
  const exported = CourseSession.load(replay, courseId).export();
  assert.deepEqual(wire(exported), FIXTURE.expectedExport);
  assert.equal(exported.plan.teacherEditCount, undefined);
});
