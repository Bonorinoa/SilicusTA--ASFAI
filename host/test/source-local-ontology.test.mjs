/** A graph ontology that is NOT ASFAI: a file a school district can hand-edit. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalOntologySource } from "../sources/local-ontology.mjs";
import { retrieveAll } from "../knowledge.mjs";

const FIXTURE = new URL("../fixtures/ontology.example.json", import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), "silicus-onto-"));

test("a local ontology file retrieves by lexical match and verifies by membership", async () => {
  const src = new LocalOntologySource({ file: FIXTURE });
  const hits = await src.retrieve({ topic: "algorithm", objectives: [], limit: 5 });
  assert.ok(hits.length > 0, "the fixture has an algorithm node");
  assert.ok(hits.every((h) => h.source === "local-ontology" && h.ref.startsWith("local:")));
  assert.equal(hits[0].ref, "local:algo.sequence", "title match outranks a body match");
  assert.deepEqual(await src.verify({ citations: hits }), { ok: true, unknown: [], checked: true });
  const bad = await src.verify({ citations: [{ ref: "local:ghost" }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unknown, ["local:ghost"]);
});

test("it matches on the teacher's confirmed objectives as well as the topic, and nothing off-topic", async () => {
  const src = new LocalOntologySource({ file: FIXTURE });
  const hits = await src.retrieve({ topic: "", objectives: [{ id: "u", statement: "Learners can find the claim in an AI answer." }] });
  assert.equal(hits[0].ref, "local:ai.claims", "the strongest overlap leads");
  assert.ok(!hits.some((h) => h.ref === "local:stats.mle"), "an unrelated node is not dragged in");
  assert.deepEqual(await src.retrieve({ topic: "medieval pottery" }), [], "no overlap is an empty answer, not a forced match");
});

test("a university topic is a first-class match: the ontology is not a children's map", async () => {
  const src = new LocalOntologySource({ file: FIXTURE });
  const hits = await src.retrieve({ topic: "maximum likelihood estimation" });
  assert.equal(hits[0].ref, "local:stats.mle");
});

test("no file configured is a state, not a crash", async () => {
  const src = new LocalOntologySource({});
  assert.equal(src.enabled, false);
  assert.deepEqual(await src.retrieve({ topic: "x" }), []);
  assert.deepEqual(await src.verify({ citations: [{ ref: "local:a" }] }), { ok: true, unknown: [], checked: false });
});

test("a malformed or missing ontology file degrades to no context, and says it did not check", async () => {
  const dir = tmp();
  const junk = join(dir, "junk.json"); writeFileSync(junk, "{ not json");
  const wrong = join(dir, "wrong.json"); writeFileSync(wrong, JSON.stringify({ nodes: "nope" }));
  for (const file of [junk, wrong, join(dir, "absent.json")]) {
    const src = new LocalOntologySource({ file });
    assert.equal(src.enabled, true, "configured is a state; readable is another");
    assert.deepEqual(await src.retrieve({ topic: "algorithm" }), []);
    assert.equal((await src.verify({ citations: [{ ref: "local:a" }] })).checked, false, "an unreadable file verifies nothing");
  }
});

test("nodes without an id or a title are skipped, not fatal", async () => {
  const f = join(tmp(), "o.json");
  writeFileSync(f, JSON.stringify({ version: 1, nodes: [null, { id: 3 }, { id: "ok", title: "Algorithm basics" }, { title: "no id" }] }));
  const hits = await new LocalOntologySource({ file: f }).retrieve({ topic: "algorithm" });
  assert.deepEqual(hits.map((h) => h.ref), ["local:ok"]);
});

test("it sends nothing anywhere: no egress, so it is consulted even for a course that never touched ASFAI", async () => {
  const src = new LocalOntologySource({ file: FIXTURE });
  assert.equal(src.egress, null);
  const out = await retrieveAll([src], { topic: "algorithm", allowEgress: [] });
  assert.ok(out.length > 0);
});
