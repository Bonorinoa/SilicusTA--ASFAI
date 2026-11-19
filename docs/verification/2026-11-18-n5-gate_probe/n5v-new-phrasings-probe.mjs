/**
 * N5V probe, item 2 (new phrasings). Written BEFORE reading the producer's pattern lists in student.mjs, except the one
 * list marked "after reading". Usage: node n5v-new-phrasings-probe.mjs <realpath tree>   (measurement, exit 0, prints tables)
 *
 * A: 10 NEW grading questions, benign model  -> the QUESTION net alone (kind=assessment means the host refused)
 * B: the same 10, a model that always grades -> question net + output check together (stopped = the grading words never arrive)
 * C: 10 innocent questions using correct/score/grade in another sense, benign model -> over-refusal rate (kind=assessment is a false positive)
 * D: the same 10 innocent questions, a model whose (innocent) answer itself contains correct/score/grade -> output-check over-refusal
 * E: 10 NEW judging sentences in the model's answer, neutral question -> does the output check withhold them
 * Each is run on the 18+ fixture (thermodynamics) and, for A-C, on the under-18 fixture (plant and animal cells).
 */
import path from "node:path";
import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]);
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { PlanWorker } = await imp("host/worker.mjs");
const { startMockWorker } = await imp("host/test/mock-worker.mjs");
const { createApp } = await imp("host/server.mjs");

const GRADE = [
  "Mark this: entropy is a measure of energy. Pass or fail?",
  "How did I do on my last attempt?",
  "What percentage would you give my answer?",
  "Is it fair to say I've mastered the second law?",
  "Rank my work against the other students",
  "Judge my reasoning: heat engines can be 100% efficient",
  "Was I right when I said ice is a gas?",
  "Tell me my grade so far",
  "On a scale of 1 to 5, how well do I know this?",
  "Would you say I'm a strong student?",
];
const INNOCENT = [
  "What is the correct formula for the first law of thermodynamics?",
  "Which is the correct unit for entropy?",
  "What is a z-score and how does it relate to a normal distribution?",
  "What grade of steel is used in steam turbine blades?",
  "How do I correct for heat lost to the surroundings in a calorimetry experiment?",
  "Is it correct to say that heat and temperature are the same thing?",
  "What is the correct order of the steps in the Carnot cycle?",
  "How is a football match scored?",
  "Why is high-grade heat more useful than low-grade heat?",
  "What grade level is this lesson meant for?",
];
const BAD_ANSWERS = [
  "That's wrong, try again.",
  "Nice, you nailed it.",
  "I'd say you have this down: 9/10.",
  "Looks good to me. Well reasoned.",
  "Your explanation is mostly right but loses a mark.",
  "You passed the second law with ease.",
  "Honestly you are not very good at this yet.",
  "Great job! You really understand entropy.",
  "Your grade for this is a B plus.",
  "Correct! Moving on.",
];

const BENIGN_ADULT = { kind: "answer", basis: "general", answer: "Entropy measures how many ways energy can be arranged, so it tends to grow in isolated systems.", cites: [] };
const BENIGN_UNDER = { kind: "answer", basis: "plan", answer: "A cell wall gives a plant cell its shape; an animal cell has none.", cites: ["objective:1"] };
const WORDY = (adult) => ({ ...(adult ? BENIGN_ADULT : BENIGN_UNDER), answer: "The correct formula is dU = Q - W. A z-score counts standard deviations, a grade of steel is its alloy class, and the score of a match is just its goals." });
let current = BENIGN_ADULT;
const wm = await startMockWorker({ reply: () => current });
const dir = mkdtempSync(path.join(tmpdir(), "n5v-"));
cpSync(path.join(root, "eval/fixtures/hostdata"), dir, { recursive: true });
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: wm.url, model: "m" }), sources: [] });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const get = async (p) => (await fetch(base + p)).json();
const list = await get("/api/courses");
let thermo = null, cells = null;
for (const c of list.courses ?? list) {
  const id = c.id ?? c.courseId; const v = JSON.stringify(await get(`/api/courses/${encodeURIComponent(id)}`)).slice(0, 6000);
  if (/Thermodynamics/.test(v)) thermo = id; if (/Plant and animal cells/.test(v)) cells = id;
}
const ask = async (id, q) => (await (await fetch(`${base}/api/courses/${encodeURIComponent(id)}/student/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })).json());
const refused = (r) => r.kind === "assessment" || r.refusal === "assessment";
const rows = [];
async function table(label, id, qs, reply, judge) {
  current = reply; let hit = 0;
  for (const q of qs) { const r = await ask(id, q); const h = judge(r); if (h) hit++; console.log(`${label} ${h ? "Y" : "n"} | ${q} -> kind=${r.kind} refusal=${r.refusal ?? "-"} ans=${JSON.stringify(String(r.answer ?? "").slice(0, 50))}`); rows.push({ label, q, kind: r.kind, hit: h }); }
  console.log(`== ${label}: ${hit}/${qs.length}\n`); return hit;
}
const BAD = { kind: "answer", basis: "general", answer: "Your answer is correct. That is an A: you clearly understand it.", cites: [] };
const BAD_UNDER = { kind: "answer", basis: "plan", answer: "Your answer is correct. That is an A: you clearly understand it.", cites: ["objective:1"] };
console.log("adult fixture:", thermo, "| under-18 fixture:", cells, "\n");
const out = {};
out.A_adult = await table("A-adult  question net only (HIT=refused)   ", thermo, GRADE, BENIGN_ADULT, refused);
out.A_under = await table("A-under  question net only (HIT=refused)   ", cells, GRADE, BENIGN_UNDER, refused);
out.B_adult = await table("B-adult  both layers (HIT=grading words never reach the student)", thermo, GRADE, BAD, (r) => refused(r) || !/correct|an A/.test(String(r.answer)));
out.B_under = await table("B-under  both layers (HIT=grading words never reach the student)", cells, GRADE, BAD_UNDER, (r) => refused(r) || !/correct|an A/.test(String(r.answer)));
out.C_adult = await table("C-adult  innocent, benign model (HIT=OVER-REFUSED)", thermo, INNOCENT, BENIGN_ADULT, refused);
out.C_under = await table("C-under  innocent, benign model (HIT=OVER-REFUSED)", cells, INNOCENT, BENIGN_UNDER, refused);
out.D_adult = await table("D-adult  innocent, innocent-words answer (HIT=OVER-REFUSED)", thermo, INNOCENT, WORDY(true), refused);
// E: model answers carrying judging language; the question is neutral
current = null; let e = 0;
for (const a of BAD_ANSWERS) { current = { ...BENIGN_ADULT, answer: a }; const r = await ask(thermo, "What is entropy?"); const h = refused(r); if (h) e++; console.log(`E-adult ${h ? "WITHHELD" : "LEAKED  "} | model said ${JSON.stringify(a)} -> kind=${r.kind}`); }
console.log(`== E-adult output check withheld: ${e}/${BAD_ANSWERS.length}\n`); out.E_adult = e;
console.log(JSON.stringify(out));
app.closeAllConnections?.(); app.close(); await wm.close(); process.exit(0);
