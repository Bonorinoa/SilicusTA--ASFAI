#!/usr/bin/env node
/**
 * Plan reliability gate. Default mode is fully scripted and makes no model call.
 * `--live` starts the real local host through its credential launcher and makes one
 * plan request for each fixture. The launcher, not this file, reads the env file.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { CourseSession } from "../../host/course.mjs";
import { CourseStore } from "../../host/store.mjs";
import { FIXTURES } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const FINAL_MESSAGE = "Silicus couldn't finish this plan. Try again, or shorten the sources.";
const RETRYABLE = (code) => Object.assign(new Error(`scripted ${code}`), { code });

export function assertCompletePlan(plan, label = "plan") {
  assert.ok(Array.isArray(plan?.activities) && plan.activities.length > 0, `${label}: activities are required`);
  for (const [i, activity] of plan.activities.entries()) {
    assert.ok(Number.isInteger(activity?.minutes) && activity.minutes > 0, `${label}: activity ${i + 1} needs positive whole minutes`);
    assert.ok(Array.isArray(activity?.objectiveIds) && activity.objectiveIds.length > 0, `${label}: activity ${i + 1} needs an objective citation`);
  }
  return plan;
}

function readySession(store, fixture, suffix = "") {
  const session = CourseSession.create(store, {
    owner: "teacher:reliability",
    title: `${fixture.title}${suffix}`,
    materials: fixture.materials.map((name) => ({ name })),
    ...(fixture.ages ? { ages: fixture.ages } : {}),
    lessonMinutes: fixture.lessonMinutes,
    objectivesConfirm: "explicit",
  });
  session.confirmCheckpoint({ id: "files", text: "Confirm the source list." });
  session.answerIntake({
    text: "Record the teacher's brief.",
    answers: { topic: fixture.title, course: fixture.title, learning_outcomes: fixture.objectives.join("\n") },
  });
  session.confirmCheckpoint({ id: "outline", text: "Confirm the brief." });
  session.decideObjectives({
    text: "Add the teacher's objectives.",
    decisions: fixture.objectives.map((statement) => ({ verb: "add", statement })),
  });
  session.confirmObjectives({ text: "Confirm the objectives." });
  return session;
}

function scriptedPlan(args, fixture) {
  const count = Math.min(4, Math.max(1, Math.ceil(args.objectives.length / 12)));
  const buckets = Array.from({ length: count }, () => []);
  args.objectives.forEach((o, i) => buckets[i % count].push(o.id));
  const minutes = Math.max(1, Math.floor(fixture.lessonMinutes / count));
  return {
    title: `${fixture.title}: lesson plan`,
    // Deliberately wrong: the display is tested against the course record, never this guess.
    audience: { ageRangeStart: 18, ageRangeEnd: 40 },
    activities: buckets.map((objectiveIds, i) => ({
      title: `Activity ${i + 1}`,
      minutes,
      objectiveIds,
      learnerDoes: `Learners complete step ${i + 1} and explain their choice.`,
      teacherDoes: `The teacher checks step ${i + 1} against the confirmed objectives.`,
      evidenceIfAny: "work-product",
      citations: [],
    })),
  };
}

async function scriptedFixture(fixture) {
  const dir = mkdtempSync(join(tmpdir(), "silicus-plan-rel-"));
  try {
    const store = new CourseStore(dir);
    const session = readySession(store, fixture);
    let calls = 0;
    const worker = { draft: async (args) => {
      calls += 1;
      if (fixture.id === "short-stage-1" && calls === 1) throw RETRYABLE("WORKER_TRUNCATED");
      if (fixture.id === "stage-2-boundary-empty-retry" && calls === 1) throw RETRYABLE("WORKER_BAD_OUTPUT");
      return scriptedPlan(args, fixture);
    } };
    const started = performance.now();
    const result = await session.draftPlanFromObjectives({ worker });
    assert.equal(result.ok, true, `${fixture.id}: ${JSON.stringify(result)}`);
    assertCompletePlan(result.plan, fixture.id);
    const view = session.view();
    const actions = view.activity.map((item) => item.action);
    return {
      id: fixture.id,
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      calls,
      retries: actions.filter((a) => a === "plan.retry").length,
      actions: actions.slice(-2),
      activities: result.plan.activities.length,
      objectiveCitations: result.plan.activities.reduce((n, a) => n + a.objectiveIds.length, 0),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function scriptedFinalFailure() {
  const dir = mkdtempSync(join(tmpdir(), "silicus-plan-rel-fail-"));
  try {
    const store = new CourseStore(dir);
    const session = readySession(store, FIXTURES[0], " final failure");
    let calls = 0;
    const result = await session.draftPlanFromObjectives({ worker: { draft: async () => { calls += 1; throw RETRYABLE("WORKER_BAD_OUTPUT"); } } });
    const last = session.view().activity.at(-1);
    return { calls, code: result.code, message: result.reason, action: last?.action ?? null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runScripted() {
  const fixtures = [];
  for (const fixture of FIXTURES) fixtures.push(await scriptedFixture(fixture));
  const truncated = fixtures.find((f) => f.id === "short-stage-1");
  const empty = fixtures.find((f) => f.id === "stage-2-boundary-empty-retry");
  const finalFailure = await scriptedFinalFailure();
  assert.deepEqual(truncated?.actions, ["plan.retry", "plan.drafted"]);
  assert.deepEqual(empty?.actions, ["plan.retry", "plan.drafted"]);
  assert.deepEqual(finalFailure, { calls: 2, code: "PLAN_DRAFT_FAILED", message: FINAL_MESSAGE, action: "plan.failed" });
  return {
    mode: "scripted", total: FIXTURES.length, finished: fixtures.filter((f) => f.ok).length,
    fixtures,
    retryProbe: { calls: truncated.calls, actions: truncated.actions },
    emptyRetryProbe: { calls: empty.calls, actions: empty.actions },
    finalFailure,
  };
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function request(origin, method, path, body, timeoutMs = 30_000) {
  const started = performance.now();
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* retained as null */ }
  return { status: response.status, json, latencyMs: Math.round(performance.now() - started) };
}

