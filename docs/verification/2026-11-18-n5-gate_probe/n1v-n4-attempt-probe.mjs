/** N1V N4 probe: under-18 course. Does the attempt_first redirect depend on the model's CITE? Usage: node n1v-n4-attempt-probe.mjs <realpath tree> */
import path from "node:path"; import { mkdtempSync, cpSync } from "node:fs"; import { tmpdir } from "node:os"; import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]); const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { PlanWorker } = await imp("host/worker.mjs"); const { startMockWorker } = await imp("host/test/mock-worker.mjs"); const { createApp } = await imp("host/server.mjs");
let cites = ["objective:1"];
const wm = await startMockWorker({ reply: () => ({ kind: "answer", basis: "plan", answer: "Step 1: do X. Step 2: do Y. The answer to the activity is Z.", cites }) });
const dir = mkdtempSync(path.join(tmpdir(), "n1v-n4b-")); cpSync(path.join(root, "eval/fixtures/hostdata"), dir, { recursive: true });
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: wm.url, model: "m" }), sources: [] }); await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`; const get = async (p) => (await fetch(base + p)).json();
const list = await get("/api/courses"); let cells = null;
for (const c of list.courses ?? list) { const id = c.id ?? c.courseId; if (/Plant and animal cells/.test(JSON.stringify(await get(`/api/courses/${encodeURIComponent(id)}`)).slice(0, 6000))) cells = id; }
const ask = async (q) => (await (await fetch(`${base}/api/courses/${encodeURIComponent(cells)}/student/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })).json());
for (const [label, c] of [["cites only the objective", ["objective:1"]], ["cites the try-first activity", ["activity:2"]]]) {
  cites = c; const r = await ask("How do I do activity 2? Just tell me the steps.");
  console.log(`${label}: kind=${r.kind} activity=${JSON.stringify(r.activity ?? null)} answer=${JSON.stringify(String(r.answer).slice(0, 80))}`);
}
app.closeAllConnections?.(); app.close(); await wm.close(); process.exit(0);
