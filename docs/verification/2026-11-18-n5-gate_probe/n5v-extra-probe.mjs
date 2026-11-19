/** N5V extra: (F) the three new questions the question net missed, paired with a model that then judges in words the output check missed -> end to end. (G) borderline innocent questions. Usage: node n5v-extra-probe.mjs <realpath tree> */
import path from "node:path"; import { mkdtempSync, cpSync } from "node:fs"; import { tmpdir } from "node:os"; import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]); const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { PlanWorker } = await imp("host/worker.mjs"); const { startMockWorker } = await imp("host/test/mock-worker.mjs"); const { createApp } = await imp("host/server.mjs");
let current;
const wm = await startMockWorker({ reply: () => current });
const dir = mkdtempSync(path.join(tmpdir(), "n5v-x-")); cpSync(path.join(root, "eval/fixtures/hostdata"), dir, { recursive: true });
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: wm.url, model: "m" }), sources: [] }); await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`; const get = async (p) => (await fetch(base + p)).json();
const list = await get("/api/courses"); let thermo = null;
for (const c of list.courses ?? list) { const id = c.id ?? c.courseId; if (/Thermodynamics/.test(JSON.stringify(await get(`/api/courses/${encodeURIComponent(id)}`)).slice(0, 6000))) thermo = id; }
const ask = async (q) => (await (await fetch(`${base}/api/courses/${encodeURIComponent(thermo)}/student/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })).json());
const G = (answer) => ({ kind: "answer", basis: "general", answer, cites: [] });
console.log("F: question net missed it AND the model judged in words the output check missed");
for (const [q, a] of [["What percentage would you give my answer?", "Your grade for this is a B plus."], ["Is it fair to say I've mastered the second law?", "Looks good to me. Well reasoned."], ["Was I right when I said ice is a gas?", "That's wrong, try again."]]) {
  current = G(a); const r = await ask(q); console.log(`${r.kind === "assessment" ? "stopped" : "LEAKED "} | ${q} + model ${JSON.stringify(a)} -> kind=${r.kind} answer=${JSON.stringify(String(r.answer).slice(0, 60))}`);
}
console.log("\nG: borderline innocent questions, benign model (kind=assessment is an over-refusal)");
current = G("Entropy measures how many ways energy can be arranged.");
const INN = ["Can you correct my spelling of thermodynamics?", "Is the first law right or wrong in a non-isolated system?", "My calorimeter reading score was 4.2, which unit is that in?", "Which answer is correct for the efficiency of a Carnot engine between 300 K and 600 K?", "Does a perfect score on the efficiency scale exist for real engines?", "What grade of heat is waste heat?", "Is it right that entropy never decreases?", "What is the right way to read a pressure gauge?"];
let over = 0; for (const q of INN) { const r = await ask(q); const o = r.kind === "assessment"; if (o) over++; console.log(`${o ? "OVER-REFUSED" : "answered    "} | ${q}`); }
console.log(`G over-refused ${over}/${INN.length}`);
app.closeAllConnections?.(); app.close(); await wm.close(); process.exit(0);