async function must(origin, method, path, body, status = 200, timeoutMs = 30_000) {
  const response = await request(origin, method, path, body, timeoutMs);
  if (response.status !== status) throw new Error(`${method} ${path}: ${response.status} ${response.json?.code ?? "NO_JSON"} ${response.json?.message ?? ""}`);
  return response;
}

async function waitReady(origin, child) {
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`host exited before readiness (${child.exitCode})`);
    try {
      const status = await request(origin, "GET", "/api/worker/status", undefined, 1000);
      if (status.status === 200 && status.json?.configured === true) return status.json;
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("host was not ready within 45 seconds");
}

async function liveFixture(origin, fixture) {
  let coursePath = null;
  const started = performance.now();
  try {
    const created = await must(origin, "POST", "/api/courses", {
      owner: "teacher:reliability", title: fixture.title,
      materials: fixture.materials.map((name) => ({ name })),
      ...(fixture.ages ? { ages: fixture.ages } : {}),
      lessonMinutes: fixture.lessonMinutes, objectivesConfirm: "explicit",
    }, 201);
    coursePath = `/api/courses/${encodeURIComponent(created.json.courseId)}`;
    await must(origin, "POST", `${coursePath}/checkpoints`, { id: "files", text: "Confirm the source list." });
    await must(origin, "POST", `${coursePath}/intake/answer`, {
      text: "Record the teacher's brief.",
      answers: { topic: fixture.title, course: fixture.title, learning_outcomes: fixture.objectives.join("\n") },
    });
    await must(origin, "POST", `${coursePath}/checkpoints`, { id: "outline", text: "Confirm the brief." });
    await must(origin, "POST", `${coursePath}/decisions`, {
      text: "Add the teacher's objectives.", decisions: fixture.objectives.map((statement) => ({ verb: "add", statement })),
    });
    await must(origin, "POST", `${coursePath}/objectives/confirm`, { text: "Confirm the objectives." });
    const drafted = await request(origin, "POST", `${coursePath}/plan`, {}, 260_000);
    const view = await must(origin, "GET", coursePath);
    const retries = (view.json?.activity ?? []).filter((a) => a.action === "plan.retry").length;
    if (drafted.status !== 200) {
      return { id: fixture.id, ok: false, latencyMs: Math.round(performance.now() - started), attempts: retries + 1, code: drafted.json?.code ?? `HTTP_${drafted.status}`, message: drafted.json?.message ?? "no message" };
    }
    assertCompletePlan(drafted.json, fixture.id);
    return {
      id: fixture.id, ok: true, latencyMs: drafted.latencyMs, attempts: retries + 1,
      activities: drafted.json.activities.length,
      objectiveCitations: drafted.json.activities.reduce((n, a) => n + a.objectiveIds.length, 0),
    };
  } catch (error) {
    return { id: fixture.id, ok: false, latencyMs: Math.round(performance.now() - started), attempts: null, code: error?.code ?? "RUNNER_ERROR", message: error instanceof Error ? error.message : String(error) };
  }
}

