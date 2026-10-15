/**
 * local-only.test.mjs — the teacher who never connects ASFAI.
 *
 * The host is wired to an ASFAI that is NOT connected (no consent was ever given), and
 * the mock counts every MCP request that reaches it. The whole one-teacher story must
 * still run: the host asks its own questions, the teacher's answers authorize the
 * outline, the objectives derive from those answers, the worker drafts the plan, and
 * the package seals — with zero calls to ASFAI.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { PlanWorker } from "../worker.mjs";
import { startMockWorker } from "./mock-worker.mjs";
import { startMockAsfai } from "./mock-asfai.mjs";
import { TokenStore } from "../asfai/tokens.mjs";
import { AsfaiOAuth } from "../asfai/oauth.mjs";
import { AsfaiClient } from "../asfai/mcp.mjs";
import { AsfaiService } from "../asfai/service.mjs";

const CLOSERS = [];
after(() => CLOSERS.forEach((c) => c()));

/** A worker that echoes the objective ids it was handed, so the plan is genuinely citable. */
const echoingWorker = () => async ({ prompt }) => {
  const ids = [...String(prompt).matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
  return {
    title: "Seeing the claim",
    audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: ids.map((id, i) => ({
      title: `Activity ${i + 1}`, minutes: 20, objectiveIds: [id],
      learnerDoes: "Read one AI answer and mark the sentence that makes a claim.",
      teacherDoes: "Ask what would count as evidence for it.",
      evidenceIfAny: "observation",
    })),
  };
};

async function boot() {
  const asfaiMock = await startMockAsfai(); CLOSERS.push(() => asfaiMock.close());
  const oauth = new AsfaiOAuth({ prmUrl: asfaiMock.prmUrl, redirectUri: "http://127.0.0.1:1/cb", tokenStore: new TokenStore(null), allowInsecure: true });
  const asfai = new AsfaiService({ oauth, client: new AsfaiClient({ oauth, url: asfaiMock.mcpUrl }) });
  const wm = await startMockWorker({ reply: echoingWorker() }); CLOSERS.push(() => wm.close());
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "silicus-local-")), asfai, worker: new PlanWorker({ url: wm.url, model: "test" }) });
  CLOSERS.push(() => { app.closeAllConnections?.(); app.close(); });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (p, b) => {
    const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, json: await r.json() };
  };
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, json: await r.json() }; };
  return { asfaiMock, post, get, base };
}

test("a teacher who never connects ASFAI reaches a sealed, verified package", async () => {
  const { asfaiMock, post, get } = await boot();
  assert.equal((await get("/api/asfai/status")).json.connected, false, "ASFAI is not connected");

  const { json: { courseId } } = await post("/api/courses", { owner: "teacher:tk-1", title: "AI literacy" });
  const c = `/api/courses/${courseId}`;
  await post(`${c}/checkpoints`, { id: "files", text: "Confirm the material list." });

  // The host's own questions, answered one at a time, in the teacher's words.
  let intake = (await get(`${c}/intake`)).json;
  assert.equal(intake.questionsFrom, "local");
  assert.deepEqual(intake.questions.map((q) => q.id), ["topic", "course", "learning_outcomes"]);
  assert.equal(intake.outlineAuthorized, false, "asking is not answering");

  // The outline cannot be confirmed on the questions alone.
  const early = await post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  assert.equal(early.status, 409);
  assert.equal(early.json.code, "MISSING_DRAFT_AUTHORIZATION");

  await post(`${c}/intake/answer`, { text: "how AI answers are built", answers: { topic: "how AI answers are built" } });
  await post(`${c}/intake/answer`, { text: "AI literacy, ages 8-10", answers: { course: "AI literacy, ages 8-10" } });
  assert.equal((await get(`${c}/intake`)).json.outlineAuthorized, false, "two of three");
  await post(`${c}/intake/answer`, { text: "explain an algorithm", answers: { learning_outcomes: "explain an algorithm" } });
  intake = (await get(`${c}/intake`)).json;
  assert.equal(intake.outlineAuthorized, true);

  assert.equal((await post(`${c}/checkpoints`, { id: "outline", text: "Confirm the outline." })).status, 200);
  const prop = await post(`${c}/objectives`, {});
  assert.equal(prop.status, 200);
  const decisions = prop.json.proposals.map((p) => ({ verb: "accept", proposalId: p.id }));
  assert.equal((await post(`${c}/decisions`, { decisions, text: "Accept them all." })).status, 200);
  assert.equal((await post(`${c}/plan`, {})).status, 200);
  assert.equal((await post(`${c}/plan/confirm`, { text: "Confirm the plan." })).status, 200);
  assert.equal((await post(`${c}/publish`, { text: "Publish it." })).status, 200);

  const view = (await get(c)).json;
  assert.equal(view.intake.questionsFrom, "local");
  assert.deepEqual(view.proposals.map((p) => p.statement), ["explain an algorithm"], "the teacher's own words");
  assert.ok(view.proposals.every((p) => p.source === "from your answer"));
  assert.deepEqual(view.objectives.map((o) => o.statement), ["explain an algorithm"], "derived, not invented");
  assert.ok(view.objectives.every((o) => o.id.startsWith("urn:uuid:")), "local URN identity");
  assert.equal(view.checkpoints.publish.status, "confirmed");
  assert.equal(view.versions.length, 1);
  assert.equal((await get(`${c}/verify`)).json.ok, true);

  // ...and nothing was ever sent to ASFAI.
  assert.equal(asfaiMock.st.calls.length, 0, "no MCP request ever reached ASFAI");
  assert.equal(asfaiMock.st.toolArgs, undefined);
});

test("the intake/call route still refuses cleanly when ASFAI is not connected, and the course is untouched", async () => {
  const { post, get } = await boot();
  const { json: { courseId } } = await post("/api/courses", { owner: "teacher:tk-1", title: "t" });
  const c = `/api/courses/${courseId}`;
  await post(`${c}/intake/answer`, { text: "all", answers: { topic: "t", course: "c", learning_outcomes: "o" } });
  const r = await post(`${c}/intake/call`, {});
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "AUTH_REQUIRED");
  const intake = (await get(`${c}/intake`)).json;
  assert.equal(intake.questionsFrom, "local", "a refused ASFAI call consulted nothing");
  assert.equal(intake.outlineAuthorized, true, "and the teacher's local path is intact");
});
