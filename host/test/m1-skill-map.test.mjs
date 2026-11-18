/**
 * M1 · the skill-map step: ranking input, the judged reply, lanes from real edges, the connected topic in both
 * stores, and the skill map as a transient, credited source for objective proposals. No model: a stub worker.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarbleGraph, createMarbleService, parseMarbleSnapshot } from "../marble/marble-graph.mjs";
import { mapLanes, missingTitleWord, rankInput, validateRanking, lane, MAX_WHY_CHARS } from "../marble/rank-map.mjs";
import { buildRankPrompt, PlanWorker } from "../worker.mjs";
import { createHandler } from "../handler.mjs";
import { CourseSession } from "../course.mjs";
import { CourseStore } from "../store.mjs";
import { RecordStore } from "../record-store.mjs";
import { SCRIPTED_RANKING, scriptedRankMap } from "./scripted-course.mjs";

const SNAP = readFileSync(new URL("../data/marble/marble-snapshot.json", import.meta.url), "utf8");
const g = new MarbleGraph(parseMarbleSnapshot(SNAP));
const AGES = { min: 4, max: 10 };
const TITLE = "Why is the grass green?";

test("rankInput: the topics overlapping ages 4–10, names + subject + domain only (1,599 of 1,912)", () => {
  const input = rankInput(g, AGES);
  assert.equal(g.topicCount, 1912);
  assert.equal(input.length, 1599);
  assert.deepEqual(Object.keys(input[0]).sort(), ["domain", "id", "name", "subject"]);
  const prompt = buildRankPrompt({ title: TITLE, goal: "Why leaves are green", ages: AGES, topics: input });
  assert.match(prompt, /^RANK skill-map topics/);
  assert.match(prompt, /^mt_gLy3ZgZWiN: Reflecting Light$/m);
  assert.doesNotMatch(prompt, /shiny smooth surfaces reflect light best/, "never a description");
  console.log(`rank prompt: ${prompt.length} characters, ${input.length} topics`);
});

test("validateRanking: unknown / out-of-age ids, long threads, a 4th thread and repeats are dropped; why is cleaned to 120", () => {
  const long = "x".repeat(300);
  const raw = { suggestions: [
    { id: "mt_gLy3ZgZWiN", thread: "Light", why: `  two\nlines ${long}` },
    { id: "mt_nope", thread: "Light", why: "unknown" },
    { id: "mt_qzGADV-NGe", thread: "Light", why: "ages 11-12: outside 4-10" },
    { id: "mt_gLy3ZgZWiN", thread: "Light", why: "repeat" },
    { id: "mt_lutxvMlkwS", thread: "y".repeat(41), why: "thread too long" },
    { id: "mt_lutxvMlkwS", thread: "Plants", why: "ok" },
    { id: "mt_nwSWPTENmv", thread: "Senses", why: "ok" },
    { id: "mt_3v0VNkwquK", thread: "Fourth", why: "a fourth thread" },
    { id: 42, thread: "Light" },
  ] };
  const out = validateRanking(raw, g, AGES);
  assert.deepEqual(out.map((s) => s.id), ["mt_gLy3ZgZWiN", "mt_lutxvMlkwS", "mt_nwSWPTENmv"]);
  assert.equal(out[0].why.length, MAX_WHY_CHARS);
  assert.doesNotMatch(out[0].why, /\n/);
  assert.deepEqual(validateRanking({ nonsense: true }, g, AGES), []);
  assert.deepEqual(validateRanking(null, g, AGES), []);
  const eight = validateRanking({ suggestions: rankInput(g, AGES).slice(0, 20).map((t) => ({ id: t.id, thread: "A", why: "" })) }, g, AGES);
  assert.equal(eight.length, 8);
});

test("mapLanes on the scripted ranking: real-edge chains, off-chain suggestions as pills with a true note", () => {
  const sugg = validateRanking(scriptedRankMap(buildRankPrompt({ title: TITLE, goal: "", ages: AGES, topics: rankInput(g, AGES) })), g, AGES);
  assert.equal(sugg.length, SCRIPTED_RANKING.length);
  const m = mapLanes(g, sugg, AGES);
  assert.deepEqual(m.threads.map((t) => t.name), ["Light", "Plants"]);
  const [light, plants] = m.threads;
  assert.deepEqual(light.chain.slice(0, 4), ["mt_YPSx5pbpVl", "mt_4i-FKXDDXh", "mt_gLy3ZgZWiN", "mt_6w2g7aoPgz"]);
  assert.deepEqual(plants.chain.slice(1, 3), ["mt_3v0VNkwquK", "mt_lutxvMlkwS"]);
  assert.deepEqual(light.also, [{ id: "mt_nwSWPTENmv", note: "comes after Body Parts & Senses" }], "a real prerequisite outside the chain");
  assert.deepEqual(plants.also, [{ id: "mt_6xsEXxKdUX", note: "comes after Parts of a Plant" }]);
  // every drawn edge is a real prerequisite edge; the Vocabulary -> Reflecting Light skip is among them
  for (const t of m.threads) for (const e of t.edges) {
    const pre = g.prerequisites(t.chain[e.to]);
    assert.ok([...pre.hard, ...pre.soft].some((r) => r.topicId === t.chain[e.from]));
  }
  assert.ok(light.edges.some((e) => e.from === 0 && e.to === 2), "the skip edge is reported");
  assert.equal(m.topics["mt_gLy3ZgZWiN"].fits, true);
  assert.ok(m.topics["mt_gLy3ZgZWiN"].evidence.length > 0);
  assert.equal(m.suggestions[0].rank, 1);
  const pick = lane(g, "mt_gLy3ZgZWiN", AGES);
  assert.equal(pick.threads[0].name, "Your pick");
  assert.equal(pick.suggestions.length, 0);
});

test("missingTitleWord: 'grass' is in no topic name at 4–10", () => {
  assert.equal(missingTitleWord(g, AGES, TITLE), "grass");
  assert.equal(missingTitleWord(g, AGES, "Reflecting light"), null);
});

const service = createMarbleService(async () => SNAP);
const stubWorker = (reply, usage = { input: 20000, output: 300 }) => ({ enabled: true, rankMap: async () => { if (reply instanceof Error) throw reply; return { raw: reply, usage }; } });
const call = (h, method, url, body) => h.handle({ method, url, readBody: async () => body });

test("POST /api/knowledge/marble/rank: lanes on a good reply; an empty map with a reason (never an error) otherwise", async () => {
  const ok = createHandler({ store: new RecordStore(), worker: stubWorker({ suggestions: SCRIPTED_RANKING }), marble: service });
  const r = await call(ok, "POST", "/api/knowledge/marble/rank", { title: TITLE, goal: "", ages: AGES });
  assert.equal(r.status, 200);
  assert.equal(r.json.threads.length, 2);
  assert.deepEqual(r.json.counts, { fit: 1599, total: 1912 });
  assert.deepEqual(r.json.usage, { input: 20000, output: 300 });
  assert.equal(r.json.reason, null);
  for (const [w, reason] of [[stubWorker({ suggestions: [{ id: "mt_fake", thread: "X", why: "" }] }), "NO_VALID_SUGGESTIONS"], [stubWorker(Object.assign(new Error("x"), { code: "WORKER_UNREACHABLE" })), "WORKER_UNREACHABLE"], [{ enabled: false }, "WORKER_NOT_CONFIGURED"]]) {
    const h = createHandler({ store: new RecordStore(), worker: w, marble: service });
    const e = await call(h, "POST", "/api/knowledge/marble/rank", { title: TITLE, ages: AGES });
    assert.equal(e.status, 200);
    assert.deepEqual(e.json.threads, []);
    assert.equal(e.json.reason, reason);
  }
  const cov = await call(ok, "GET", `/api/knowledge/marble/coverage?min=4&max=10&title=${encodeURIComponent(TITLE)}`);
  assert.equal(cov.json.overlapping, 1599);
  assert.equal(cov.json.total, 1912);
  assert.equal(cov.json.missingWord, "grass");
});

test("PlanWorker.rankMap logs the wire's token counts", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions: [] }) } }], usage: { prompt_tokens: 123, completion_tokens: 45 } }), { status: 200 });
  const w = new PlanWorker({ url: "http://127.0.0.1:1/v1", model: "m", fetchImpl });
  const r = await w.rankMap({ title: TITLE, ages: AGES, topics: [] });
  assert.deepEqual(r.usage, { input: 123, output: 45 });
});

test("marbleConnected: both stores record it identically; the handler refuses a bad one; the view replays it", async () => {
  const at = 1_700_000_000_000;
  const disk = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-m1-")));
  const mem = new RecordStore();
  const args = { courseId: "urn:uuid:m1", owner: "t", title: "T", seed: "urn:uuid:seed", at, ages: AGES, marbleAnchor: "mt_gLy3ZgZWiN", marbleConnected: "mt_lutxvMlkwS" };
  disk.initCourse(args);
  mem.initCourse(args);
  const memSnap = mem.snapshot()[0];
  assert.equal(JSON.parse(memSnap.lines[0]).event.marbleConnected, "mt_lutxvMlkwS");
  assert.equal(disk.log("urn:uuid:m1").read()[0].event.marbleConnected, "mt_lutxvMlkwS");
  assert.deepEqual(JSON.parse(memSnap.metaText), JSON.parse(JSON.stringify(disk.meta("urn:uuid:m1"))));
  const s = CourseSession.create(disk, { owner: "t", title: "T", ages: AGES, marbleAnchor: "mt_gLy3ZgZWiN", marbleConnected: "mt_lutxvMlkwS" });
  assert.equal(CourseSession.load(disk, s.courseId).view().course.marbleConnected, "mt_lutxvMlkwS");
  const plain = CourseSession.create(disk, { owner: "t", title: "Old" });
  assert.equal("marbleConnected" in disk.log(plain.courseId).read()[0].event, false, "absent stays absent");
  const h = createHandler({ store: new RecordStore(), worker: { enabled: false }, marble: service });
  const base = { owner: "t", title: "T", ages: AGES, marbleAnchor: "mt_gLy3ZgZWiN" };
  for (const bad of ["mt_gLy3ZgZWiN", "mt_nope", "mt_qzGADV-NGe", 7]) {
    assert.equal((await call(h, "POST", "/api/courses", { ...base, marbleConnected: bad })).status, 400, String(bad));
  }
  assert.equal((await call(h, "POST", "/api/courses", { owner: "t", title: "T", ages: AGES, marbleConnected: "mt_lutxvMlkwS" })).status, 400, "needs an anchor");
  const ok = await call(h, "POST", "/api/courses", { ...base, marbleConnected: "mt_lutxvMlkwS" });
  assert.equal(ok.json.view.course.marbleConnected, "mt_lutxvMlkwS");
});

test("the skill map as a source: transient text to the worker, {kind:'marble', id} on the record, proposals labelled 'marble'", async () => {
  const prompts = [];
  const worker = { enabled: true, draftObjectives: async ({ materials }) => { prompts.push(materials); return [{ statement: "Students can explain that light bounces off surfaces.", from: [materials[0].name] }]; } };
  const store = new RecordStore();
  const h = createHandler({ store, worker, marble: service });
  const c = await call(h, "POST", "/api/courses", { owner: "t", title: "Grass", ages: AGES, marbleAnchor: "mt_gLy3ZgZWiN", marbleConnected: "mt_lutxvMlkwS", objectivesConfirm: "explicit" });
  const id = c.json.courseId;
  const view = (await call(h, "GET", `/api/courses/${encodeURIComponent(id)}`)).json;
  const answers = Object.fromEntries((view.intake?.questions ?? []).map((q) => [q.id, q.id === "learning_outcomes" ? "Explain why leaves are green" : "Why is the grass green? Ages 4-10"]));
  const steps = [await call(h, "POST", `/api/courses/${encodeURIComponent(id)}/intake/answer`, { text: "Answers.", answers })];
  for (const cp of ["files", "outline"]) steps.push(await call(h, "POST", `/api/courses/${encodeURIComponent(id)}/checkpoints`, { id: cp, text: `Confirm ${cp}.` }));
  assert.deepEqual(steps.map((x) => x.status), [200, 200, 200], JSON.stringify(steps.map((x) => x.json)).slice(0, 600));
  const res = await call(h, "POST", `/api/courses/${encodeURIComponent(id)}/materials/propose`, { materials: [], useMap: true });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const r = { ok: true, proposals: res.json.proposals };
  assert.deepEqual(prompts[0].map((m) => m.name), ["Skill map: Reflecting Light", "Skill map: What Plants Need to Thrive"]);
  assert.equal(r.ok, true);
  assert.equal(r.proposals[0].source, "marble");
  assert.match(prompts[0][0].text, /shiny smooth surfaces/);
  const all = JSON.stringify(store.snapshot());
  assert.doesNotMatch(all, /shiny smooth surfaces/, "the map text is never recorded");
  assert.match(all, /\\"kind\\":\\"marble\\",\\"id\\":\\"mt_gLy3ZgZWiN\\"/);
});
