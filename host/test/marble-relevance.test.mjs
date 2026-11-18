/**
 * marble-relevance.test.mjs — the skill-map anchor makes suggestions relevant (G2a).
 *
 * The verifier's example: "AI in daily life" for ages 8-10 returned "Daily Life in a Roman
 * Town" and "Roman Army and Conquest of Britain" — the words overlapped, and the dependent-walk
 * crossed into History. With an anchor in Computing / Artificial Intelligence those must be
 * gone. Without an anchor the current behaviour stays, filtered by the (now structured) ages.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMarbleService } from "../marble/marble-graph.mjs";
import { MarbleSource } from "../sources/marble.mjs";

const SNAPSHOT = new URL("../data/marble/marble-snapshot.json", import.meta.url).pathname;
const ANCHOR = "mt_AzTrT5ySCx"; // AI in Daily Life — Computing / Artificial Intelligence
const marble = createMarbleService(async () => readFileSync(SNAPSHOT, "utf8"));
const src = new MarbleSource({ marble });

const ROMAN = /Roman/i;

test("without an anchor, the current behaviour stays: the walk crosses into History (the verifier's repro)", async () => {
  const out = await src.retrieve({ topic: "AI in daily life", ages: { min: 8, max: 10 }, limit: 12 });
  const roman = out.filter((c) => ROMAN.test(c.label));
  assert.ok(roman.length >= 2, `the Roman topics are still suggested without an anchor: ${roman.map((c) => c.label).join(" | ")}`);
  // ...and the leading suggestion is still the strongest word overlap
  assert.equal(out[0].ref, "marble:mt_AzTrT5ySCx");
});

test("with an anchor in Computing / Artificial Intelligence, the Roman and rainforest topics are gone", async () => {
  const out = await src.retrieve({ topic: "AI in daily life", ages: { min: 8, max: 10 }, limit: 12, anchor: ANCHOR });
  assert.ok(out.length > 0);
  assert.equal(out.some((c) => ROMAN.test(c.label)), false, `no Roman topic may appear: ${out.map((c) => c.label).join(" | ")}`);
  assert.equal(out.some((c) => /Rainforest|Egypt|Canada|colony/i.test(c.label)), false, "no other unrelated-domain topic may appear");
  // every suggestion is in the anchor's subject or domain (Computing / Artificial Intelligence)
  for (const c of out) {
    const id = c.ref.slice("marble:".length);
    const t = await marble.get(id);
    assert.ok(t, "cited topic exists in the snapshot");
    assert.ok(
      t.subject === "Computing" || t.domain === "Artificial Intelligence",
      `${c.label} is ${t.subject}/${t.domain}, outside the anchor's subject and domain`,
    );
  }
});

test("the walk itself stops crossing domains: an in-scope hit's out-of-scope neighbours are not cited", async () => {
  // "AI in Computer Games" (Computing/AI) — its neighbourhood must not drag History in either.
  const out = await src.retrieve({ topic: "computer games", ages: { min: 7, max: 11 }, limit: 12, anchor: ANCHOR });
  assert.ok(out.length > 0);
  for (const c of out) {
    const t = await marble.get(c.ref.slice("marble:".length));
    assert.ok(t.subject === "Computing" || t.domain === "Artificial Intelligence", `out-of-scope neighbour leaked: ${c.label}`);
  }
});

test("an anchor missing from the snapshot fails closed, and 19-22 is the wrong grain even with matching words", async () => {
  const ghost = await src.retrieve({ topic: "AI in daily life", ages: { min: 8, max: 10 }, anchor: "mt_GHOST" });
  assert.deepEqual(ghost, [], "a vanished anchor is never a whole-band search");
  const grown = await src.retrieve({ topic: "maximum likelihood", ages: { min: 19, max: 22 } });
  assert.deepEqual(grown, [], "ages 19-22 overlap nothing in the children's graph");
  // structured ages are NOT parsed from the free text: a misleading answer cannot override them
  const text = await src.retrieve({ topic: "AI in daily life", course: "University econometrics, ages 19 and up", ages: { min: 5, max: 12 } });
  assert.ok(text.length > 0, "the structured ages win over the free-text ages");
});
