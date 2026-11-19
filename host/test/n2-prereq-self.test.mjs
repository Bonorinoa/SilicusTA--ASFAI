/** N2 · L1 item 4: a topic never lists itself as its own prerequisite (a two-hop cycle, or a same-name twin). */
import test from "node:test";
import assert from "node:assert/strict";
import { MarbleGraph, parseMarbleSnapshot } from "../marble/marble-graph.mjs";

const topic = (id, name) => ({ id, name, subject: "Science", domain: "Space", ageRangeStart: 7, ageRangeEnd: 12, evidence: [] });
const graph = () => new MarbleGraph(parseMarbleSnapshot(JSON.stringify({
  format: "marble-snapshot",
  topics: [topic("mt_A", "Moon Phases"), topic("mt_B", "The Moon's Orbit"), topic("mt_C", "moon phases "), topic("mt_D", "Light and Shadow")],
  dependencies: [
    { topicId: "mt_A", prerequisiteId: "mt_B", strength: "hard", reason: "" },
    { topicId: "mt_B", prerequisiteId: "mt_A", strength: "hard", reason: "" }, // a cycle: A needs B needs A
    { topicId: "mt_A", prerequisiteId: "mt_C", strength: "soft", reason: "" }, // a twin under another id
    { topicId: "mt_B", prerequisiteId: "mt_D", strength: "hard", reason: "" },
  ],
})));

test("N2: the anchor is never its own prerequisite or dependent", () => {
  const n = graph().neighbourhood("mt_A");
  const ids = n.prerequisites.map((p) => p.id);
  assert.deepEqual(ids, ["mt_B", "mt_D"], JSON.stringify(ids));
  assert.equal(n.prerequisites.some((p) => p.name.trim().toLowerCase() === "moon phases"), false);
  assert.equal(n.dependents.some((d) => d.id === "mt_A"), false);
  assert.deepEqual(n.dependents.map((d) => d.id), ["mt_B"], "a real dependent on the cycle is still shown");
});
