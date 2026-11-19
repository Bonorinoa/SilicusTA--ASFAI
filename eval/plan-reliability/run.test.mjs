import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "./fixtures.mjs";
import { assertCompletePlan, runScripted } from "./run.mjs";

test("the reliability set has exactly twelve named fixtures and covers every required stress shape", () => {
  assert.equal(FIXTURES.length, 12);
  assert.equal(new Set(FIXTURES.map((f) => f.id)).size, 12);
  const tags = new Set(FIXTURES.flatMap((f) => f.tags));
  for (const tag of ["short", "long-many-sources", "fifty-objectives", "non-english-source", "age-stage-1", "age-stage-2", "age-stage-3", "age-stage-4", "age-18-plus", "age-unknown", "l2-hard-adult", "l2-hard-under-18"]) {
    assert.ok(tags.has(tag), `missing fixture tag ${tag}`);
  }
});

test("a complete plan needs activities, positive whole minutes and objective citations", () => {
  const good = { activities: [{ minutes: 20, objectiveIds: ["urn:uuid:o1"] }] };
  assert.doesNotThrow(() => assertCompletePlan(good, "good"));
  assert.throws(() => assertCompletePlan({ activities: [] }, "empty"), /activities/);
  assert.throws(() => assertCompletePlan({ activities: [{ minutes: 0, objectiveIds: ["urn:uuid:o1"] }] }, "minutes"), /minutes/);
  assert.throws(() => assertCompletePlan({ activities: [{ minutes: 20, objectiveIds: [] }] }, "uncited"), /citation/);
});

test("the scripted host finishes all twelve, retries once inside the host, records it, and records a final failure", async () => {
  const result = await runScripted();
  assert.equal(result.mode, "scripted");
  assert.equal(result.finished, 12);
  assert.equal(result.total, 12);
  assert.equal(result.retryProbe.calls, 2);
  assert.deepEqual(result.retryProbe.actions, ["plan.retry", "plan.drafted"]);
  assert.equal(result.finalFailure.calls, 2);
  assert.equal(result.finalFailure.code, "PLAN_DRAFT_FAILED");
  assert.equal(result.finalFailure.message, "Silicus couldn't finish this plan. Try again, or shorten the sources.");
  assert.equal(result.finalFailure.action, "plan.failed");
});
