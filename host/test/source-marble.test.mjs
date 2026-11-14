/**
 * source-marble.test.mjs — MarbleSource is a KnowledgeSource: local, verifying, grain-guarded.
 *
 * The contract the seam promises (knowledge.mjs): refs in its own namespace, egress null so a
 * course that never touched ASFAI still gets it, canVerify true for membership in the snapshot,
 * a failure degrades to no context, and the label carries the node's age range so neither the
 * worker nor the teacher mistakes a children's node for course content.
 *
 * Grain guard: a course wholly outside ages 3..15 gets NOTHING (a "maximum likelihood" query
 * for a 19-year-old course cites nothing), and a query with hits that do not overlap the
 * course's ages also returns nothing. Since G1b (owner, 14 Nov), an audience the parser cannot
 * place in an age band FAILS CLOSED: no citations at all, never a search of the whole band.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MarbleSource } from "../sources/marble.mjs";
import { createMarbleService } from "../marble/marble-graph.mjs";
import { retrieveAll } from "../knowledge.mjs";

/** Small graph in the trimmed shape; the audience spans 5..12. */
const FIXTURE = {
  format: "marble-snapshot",
  source: { repo: "x", commit: "x", licence: "ODbL-1.0" },
  topics: [
    { id: "mt_AzTrT5ySCx", type: "CONCEPTUAL", subject: "Computing", domain: "Artificial Intelligence", name: "AI in Daily Life", description: "Spot artificial intelligence in everyday things.", evidence: ["identify five examples"], ageRangeStart: 5, ageRangeEnd: 12 },
    { id: "mt_WRRv1ABECC", type: "CONCEPTUAL", subject: "Computing", domain: "Artificial Intelligence", name: "Smart Versus Not-Smart Devices", description: "Sort smart from not-smart things.", evidence: [], ageRangeStart: 5, ageRangeEnd: 8 },
    { id: "mt_u6SYiVx7FX", type: "CONCEPTUAL", subject: "Computing", domain: "Artificial Intelligence", name: "Voice Assistants and How They Work", description: "How a voice assistant hears.", evidence: [], ageRangeStart: 5, ageRangeEnd: 8 },
    { id: "mt_kH1DzOPsXG", type: "CONCEPTUAL", subject: "Computing", domain: "Data Representation", name: "Data and Information for Computers", description: "Computers take data in, put data out.", evidence: [], ageRangeStart: 5, ageRangeEnd: 10 },
    { id: "mt_EEE", type: "CONCEPTUAL", subject: "Mathematics", domain: "Probability", name: "Likelihood Language", description: "Say whether an event is certain, likely or impossible.", evidence: [], ageRangeStart: 9, ageRangeEnd: 10 },
  ],
  dependencies: [
    { topicId: "mt_AzTrT5ySCx", prerequisiteId: "mt_WRRv1ABECC", strength: "hard", reason: "smart first" },
    { topicId: "mt_AzTrT5ySCx", prerequisiteId: "mt_u6SYiVx7FX", strength: "soft", reason: "one example" },
    { topicId: "mt_kH1DzOPsXG", prerequisiteId: "mt_AzTrT5ySCx", strength: "soft", reason: "motivates data" },
  ],
};

const src = (load = async () => JSON.stringify(FIXTURE)) => new MarbleSource({ marble: createMarbleService(load) });

test("the source is local, verifying, and carries its own namespace", async () => {
  const s = src();
  assert.equal(s.id, "marble");
  assert.equal(s.namespace, "marble");
  assert.equal(s.egress, null, "nothing leaves the device: no egress, so no permission is ever needed");
  assert.equal(s.canVerify, true, "membership in the snapshot is a real check");
  assert.equal(s.enabled, true);
  const out = await retrieveAll([s], { topic: "AI in daily life", course: "Computing, ages 5-12", allowEgress: [] });
  assert.ok(out.length > 0, "a no-egress source is consulted for a course that never touched ASFAI");
  assert.ok(out.every((c) => c.source === "marble" && c.ref.startsWith("marble:")));
  assert.equal(out[0].ref, "marble:mt_AzTrT5ySCx", "the strongest overlap leads");
});

