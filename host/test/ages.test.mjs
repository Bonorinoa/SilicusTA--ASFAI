/**
 * ages.test.mjs — the structured-ages rules (G2a).
 *
 * The record accepts only `{min, max}` whole years inside 3..99 with min <= max; absent is
 * fine (legacy courses); anything else is a plain-message refusal. The derived stage is set by
 * the YOUNGEST age: 1 under 8, 2 at 8-11, 3 at 12-14, 4 at 15+ (Sarah Chardonnens's SYNAPSE
 * stage, owner decision 14 Nov).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { agesError, stageForAges, COURSE_AGE_MIN, COURSE_AGE_MAX } from "../ages.mjs";

test("agesError accepts the valid shapes and rejects everything else", () => {
  assert.equal(agesError(undefined), null, "absent is a legacy course");
  assert.equal(agesError(null), null);
  assert.equal(agesError({ min: 8, max: 10 }), null);
  assert.equal(agesError({ min: 3, max: 99 }), null, "the full legal band");
  assert.equal(agesError({ min: 15, max: 15 }), null, "a single year is legal");

  assert.equal(agesError({}), "ages.min and ages.max must be whole years");
  assert.equal(agesError({ min: 8 }), "ages.min and ages.max must be whole years");
  assert.equal(agesError({ min: 8.5, max: 10 }), "ages.min and ages.max must be whole years");
  assert.equal(agesError({ min: "8", max: 10 }), "ages.min and ages.max must be whole years");
  assert.equal(agesError({ min: 2, max: 10 }), `ages must stay within ${COURSE_AGE_MIN} and ${COURSE_AGE_MAX}`);
  assert.equal(agesError({ min: 8, max: 100 }), `ages must stay within ${COURSE_AGE_MIN} and ${COURSE_AGE_MAX}`);
  assert.equal(agesError({ min: 10, max: 8 }), "ages.min cannot be older than ages.max");
  assert.equal(agesError([]), "ages must be an object like { min, max }");
  assert.equal(agesError("8-10"), "ages must be an object like { min, max }");
  assert.equal(agesError(8), "ages must be an object like { min, max }");
});

test("stageForAges uses the youngest age, following the owner's bands", () => {
  assert.equal(stageForAges({ min: 3 }), 1);
  assert.equal(stageForAges({ min: 7 }), 1, "under 8 is stage 1");
  assert.equal(stageForAges({ min: 8 }), 2, "8 is the first stage-2 year");
  assert.equal(stageForAges({ min: 11 }), 2);
  assert.equal(stageForAges({ min: 12 }), 3);
  assert.equal(stageForAges({ min: 14 }), 3);
  assert.equal(stageForAges({ min: 15 }), 4, "15 and up is stage 4");
  assert.equal(stageForAges({ min: 99 }), 4);
  // the max never matters: the youngest age sets the stage
  assert.equal(stageForAges({ min: 7, max: 15 }), 1);
  assert.equal(stageForAges({ min: 12, max: 14 }), 3);
  // no structured ages -> no stage (legacy courses are not invented a stage)
  assert.equal(stageForAges({}), null);
  assert.equal(stageForAges(undefined), null);
  assert.equal(stageForAges({ min: "soon" }), null);
});
