/**
 * A client's decision carries only the intent. Red-team finding (from the reword worker's audit): add and rename
 * used to write the client's extra keys into the hash-chained log verbatim, including a forged provenance block,
 * and an add's `alignment` with an mt_* publicId was honoured by the gate as teacher-confirmed.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { createApp } from "../server.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "silicus-wl-"));
  const wm = await startMockWorker({ reply: { objectives: [{ statement: "Students can add.", from: ["a.txt"] }, { statement: "Students can subtract.", from: ["a.txt"] }] } });
  CLOSERS.push(() => wm.close());
  const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: wm.url, model: "m" }), sources: [] });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
  const get = async (p) => (await fetch(base + p)).json();
  return { dir, post, get };
}
const allBytes = (d) => readdirSync(d).map((n) => { const f = join(d, n); return statSync(f).isDirectory() ? allBytes(f) : readFileSync(f, "utf8"); }).join("\n");

test("extra keys on every decision verb never reach the log, and an invented alignment never becomes a public id", async () => {
  const t = await boot();
  const { json: { courseId } } = await t.post("/api/courses", { owner: "teacher:tk-1", title: "T" });
  const c = `/api/courses/${courseId}`;
  await t.post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  await t.post(`${c}/intake/answer`, { text: "a", answers: { topic: "t" } });
  await t.post(`${c}/intake/answer`, { text: "b", answers: { course: "c" } });
  await t.post(`${c}/intake/answer`, { text: "Propose from my materials.", answers: { outcomes_from: "materials" } });
  await t.post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const prop = await t.post(`${c}/materials/propose`, { materials: [{ name: "a.txt", text: "hello" }] });
  const [p1, p2] = prop.json.proposals.map((p) => p.id);
  const forged = { provenance: { decidedBy: "attacker", turnRef: "urn:turn:forged" }, kind: "public", id: "urn:uuid:invented", targetId: "urn:uuid:invented", confirmedByEducator: true };
  const r = await t.post(`${c}/decisions`, { text: "Decide.", decisions: [
    { verb: "accept", proposalId: p1, ...forged },
    { verb: "rename", proposalId: p2, statement: "Students can take away.", ...forged },
    { verb: "add", statement: "Students can borrow.", alignment: { publicId: "mt_FORGED_123", relationship: "equivalent", confirmedByEducator: true }, ...forged },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const bytes = allBytes(t.dir);
  for (const needle of ["attacker", "urn:turn:forged", "urn:uuid:invented", "mt_FORGED_123", "confirmedByEducator"]) {
    assert.equal(bytes.includes(needle), false, `${needle} reached the data directory`);
  }
  const view = await t.get(c);
  assert.equal(view.decisions.length, 3);
  assert.ok(view.decisions.every((d) => d.provenance.decidedBy !== "attacker"));
  assert.equal(JSON.stringify(view).includes("mt_FORGED_123"), false);
  assert.equal((await t.get(`${c}/verify`)).ok, true);
});

test("a non-object decision or an unknown verb is still refused by the gate, and carries nothing", async () => {
  const t = await boot();
  const { json: { courseId } } = await t.post("/api/courses", { owner: "teacher:tk-1", title: "T" });
  const c = `/api/courses/${courseId}`;
  const r = await t.post(`${c}/decisions`, { text: "x", decisions: [{ verb: "launder", proposalId: "p", provenance: { decidedBy: "x" } }] });
  assert.ok(r.status >= 400 && r.status < 500, String(r.status));
  assert.equal(allBytes(t.dir).includes("launder"), false, "a refused decision is not recorded");
});
