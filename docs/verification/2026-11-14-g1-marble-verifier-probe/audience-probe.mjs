// Run from a checkout of feat/marble-source:  node docs/verification/2026-11-14-g1-marble-verifier-probe/audience-probe.mjs
// Shows how the grain guard reads the teacher's "Who it's for" answer, and what MarbleSource returns for "maximum likelihood".
import { readFileSync } from "node:fs";
import { audienceAges, createMarbleService } from "../../../host/marble/marble-graph.mjs";
import { MarbleSource } from "../../../host/sources/marble.mjs";
const src = new MarbleSource({ marble: createMarbleService(async () => readFileSync(new URL("../../../host/data/marble/marble-snapshot.json", import.meta.url), "utf8")) });
for (const course of ["ages 19 and up", "a 19-year-old course", "aged 19", "19 year olds", "19 year old students", "16 to 18 year olds", "17 and 18 year olds",
  "Econometrics for 2nd-year undergraduates", "University econometrics", "adult learners", "ages 8-10"]) {
  const out = await src.retrieve({ topic: "maximum likelihood", objectives: [], course, limit: 8 });
  console.log(JSON.stringify(course).padEnd(46), "band", JSON.stringify(audienceAges(course)).padEnd(22), "->", out.length, "citations", out[0]?.label ?? "");
}
