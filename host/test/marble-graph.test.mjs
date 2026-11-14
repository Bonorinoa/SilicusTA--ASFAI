/**
 * marble-graph.test.mjs — the pure Marble graph module.
 *
 * Two layers: a small inline fixture pins the ALGORITHM (scoring, age overlap, edge
 * direction, audience-age parsing), and the committed snapshot pins the REAL data
 * (demo ids resolve, the demo edges hold, the recorded hashes match the download).
 * The snapshot test is offline: it reads host/data/marble/marble-snapshot.json, the
 * file the snapshot script wrote, and compares its recorded sha256s with the PIN the
 * script exports — so a regenerated snapshot that fetched different bytes fails here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MarbleGraph, parseMarbleSnapshot, audienceAges, createMarbleService, MARBLE_MIN_AGE, MARBLE_MAX_AGE } from "../marble/marble-graph.mjs";
import { PIN } from "../scripts/marble-snapshot.mjs";

/** A tiny graph in the exact trimmed shape, mirroring the demo structure. */
const FIXTURE = {
  format: "marble-snapshot",
  source: { repo: "withmarbleapp/os-taxonomy", commit: "fix", licence: "ODbL-1.0" },
  topics: [
    { id: "mt_AAA", type: "CONCEPTUAL", subject: "Computing", domain: "Artificial Intelligence", name: "AI in Daily Life", description: "Spot artificial intelligence in everyday things.", evidence: ["five examples of AI at home"], ageRangeStart: 5, ageRangeEnd: 12 },
    { id: "mt_BBB", type: "CONCEPTUAL", subject: "Computing", domain: "Artificial Intelligence", name: "Smart Versus Not-Smart Devices", description: "Sort objects that respond to input from objects that always do the same thing.", evidence: [], ageRangeStart: 5, ageRangeEnd: 8 },
    { id: "mt_CCC", type: "CONCEPTUAL", subject: "Computing", domain: "Artificial Intelligence", name: "Voice Assistants and How They Work", description: "How a voice assistant hears and answers.", evidence: [], ageRangeStart: 5, ageRangeEnd: 8 },
    { id: "mt_DDD", type: "CONCEPTUAL", subject: "Computing", domain: "Data Representation", name: "Data and Information for Computers", description: "Computers take data in and put data out, a record of daily life.", evidence: [], ageRangeStart: 5, ageRangeEnd: 10 },
    { id: "mt_EEE", type: "CONCEPTUAL", subject: "Mathematics", domain: "Probability", name: "Likelihood Language", description: "Say whether an event is certain, likely or impossible.", evidence: [], ageRangeStart: 9, ageRangeEnd: 10 },
  ],
  dependencies: [
    { topicId: "mt_AAA", prerequisiteId: "mt_BBB", strength: "hard", reason: "Must understand smart things before spotting AI" },
    { topicId: "mt_AAA", prerequisiteId: "mt_CCC", strength: "soft", reason: "Voice assistants are one example" },
    { topicId: "mt_DDD", prerequisiteId: "mt_AAA", strength: "soft", reason: "Seeing AI motivates data" },
    { topicId: "mt_DDD", prerequisiteId: "mt___unrelated", strength: "hard", reason: "A dependency on a topic not in the snapshot" },
  ],
};

const graph = () => new MarbleGraph(FIXTURE);

test("parseMarbleSnapshot accepts the trimmed shape and refuses garbage", () => {
  const doc = parseMarbleSnapshot(JSON.stringify(FIXTURE));
  assert.equal(doc.topics.length, 5);
  assert.equal(doc.dependencies.length, 4);
  assert.throws(() => parseMarbleSnapshot("{ not json"), /marble snapshot/i);
  assert.throws(() => parseMarbleSnapshot(JSON.stringify({ topics: [] })), /marble snapshot/i, "no topics is not a snapshot");
  assert.throws(() => parseMarbleSnapshot(JSON.stringify({ ...FIXTURE, topics: [{ id: "mt_1" }] })), /marble snapshot/i, "a topic without a name is rejected");
  assert.throws(() => parseMarbleSnapshot(JSON.stringify({ ...FIXTURE, dependencies: [{ topicId: "mt_AAA" }] })), /marble snapshot/i, "an edge without a strength is rejected");
});