test("the retrieval label carries the node's age range, once, like the ASFAI source", async () => {
  const out = await src().retrieve({ topic: "AI in daily life", course: "Computing, ages 5-12", limit: 3 });
  const ai = out.find((c) => c.ref === "marble:mt_AzTrT5ySCx");
  assert.ok(ai, "AI in Daily Life is retrieved");
  assert.match(ai.label, /^AI in Daily Life \(ages 5–12\)$/);
  assert.equal(ai.text, "Spot artificial intelligence in everyday things.", "the description is the untrusted context");
});

test("a citation is verified by membership, and a stranger's ref is reported unknown", async () => {
  const s = src();
  const hits = await s.retrieve({ topic: "AI in daily life", limit: 2 });
  assert.deepEqual(await s.verify({ citations: hits }), { ok: true, unknown: [], checked: true });
  const bad = await s.verify({ citations: [{ ref: "marble:mt_GHOST" }, { ref: "asfai:mt_x" }] });
  assert.equal(bad.checked, true);
  assert.deepEqual(bad.unknown, ["marble:mt_GHOST"], "only its own refs are its business");
});

test("an unloadable snapshot degrades to no context, and verification says it did not check", async () => {
  const s = src(async () => { throw new Error("offline"); });
  assert.deepEqual(await s.retrieve({ topic: "AI" }), []);
  assert.deepEqual(await s.verify({ citations: [{ ref: "marble:mt_x" }] }), { ok: true, unknown: [], checked: false });
});

test("a query for a course with no overlaps returns nothing, even when the words match", async () => {
  const s = src();
  // "maximum likelihood" lexically matches Likelihood Language (9-10), but the course is university age.
  const out = await s.retrieve({ topic: "maximum likelihood", course: "University econometrics, ages 19 and up", limit: 5 });
  assert.deepEqual(out, [], "the wrong grain is a pass for the architecture, not a Marble miss to paper over");
  const yearOld = await s.retrieve({ topic: "maximum likelihood", course: "a 19-year-old course", limit: 5 });
  assert.deepEqual(yearOld, []);
  // G1b C1: the spaced phrasings from the verifier's record are read as bands now, so they also return nothing.
  for (const course of ["19 year olds", "16 to 18 year olds", "17 and 18 year olds", "16–18 year olds", "19 year old students"]) {
    assert.deepEqual(await s.retrieve({ topic: "maximum likelihood", course, limit: 5 }), [], `outside 3–15: ${course}`);
  }
});

test("when the audience ages overlap the Marble band, hits are filtered to that overlap", async () => {
  const s = src();
  // Course ages 5-8: Likelihood Language (9-10) must not appear.
  const out = await s.retrieve({ topic: "likelihood language events", course: "Computing, ages 5-8", limit: 5 });
  assert.ok(!out.some((c) => c.ref === "marble:mt_EEE"), "a node outside the course's ages is not cited");
  // Course ages 9-15: the AI topics (5-12) still overlap.
  const broad = await s.retrieve({ topic: "AI in daily life", course: "Upper primary, ages 12-15", limit: 5 });
  assert.ok(broad.some((c) => c.ref === "marble:mt_AzTrT5ySCx"), "5-12 overlaps 12-15");
});

test("an audience the source cannot read fails closed: no citations at all (C1)", async () => {
  const s = src();
  // The owner's named case: a university phrasing that reads as no age band must NOT fall back to
  // the whole 3–15 graph ("Likelihood Language" is a children's node that would lexically match).
  assert.deepEqual(await s.retrieve({ topic: "maximum likelihood", course: "Econometrics for 2nd-year undergraduates", limit: 5 }), []);
  // Any unreadable text — no number, no "ages", a grade instead of ages — also returns nothing.
  assert.deepEqual(await s.retrieve({ topic: "AI in daily life", course: "How machines notice things", limit: 2 }), []);
  assert.deepEqual(await s.retrieve({ topic: "AI in daily life", course: "Grade 4 science", limit: 2 }), []);
  assert.deepEqual(await s.retrieve({ topic: "AI in daily life", course: "", limit: 2 }), []);
});
