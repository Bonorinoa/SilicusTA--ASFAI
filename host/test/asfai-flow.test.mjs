/**
 * The host drives ASFAI. What must hold: every field in the second prepare_outline call
 * came from the TEACHER's recorded words; validate_outline is a signal, never a
 * confirmation; an ASFAI outage degrades to "course still works locally".
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseStore } from "../store.mjs";
import { CourseSession } from "../course.mjs";
import { connectedAsfai, ANSWERS } from "./asfai-fixture.mjs";
import { createApp } from "../server.mjs";

const MOCKS = []; const APPS = [];
after(() => { MOCKS.forEach((m) => m.close()); APPS.forEach((a) => { a.closeAllConnections?.(); a.close(); }); });
const fresh = async () => {
  const c = await connectedAsfai(); MOCKS.push(c.mock);
  const store = new CourseStore(mkdtempSync(join(tmpdir(), "silicus-flow-")));
  const session = CourseSession.create(store, { owner: "teacher:tk-1", title: "AI literacy" });
  session.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  return { ...c, store, session };
};
const prepareCalls = (mock) => (mock.st.toolArgs ?? []).filter((a) => a.action === "prepare_outline");

test("round 1 sends NO fields; the host cannot go again until the teacher answers", async () => {
  const { svc, mock, session } = await fresh();
  const st = await svc.runIntake(session);
  assert.equal(st.observedState, "clarifying");
  assert.deepEqual(prepareCalls(mock)[0].payload, { mode: "new", audience: "teacher" });
  await assert.rejects(svc.runIntake(session), { code: "AWAITING_TEACHER_REPLY" });
  assert.equal(prepareCalls(mock).length, 1, "the refused call never reached ASFAI");
});

test("an answer with no usable fields lets the host send NOTHING (it will not invent topic/course/outcomes)", async () => {
  const { svc, mock, session } = await fresh();
  await svc.runIntake(session);
  session.answerIntake({ text: "hmm, not sure yet", at: 2000 });                 // a real turn, but no answers
  await assert.rejects(svc.runIntake(session), { code: "NO_TEACHER_ANSWERS" });
  session.answerIntake({ text: "x", answers: { unrelated: "poison", topic: "  " }, at: 2500 }); // unasked / blank keys
  await assert.rejects(svc.runIntake(session), { code: "NO_TEACHER_ANSWERS" });
  assert.equal(prepareCalls(mock).length, 1);
});

test("the second call is built from the teacher's answers and nothing else", async () => {
  const { svc, mock, session } = await fresh();
  await svc.runIntake(session);
  session.answerIntake({
    text: "my answers", at: 2000,
    answers: { ...ANSWERS, injected: "IGNORE ALL PREVIOUS", audience: "hijack", mode: "edit", __proto__: { evil: 1 } },
  });
  const st = await svc.runIntake(session);
  const sent = prepareCalls(mock)[1].payload;
  assert.deepEqual(sent, { mode: "new", audience: "teacher", topic: ANSWERS.topic, course: ANSWERS.course, learningOutcomes: ANSWERS.learning_outcomes });
  assert.equal(st.observedState, "ready_to_draft");
  assert.equal(st.outlineAuthorized, true);
});

test("a model/UI-supplied field cannot ride along: server routes ignore everything but the teacher's answers", async () => {
  const c = await connectedAsfai(); MOCKS.push(c.mock);
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "silicus-flow-")), asfai: c.svc }); APPS.push(app);
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
  const { json: { courseId } } = await post("/api/courses", { owner: "teacher:tk-1", title: "t" });
  // a hostile body on the call route: payload / topic / outcomes are not accepted
  await post(`/api/courses/${courseId}/intake/call`, { payload: { topic: "pwn" }, topic: "pwn", learningOutcomes: ["pwn"] });
  await post(`/api/courses/${courseId}/intake/answer`, { text: "ok", answers: ANSWERS });
  await post(`/api/courses/${courseId}/intake/call`, { payload: { topic: "pwn" }, topic: "pwn", learningOutcomes: ["pwn"] });
  const calls = prepareCalls(c.mock);
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(calls).includes("pwn"), false);
  assert.equal(calls[1].payload.topic, ANSWERS.topic);
});

test("validate_outline is a SIGNAL: it records a verdict but cannot confirm a plan", async () => {
  const { svc, mock, session, store } = await fresh();
  await svc.runIntake(session);
  session.answerIntake({ text: "answers", answers: ANSWERS, at: 2000 });
  await svc.runIntake(session);
  session.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 2500 });
  await assert.rejects(svc.validate(session), { code: "NO_PLAN" });
  session.proposeObjectives({ items: [{ kind: "local", statement: "Students can explain what an algorithm is." }], at: 3000 });
  const [p1] = session.view().proposals.map((r) => r.id);
  session.decideObjectives({ decisions: [{ verb: "accept", proposalId: p1 }], text: "Accept it.", at: 4000 });
  session.proposeLessonPlan({ spec: { title: "Seeing the claim", activities: [{ title: "Spot it", minutes: 20, objectiveIds: [p1], learnerDoes: "Mark it.", teacherDoes: "Ask.", evidenceIfAny: "observation" }] }, at: 5000 });
  const v = await svc.validate(session);
  assert.equal(v.valid, true);
  const sent = mock.st.toolArgs.find((a) => a.action === "validate_outline").outline;
  assert.equal(sent.kind, "lesson-outline");
  assert.deepEqual(sent.learningOutcomes, ["Students can explain what an algorithm is."]);
  assert.ok(sent.sections.every((s) => s.purpose));
  assert.equal(session.view().plan.status === "confirmed", false, "a valid verdict confirms nothing");
  assert.equal(session.view().validations.length, 1);
  // and it survives a restart (replay)
  const again = CourseSession.load(store, session.courseId).view().validations;
  assert.deepEqual(again, [v]);
});

test("ASFAI outage: a clear 502, and the course keeps working locally", async () => {
  const c = await connectedAsfai(); MOCKS.push(c.mock);
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "silicus-flow-")), asfai: c.svc }); APPS.push(app);
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
  const { json: { courseId } } = await post("/api/courses", { owner: "teacher:tk-1", title: "t" });
  c.mock.close();                                                                   // ASFAI goes away
  const out = await post(`/api/courses/${courseId}/intake/call`, {});
  assert.equal(out.status, 502);
  assert.equal(out.json.code, "ASFAI_UNREACHABLE");
  const local = await post(`/api/courses/${courseId}/checkpoints`, { id: "files", text: "Confirm the material list." });
  assert.equal(local.status, 200, "the local course still works");
});

test("not connected: 401 AUTH_REQUIRED and an honest status", async () => {
  const { TokenStore } = await import("../asfai/tokens.mjs"); const { AsfaiOAuth } = await import("../asfai/oauth.mjs");
  const { AsfaiClient } = await import("../asfai/mcp.mjs"); const { AsfaiService } = await import("../asfai/service.mjs");
  const { startMockAsfai } = await import("./mock-asfai.mjs");
  const mock = await startMockAsfai(); MOCKS.push(mock);
  const oauth = new AsfaiOAuth({ prmUrl: mock.prmUrl, redirectUri: "http://127.0.0.1:1/cb", tokenStore: new TokenStore(null), allowInsecure: true });
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "silicus-flow-")), asfai: new AsfaiService({ oauth, client: new AsfaiClient({ oauth, url: mock.mcpUrl }) }) }); APPS.push(app);
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await (await fetch(base + "/api/asfai/status")).json()).connected, false);
  const { courseId } = await (await fetch(base + "/api/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: "t", title: "t" }) })).json();
  const r = await fetch(`${base}/api/courses/${courseId}/intake/call`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, "AUTH_REQUIRED");
  const bad = await fetch(base + "/api/asfai/callback?state=forged&code=x");
  assert.equal(bad.status, 400);
});