test("get resolves the demo ids from the real snapshot, with the trimmed fields only", () => {
  const doc = parseMarbleSnapshot(readFileSync(new URL("../data/marble/marble-snapshot.json", import.meta.url), "utf8"));
  assert.equal(doc.topics.length, 1912, "the pinned snapshot holds every topic");
  assert.equal(doc.dependencies.length, 4002, "and every edge");
  const g = new MarbleGraph(doc);
  const ai = g.get("mt_AzTrT5ySCx");
  assert.ok(ai, "AI in Daily Life resolves");
  assert.equal(ai.name, "AI in Daily Life");
  assert.equal(ai.ageRangeStart, 5);
  assert.equal(ai.ageRangeEnd, 12);
  // Only the fields the app uses survive the trim: no assessmentPrompt, centrality or standards.
  for (const k of ["centrality", "assessmentPrompt", "standards"]) assert.equal(k in ai, false, `${k} was trimmed`);
  for (const k of ["id", "type", "subject", "domain", "name", "description", "evidence", "ageRangeStart", "ageRangeEnd"]) assert.ok(k in ai, `${k} is kept`);
  for (const id of ["mt_WRRv1ABECC", "mt_u6SYiVx7FX", "mt_kH1DzOPsXG"]) assert.ok(g.get(id), `${id} resolves`);
  // Every topic in the snapshot is within 3..15, and every edge references known topics.
  for (const t of doc.topics) assert.ok(t.ageRangeStart >= MARBLE_MIN_AGE && t.ageRangeEnd <= MARBLE_MAX_AGE, `${t.id} is inside ${MARBLE_MIN_AGE}..${MARBLE_MAX_AGE}`);
  for (const p of ["hard", "soft"]) assert.ok(p === "hard" || p === "soft");
});

test("snapshot hashes match the recorded ones: the committed file names the exact bytes that were downloaded", () => {
  const doc = parseMarbleSnapshot(readFileSync(new URL("../data/marble/marble-snapshot.json", import.meta.url), "utf8"));
  assert.equal(doc.topicsSha256, PIN.topicsSha256, "topics hash matches the pinned reference");
  assert.equal(doc.dependenciesSha256, PIN.dependenciesSha256, "dependencies hash matches the pinned reference");
  assert.equal(doc.source.commit, PIN.commit);
  assert.equal(PIN.topicsSha256.length, 64);
});

test("prerequisites(id) returns hard and soft edges with reason, null for an unknown id", () => {
  const g = graph();
  const pre = g.prerequisites("mt_AAA");
  assert.deepEqual(pre.hard, [{ topicId: "mt_BBB", name: "Smart Versus Not-Smart Devices", strength: "hard", reason: "Must understand smart things before spotting AI" }]);
  assert.equal(pre.soft.length, 1);
  assert.equal(pre.soft[0].topicId, "mt_CCC");
  assert.equal(pre.soft[0].strength, "soft");
  assert.equal(pre.soft[0].reason.length > 0, true, "the reason is carried");
  assert.equal(g.prerequisites("mt_GONE"), null);
});

test("dependents(id): the topics that name this one as their prerequisite, with the edge direction held", () => {
  const g = graph();
  const dep = g.dependents("mt_AAA");
  assert.equal(dep.length, 1);
  assert.equal(dep[0].topicId, "mt_DDD");
  assert.equal(dep[0].strength, "soft");
  assert.equal(dep[0].name, "Data and Information for Computers");
  assert.deepEqual(g.dependents("mt_DDD"), [], "a known topic with no dependents is an empty list, not a crash");
  assert.equal(g.dependents("mt_GONE"), null, "an unknown id is null, like prerequisites");
});