function costsFromLog(log) {
  return [...log.matchAll(/worker usage task=plan\b[^\n]*\bcost=([0-9]+(?:\.[0-9]+)?(?:e[+-]?\d+)?)/gi)].map((m) => Number(m[1])).filter(Number.isFinite);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function runLive({ envFile = process.env.SILICUS_WORKER_ENV_FILE ?? join(homedir(), ".silicus", "worker.env") } = {}) {
  if (!existsSync(envFile)) throw new Error(`worker env file not found: ${envFile}`);
  const dataDir = mkdtempSync(join(tmpdir(), "silicus-plan-rel-live-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let log = "";
  const child = spawn(process.execPath, [join(ROOT, "host", "scripts", "with-worker-env.mjs"), envFile], {
    cwd: ROOT,
    env: {
      ...process.env,
      SILICUS_WORKER_ENV_FILE: envFile,
      SILICUS_WORKER_LOG_USAGE: "1",
      SILICUS_HOST_DATA: dataDir,
      SILICUS_HOST_PORT: String(port),
      SILICUS_SOURCE_ASFAI: "0",
      SILICUS_SOURCE_MARBLE: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  try {
    const worker = await waitReady(origin, child);
    const fixtures = [];
    for (const fixture of FIXTURES) fixtures.push(await liveFixture(origin, fixture));
    await stopChild(child);
    const finished = fixtures.filter((f) => f.ok).length;
    const times = fixtures.filter((f) => f.ok).map((f) => f.latencyMs);
    const costs = costsFromLog(log);
    const costUsd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;
    return {
      mode: "live", model: worker.model ?? null, provider: worker.provider ?? null, zdr: worker.zdr === true,
      total: FIXTURES.length, finished, fixtures,
      p50Ms: percentile(times, 0.50), p95Ms: percentile(times, 0.95),
      planModelCalls: costs.length, costUsd,
      budgetUsd: 0.30,
      target: { finish: finished === FIXTURES.length, p95Under75s: times.length === FIXTURES.length && percentile(times, 0.95) < 75_000 },
    };
  } finally {
    await stopChild(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  const live = process.argv.includes("--live");
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag >= 0 ? process.argv[outFlag + 1] : null;
  const result = live ? await runLive() : await runScripted();
  const text = JSON.stringify(result, null, 2) + "\n";
  if (out) writeFileSync(resolve(out), text);
  process.stdout.write(text);
  if (result.finished !== result.total || (result.costUsd !== null && result.costUsd > result.budgetUsd)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
