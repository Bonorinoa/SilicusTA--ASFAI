/**
 * ASFAI's graph as a knowledge source. The request shapes come from the partner source
 * (register-asfai-tools.ts), and the mock enforces them STRICTLY the way the live server does -
 * a mock that is more forgiving than the server is how Sprint 3 shipped two live bugs.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { connectedAsfai } from "./asfai-fixture.mjs";
import { AsfaiGraphSource } from "../sources/asfai-graph.mjs";

const MOCKS = [];
after(() => MOCKS.forEach((m) => m.close()));
const setup = async () => { const c = await connectedAsfai(); MOCKS.push(c.mock); return { ...c, src: new AsfaiGraphSource({ client: c.svc.client }) }; };
const graphCalls = (mock) => (mock.st.toolArgs ?? []).filter((a) => a.action === "search_objectives" || a.action === "get_objective");

test("the ASFAI source searches the graph with the published payload and maps hits to citations", async () => {
  const { src, mock } = await setup();
  const hits = await src.retrieve({ topic: "following steps in algorithms", objectives: [], limit: 5 });
  assert.ok(hits.length > 0, "the mock graph has a matching node");
  assert.ok(hits.every((h) => h.source === "asfai-graph" && h.ref.startsWith("asfai:")));
  const call = mock.st.toolArgs.find((a) => a.action === "search_objectives");
  assert.deepEqual(call.payload, { query: "following steps in algorithms", limit: 5 }, "exactly {query, limit}: the server's schema is strict");
  const steps = hits.find((h) => h.ref === "asfai:mt_0007");
  assert.match(steps.label, /Following Steps \(ages 8–10\)/, "the age range rides the label: this is a children's map");
  assert.match(steps.text, /sequence of instructions/);
});

test("the teacher's confirmed objectives are searched too, deduplicated, and bounded", async () => {
  const { src, mock } = await setup();
  const objectives = ["Students can find the claim in an AI answer.", "Students can follow steps.", "c", "d", "e"].map((statement, i) => ({ id: `u${i}`, statement }));
  const hits = await src.retrieve({ topic: "AI literacy", objectives, limit: 8 });
  assert.equal(new Set(hits.map((h) => h.ref)).size, hits.length, "no duplicate refs");
  assert.ok(graphCalls(mock).length <= 4, "the topic and at most three objective sentences leave the machine");
  assert.ok(hits.some((h) => h.ref === "asfai:mt_0042"));
});

test("an empty graph result is a normal signal, not an error", async () => {
  const { src } = await setup();
  assert.deepEqual(await src.retrieve({ topic: "medieval pottery glazes" }), []);
  assert.deepEqual(await src.retrieve({ topic: "" , objectives: [] }), [], "nothing to ask means nothing is sent");
});

test("a children's node that LOOKS like a university match is returned as labelled context, never as a match to trust", async () => {
  const { src } = await setup();
  const hits = await src.retrieve({ topic: "likelihood language" });
  assert.equal(hits[0].ref, "asfai:mt_0100");
  assert.match(hits[0].label, /ages 9–10/);
});

test("verify() asks the graph by membership; an unknown ref is reported", async () => {
  const { src, mock } = await setup();
  const ok = await src.verify({ citations: [{ ref: "asfai:mt_0007" }] });
  assert.deepEqual(ok, { ok: true, unknown: [], checked: true });
  const bad = await src.verify({ citations: [{ ref: "asfai:mt_0007" }, { ref: "asfai:mt_ghost" }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unknown, ["asfai:mt_ghost"]);
  assert.equal(mock.st.toolArgs.some((a) => a.action === "verify_standard_alignment"), false,
    "verify_standard_alignment checks a STANDARD CODE against an objective; it cannot check a citation, so it is not used");
  assert.deepEqual((await src.verify({ citations: [{ ref: "local:foreign" }] })).unknown, [], "it does not judge refs it does not own");
});

test("an unreachable graph degrades to no context and an UNCHECKED verify - never a throw, never a false 'verified'", async () => {
  const { src, mock } = await setup();
  mock.st.graphDown = true;
  assert.deepEqual(await src.retrieve({ topic: "algorithms" }), []);
  assert.deepEqual(await src.verify({ citations: [{ ref: "asfai:mt_0007" }] }), { ok: true, unknown: [], checked: false });
});

test("not connected is a state: the source is disabled and sends nothing", async () => {
  const { svc, mock } = await connectedAsfai(); MOCKS.push(mock);
  const src = new AsfaiGraphSource({ client: svc.client, isConnected: () => false });
  assert.equal(src.enabled, false);
  assert.deepEqual(await src.retrieve({ topic: "algorithms" }), []);
  assert.equal(graphCalls(mock).length, 0);
  assert.equal(new AsfaiGraphSource({}).enabled, false, "no client at all is also just a state");
});

test("it declares that it sends the teacher's words to ASFAI, so the course can refuse it", () => {
  assert.equal(new AsfaiGraphSource({}).egress, "asfai");
  assert.equal(new AsfaiGraphSource({}).namespace, "asfai");
});
