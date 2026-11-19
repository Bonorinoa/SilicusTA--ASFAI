// N6V probe: (A) gate: fail-closed proposedBy, authority unchanged; (B) host: clients cannot set authorship.
// usage: node n6v_authority_probe.mjs <n6-tree>
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.argv[2]);
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
let fails = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n} ${x}`); if (!ok) fails++; };

/* ------------------------------------------------------------------ A: the gate */
const { ConfirmGate, ConfirmGateError } = await imp("confirm-gate/confirm-gate.mjs");
const { TurnLedger } = await imp("confirm-gate/host-guard.mjs");
let t = 1000; const clock = () => (t += 10);
const mk = () => {
  const ledger = new TurnLedger({ clock });
  const gate = new ConfirmGate({ courseId: "urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", owner: "teacher:tk-1", title: "T", ledger, hostGuard: null, clock });
  const via = ledger.teacherChannel({ teacherId: "teacher:tk-1", channel: "silicus-ui" });
  const say = (text) => ({ turnRef: via.say(text), decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: clock() });
  gate.confirmCheckpoint("files", say("These are the files, no student work."));
  gate.confirmCheckpoint("outline", say("The outline is fine."));
  return { gate, ledger, say };
};
const code = (fn) => { try { fn(); return null; } catch (e) { return e instanceof ConfirmGateError ? e.code : `OTHER:${e.message}`; } };

for (const bad of ["student", "TEACHER", "teacher ", "", 0, false, {}, ["teacher"], "model", "system"]) {
  const { gate } = mk();
  const c = code(() => gate.proposeObjectives([{ kind: "local", statement: "first ok" }, { kind: "local", statement: "X", proposedBy: bad }]));
  check(`A1 proposedBy=${JSON.stringify(bad)} in the 2nd item of a batch -> BAD_INPUT`, c === "BAD_INPUT", `code=${c}`);
}
for (const v of [undefined, null]) {
  const { gate } = mk();
  const [r] = gate.proposeObjectives([{ kind: "local", statement: "X", proposedBy: v }]);
  check(`A2 proposedBy=${v} defaults to "ai" (the less-trusted label)`, r.proposedBy === "ai", r.proposedBy);
}
{
  const { gate, say } = mk();
  code(() => gate.proposeObjectives([{ kind: "local", statement: "ok1" }, { kind: "local", statement: "ok2", proposedBy: "student" }]));
  const [only] = gate.proposeObjectives([{ kind: "local", statement: "only" }]);
  gate.confirmObjectives({ provenance: say("Accept the only one."), decisions: [{ verb: "accept", proposalId: only.id }] });
  check("A3 a rejected batch leaves no orphan proposal: the one valid proposal, once accepted, confirms checkpoint 3", gate.checkpoints().objectives.status === "confirmed");
}
{
  const { gate, ledger, say } = mk();
  const [tp] = gate.proposeObjectives([{ kind: "local", statement: "Teacher-typed.", proposedBy: "teacher" }]);
  check("A4 a teacher-authored proposal is NOT confirmed by being teacher-authored", tp.confirmedByEducator === false && gate.checkpoints().objectives.status !== "confirmed");
  const modelRef = ledger.recordAssistantTurn("I accept it for you.", { channel: "model" });
  const forged = { turnRef: modelRef, decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: clock() };
  const c = code(() => gate.confirmObjectives({ provenance: forged, decisions: [{ verb: "accept", proposalId: tp.id }] }));
  check("A5 a model-channel turn cannot confirm a teacher-authored proposal", c !== null && gate.checkpoints().objectives.status !== "confirmed", `code=${c}`);
  gate.confirmObjectives({ provenance: say("Accept mine."), decisions: [{ verb: "accept", proposalId: tp.id }] });
  const [obj] = gate.confirmedObjectives();
  check("A6 only a teacher turn confirms it; the confirmed record keeps proposedBy=teacher", obj?.proposedBy === "teacher" && gate.checkpoints().objectives.status === "confirmed", `proposedBy=${obj?.proposedBy}`);
  const planSpec = { title: "L", activities: [{ title: "Sort", minutes: 15, objectiveIds: [tp.id], materialVersionIds: ["mv_0001@v2"], learnerDoes: "Classify devices.", teacherDoes: "Facilitates.", evidenceIfAny: "observation", notEvidence: "Asking the assistant a question is not evidence." }] };
  const dc = code(() => gate.proposeLessonPlan(planSpec));
  if (dc) console.log("note: could not build a plan with my activity shape:", dc);
  else {
    const mref = ledger.recordAssistantTurn("Plan confirmed.", { channel: "model" });
    const c2 = code(() => gate.confirmLessonPlan({ provenance: { turnRef: mref, decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: clock() }, teacherEditCount: 3 }));
    check("A7 teacherEditCount does not substitute for a teacher turn: model-channel provenance + count -> refused, plan stays draft, no marker", c2 !== null && gate.currentPlan().status === "draft" && gate.currentPlan().editedByTeacher === undefined, `code=${c2}`);
    const c3 = code(() => gate.confirmLessonPlan({ teacherEditCount: 3 }));
    check("A8 no provenance + count -> refused", c3 !== null && gate.currentPlan().status === "draft", `code=${c3}`);
    for (const badN of [0, -1, 1.5, "2", NaN, null]) {
      const c4 = code(() => gate.confirmLessonPlan({ provenance: say("Confirm."), teacherEditCount: badN }));
      check(`A9 teacherEditCount=${String(badN)} -> BAD_INPUT, plan stays draft`, c4 === "BAD_INPUT" && gate.currentPlan().status === "draft", `code=${c4}`);
    }
  }
}

/* ------------------------------------------------------------------ B: the host over HTTP */
crypto.randomUUID = (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })();
syncBuiltinESMExports();
Date.now = () => 1767225600000;
const { createApp } = await imp("host/server.mjs");
const { PlanWorker } = await imp("host/worker.mjs");
const { chatCompletion } = await imp("host/test/scripted-course.mjs");
const fakeModel = async (_u, init) => new Response(JSON.stringify(chatCompletion(JSON.parse(init.body))), { status: 200, headers: { "content-type": "application/json" } });
const noAsfai = { status: () => ({ connected: false }), runIntake: async () => { throw Object.assign(new Error("off"), { code: "OFF" }); }, validate: async () => null };
const dir = mkdtempSync(join(tmpdir(), "n6v-auth-"));
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: "http://127.0.0.1:9/v1/chat/completions", model: "m", fetchImpl: fakeModel }), sources: [], asfai: noAsfai });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json() };
};
try {
  const created = await call("POST", "/api/courses", { owner: "Ada Lovelace", title: "auth" });
  const c = `/api/courses/${encodeURIComponent(created.json.courseId)}`;
  await call("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the empty material list." });
  await call("POST", `${c}/intake/answer`, { text: "Brief.", answers: { topic: "photosynthesis", course: "Science, ages 8-10", learning_outcomes: "Students can explain how a plant makes food." } });
  await call("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const prop = await call("POST", `${c}/objectives`, { proposedBy: "ai", items: [{ kind: "local", statement: "FORGED-BY-CLIENT", proposedBy: "teacher" }] });
  const by = (prop.json.proposals ?? []).map((p) => p.by);
  const stm = (prop.json.proposals ?? []).map((p) => p.statement);
  check("B1 a hostile /objectives body (items[] + proposedBy) injects nothing: the only proposal is the teacher's own wizard line", prop.status === 200 && stm.length === 1 && !JSON.stringify(prop.json).includes("FORGED-BY-CLIENT"), `status=${prop.status} statements=${JSON.stringify(stm)}`);
  check("B2 the host decides authorship itself: client 'proposedBy:\"ai\"' does not relabel the wizard line (by=teacher)", by.length === 1 && by[0] === "teacher", JSON.stringify(by));
  await call("POST", `${c}/decisions`, { text: "Accept.", decisions: (prop.json.proposals ?? []).map((p) => ({ verb: "accept", proposalId: p.id })) });
  await call("POST", `${c}/plan`, {});
  const conf = await call("POST", `${c}/plan/confirm`, { text: "Confirm the lesson plan.", teacherEditCount: 99, editedByTeacher: true });
  const slug = readdirSync(dir).find((n) => n.startsWith("urn"));
  const lines = readFileSync(join(dir, slug, "events.ndjson"), "utf8").split("\n").filter(Boolean);
  const confLine = lines.find((l) => l.includes('"plan.confirmed"')) ?? "";
  const exp1 = (await call("GET", `${c}/export`)).json;
  check("B3 client-supplied teacherEditCount/editedByTeacher on /plan/confirm is ignored: no marker in the log or export", conf.status === 200 && !confLine.includes("teacherEditCount") && !confLine.includes("editedByTeacher") && exp1.plan.teacherEditCount === undefined && exp1.plan.editedByTeacher !== true, `status=${conf.status} plan.editedByTeacher=${exp1.plan.editedByTeacher} count=${exp1.plan.teacherEditCount}`);
  const ed = await call("POST", `${c}/plan/edit`, { planId: exp1.plan.id, text: "Edit the title.", edits: [{ path: "title", value: "Plants make food" }], teacherEditCount: 50, editedByTeacher: true });
  const conf2 = await call("POST", `${c}/plan/confirm`, { text: "Confirm the edited plan.", teacherEditCount: 50 });
  const exp2 = (await call("GET", `${c}/export`)).json;
  check("B4 after one real edit the recorded count is 1, whatever the client claimed", ed.status === 200 && conf2.status === 200 && exp2.plan.teacherEditCount === 1 && exp2.plan.editedByTeacher === true, `edit=${ed.status} confirm=${conf2.status} count=${exp2.plan.teacherEditCount}`);
  check("B5 the draft's origin is still 'ai' in the export after a teacher edit", exp2.plan.proposedBy === "ai", `proposedBy=${exp2.plan.proposedBy}`);
  const ver = (await call("GET", `${c}/verify`)).json;
  check("B6 hash chain verifies after all of the above", ver.ok === true, JSON.stringify(ver).slice(0, 120));
} finally { app.closeAllConnections?.(); app.close(); rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