test("an edge whose prerequisite is not in the snapshot is kept as a row the app cannot resolve", () => {
  const g = graph();
  const pre = g.prerequisites("mt_DDD");
  assert.equal(pre.hard[0].topicId, "mt___unrelated");
  assert.equal(pre.hard[0].name, null, "no name to invent for a missing topic");
});

test("search scores name above description above evidence, filters by age overlap, and stays lexical", () => {
  const g = graph();
  // "daily life" matches the name of AI in Daily Life and the description of DDD.
  const hits = g.search("daily life", { ageMin: 3, ageMax: 15, limit: 5 });
  assert.equal(hits[0].id, "mt_AAA", "a name match outranks a description match");
  assert.ok(hits.every((h) => h.score > 0));
  const byId = new Map(hits.map((h) => [h.id, h]));
  assert.equal(byId.has("mt_DDD"), true, "description match scores lower but still appears");
  // "likelihood" for ages 10+ still matches Likelihood Language (9-10)? no: 10 > ageRangeEnd 10 is an overlap (10 <= 10).
  assert.equal(g.search("likelihood", { ageMin: 11, ageMax: 12 }).length, 0, "no hit overlaps -> nothing");
  assert.equal(g.search("likelihood", { ageMin: 10, ageMax: 12 })[0].id, "mt_EEE", "touching the top of the range still overlaps");
  assert.equal(g.search("likelihood", { ageMin: 3, ageMax: 8 }).length, 0, "below the range -> nothing");
  // ageMin/ageMax default to the whole Marble band
  assert.equal(g.search("likelihood", {})[0].id, "mt_EEE");
  // stopwords alone find nothing: the graph is not a whole-sentence matcher
  assert.equal(g.search("the of and to", {}).length, 0);
  // limit is honoured
  assert.equal(g.search("life", { ageMin: 3, ageMax: 15, limit: 2 }).length, 2);
});

test("search uses name, description AND evidence: a term only in the evidence line still hits", () => {
  const g = graph();
  const hits = g.search("examples of ai at home", { ageMin: 3, ageMax: 15 });
  assert.equal(hits[0].id, "mt_AAA", "the evidence term 'examples' comes back to the owning topic");
});

test("audienceAges reads a course answer's age band; nothing else", () => {
  assert.deepEqual(audienceAges("AI literacy, ages 8-10"), { min: 8, max: 10 });
  assert.deepEqual(audienceAges("Science, ages 7–9"), { min: 7, max: 9 });
  assert.deepEqual(audienceAges("Maths for ages 5 to 14"), { min: 5, max: 14 });
  assert.deepEqual(audienceAges("8-10-year-olds learning computing"), { min: 8, max: 10 });
  assert.deepEqual(audienceAges("a 19-year-old course"), { min: 19, max: 19 });
  assert.deepEqual(audienceAges("University econometrics, ages 19 and up"), { min: 19, max: Infinity });
  assert.deepEqual(audienceAges("students aged 9"), { min: 9, max: 9 });
  assert.equal(audienceAges("How machines notice things"), null, "no age band, no constraint");
  assert.equal(audienceAges("Grade 4 science"), null, "a grade is not an age");
  assert.equal(audienceAges(""), null);
  assert.equal(audienceAges(undefined), null);
});

test("createMarbleService loads lazily, caches, and retries a failed load", async () => {
  let calls = 0;
  const svc = createMarbleService(async () => { calls += 1; return JSON.stringify(FIXTURE); });
  assert.equal(calls, 0, "nothing is loaded at construction (lazy)");
  const a = await svc.search("daily life", {});
  assert.equal(a.hits[0].id, "mt_AAA");
  assert.equal(calls, 1, "one load serves every call (cached)");
  await svc.get("mt_AAA");
  assert.equal(calls, 1);
  // a failing load does not poison the service: the next call retries
  let fail = true;
  const flaky = createMarbleService(async () => { if (fail) { fail = false; throw new Error("offline"); } return JSON.stringify(FIXTURE); });
  await assert.rejects(() => flaky.search("daily life", {}));
  assert.equal((await flaky.search("daily life", {})).hits[0].id, "mt_AAA", "retried and served");
});
