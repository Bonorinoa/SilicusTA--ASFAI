/**
 * e2e-restart.mjs — the Sprint 1 acceptance run, at the process boundary.
 *
 * Starts the host as a CHILD PROCESS, drives the whole one-teacher flow over
 * HTTP, SIGTERMs it, starts a fresh process over the same data directory, and
 * asserts the record is identical and the log's hash chain verifies.
 *
 * Run:  node scripts/e2e-restart.mjs      (exit 0 = pass)
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8791;
const DATA = mkdtempSync(join(tmpdir(), "silicus-e2e-"));
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = "teacher:tk-1";

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);

function startHost() {
  const child = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, SILICUS_HOST_DATA: DATA, SILICUS_HOST_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.stderr.write(`[host] ${d}`));
  return child;
}

async function waitHealthy(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, json: await r.json() };
};
const stop = (child) => new Promise((r) => { child.once("exit", r); child.kill("SIGTERM"); });

const ITEMS = [
  { kind: "local", statement: "Students can explain what an algorithm is." },
  { kind: "public", publicId: "mt_alpha", statement: "Learners can find the claim in an AI answer." },
];

const h1 = startHost();
check("host process boots and answers /api/health", await waitHealthy());

const created = await post("/api/courses", { owner: OWNER, title: "Lesson 3 | AI literacy" });
const courseId = created.json.courseId;
check("course created", created.status === 201 && !!courseId);

await post(`/api/courses/${courseId}/checkpoints`, { id: "files", text: "Confirm the material list." });
await post(`/api/courses/${courseId}/checkpoints`, { id: "outline", text: "Confirm the outline." });
const proposed = await post(`/api/courses/${courseId}/objectives`, { items: ITEMS, sources: ["from your slides p.4", "suggested match"] });
const [p1, p2] = proposed.json.proposals.map((r) => r.id);
const decided = await post(`/api/courses/${courseId}/decisions`, {
  decisions: [
    { verb: "accept", proposalId: p1 },
    { verb: "rename", proposalId: p2, statement: "Learners can find the claim and name what evidence would back it up." },
    { verb: "add", statement: "Students can ask one honest question about how an AI tool works." },
  ],
  text: "Decide the proposals.",
});
check("teacher decisions applied through the gate", decided.status === 200);

const addedId = decided.json.decisions.find((d) => d.verb === "add").targetId;
await post(`/api/courses/${courseId}/plan`, { spec: {
  title: "Seeing the claim: how AI answers are built",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    { title: "Spotting the claim", minutes: 20, objectiveIds: [p1, p2], learnerDoes: "Mark the claim.", teacherDoes: "Ask about evidence.", evidenceIfAny: "observation" },
    { title: "Ask one honest question", minutes: 20, objectiveIds: [addedId], learnerDoes: "Write one question.", teacherDoes: "Collect them.", evidenceIfAny: "work-product" },
  ],
} });
await post(`/api/courses/${courseId}/plan/confirm`, { text: "Confirm the lesson plan." });
const pub = await post(`/api/courses/${courseId}/publish`, { text: "Publish the course package.", note: "first version" });
check("package sealed as version 1", pub.status === 200 && pub.json.version.version === 1);

const v1 = (await get(`/api/courses/${courseId}`)).json;
check("view reports all five checkpoints confirmed", ["files", "outline", "objectives", "plan", "publish"].every((k) => v1.checkpoints[k].status === "confirmed"));

await stop(h1);
check("host process terminated", true);

const h2 = startHost();
check("host restarts", await waitHealthy());
const v2 = (await get(`/api/courses/${courseId}`)).json;
check("record is byte-identical after restart", JSON.stringify(v2) === JSON.stringify(v1));

const ver = (await get(`/api/courses/${courseId}/verify`)).json;
check("event-log hash chain verifies", ver.ok === true, `events=${ver.events}`);
check("sealed version survived restart", v2.versions.length === 1 && v2.versions[0].objectiveRefs.length === 3);
check("publish still legal after restart", v2.publish.canPublish === true);
await stop(h2);

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} acceptance checks passed  (data: ${DATA})`);
process.exit(failed ? 1 : 0);
