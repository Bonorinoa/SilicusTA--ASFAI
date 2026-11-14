// G1bV re-run of the G1V audience probe. From a checkout of feat/marble-source (repo root):
//   node docs/verification/2026-11-14-g1b-marble-recheck-probe/audience-probe.mjs
// Part A: every phrasing in the old H1 table + the card's three extras + my own extras. Topic "maximum likelihood": must be 0.
// Part B: ages 9-10 must still return the demo topics. Exit 1 if any expectation fails.
import { readFileSync } from "node:fs";
import { audienceAges, createMarbleService } from "../../../host/marble/marble-graph.mjs";
import { MarbleSource } from "../../../host/sources/marble.mjs";
const src = new MarbleSource({ marble: createMarbleService(async () => readFileSync(new URL("../../../host/data/marble/marble-snapshot.json", import.meta.url), "utf8")) });
let bad = 0;
const row = (label, course, out, want) => {
  const ok = want === "zero" ? out.length === 0 : out.length > 0;
  if (!ok) bad++;
  console.log((ok ? "ok  " : "FAIL"), JSON.stringify(course).padEnd(48), "band", JSON.stringify(audienceAges(course)).padEnd(24), "->", String(out.length).padStart(2), "citations", out[0]?.label ?? "");
};
const OLD_H1 = ["ages 19 and up", "a 19-year-old course", "aged 19", "19 year olds", "19 year old students", "16 to 18 year olds", "17 and 18 year olds", "Econometrics for 2nd-year undergraduates"];
const CARD_EXTRAS = ["University econometrics", "adult learners", ""];
const MINE = ["16–18 year olds", "ages 16-18", "ages 19-22", "18+", "college freshmen", "PhD students", "graduate students", "undergrads", "high school seniors", "grade 12", "19yo", "nineteen year olds", "ages 30 to 40", "adults aged 25-34", "  ", "ages 99", "Econometrics 101, ages 19 to 22"];
console.log("# Part A: topic 'maximum likelihood' (grain risk), expect 0 citations each");
for (const [grp, list] of [["old H1", OLD_H1], ["card extras", CARD_EXTRAS], ["verifier extras", MINE]]) {
  console.log("--", grp);
  for (const c of list) row(grp, c, await src.retrieve({ topic: "maximum likelihood", objectives: [], course: c, limit: 8 }), "zero");
}
console.log("# Part B: ages 9-10 must still return topics");
for (const [t, c] of [["AI in daily life", "ages 9–10"], ["AI in daily life", "Grade 4 science, ages 9–10"], ["AI in daily life", "ages 9-10"], ["AI in daily life", "9 to 10 year olds"], ["AI in daily life", "8-10 year olds"], ["smart devices", "a 10-year-old course"]]) {
  row("B", c, await src.retrieve({ topic: t, objectives: [], course: c, limit: 8 }), "some");
}
console.log(bad ? `FAILURES: ${bad}` : "ALL EXPECTATIONS MET");
process.exit(bad ? 1 : 0);
