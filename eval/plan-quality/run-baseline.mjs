/**
 * run-baseline.mjs — B1 baseline: draft lesson plans through the REAL host API with the
 * configured worker (paid, OpenRouter ZDR), for the three courses of the 14 November round,
 * two runs each (6 plans). No scoring, no publishing, no product or prompt change.
 *
 *   node eval/plan-quality/run-baseline.mjs
 *
 * Starts its OWN host from <repo>/host via `npm run start:worker` on a free loopback port,
 * with an isolated SILICUS_HOST_DATA temp dir (never the owner's ~/.silicus/host) and the
 * worker env file named by SILICUS_WORKER_ENV_FILE (default ~/.silicus/worker.env).
 * The launcher reads the credential file; this script never reads, prints or copies it.
 *
 * For every run (course x 2): create course -> confirm material list -> answer the host's
 * own intake questions (topic / course / learning_outcomes) -> confirm outline -> derive
 * objectives from the answers -> teacher accepts them all -> POST /plan (the ONE model
 * call) -> confirm the plan. The drafted plan JSON, the model id the worker reported,
 * the draft latency and the sha-256 of the plan are saved to
 * `eval/plan-quality/baseline-2026-11-14/<slug>-<run>.json`; a manifest.json summarises.
 *
 * Exit 0: six plans drafted and saved, chain verified. Exit 1: anything failed.
 */
import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const HOST_DIR = join(ROOT, "host");
const OUT_DIR = join(HERE, "baseline-2026-11-14");
const ENV_FILE = resolve(process.env.SILICUS_WORKER_ENV_FILE ?? join(homedir(), ".silicus", "worker.env"));
const READY_TIMEOUT_MS = 45_000;
const PLAN_TIMEOUT_MS = 150_000;
const MODEL_CALLS_EXPECTED = 6; // two runs of three courses; ONLY POST /plan calls a model

/** The three courses of the round. Objectives and evidence lines come from
 * docs/committee/2026-11-12-marble-examples.md (teacher's words to confirm); Ecom 57 is the
 * control: three short objectives written as a teacher would. */
const SPECS = [
  {
    slug: "smart-versus-not-smart-devices",
    title: "Smart Versus Not-Smart Devices",
    owner: "teacher",
    description:
      "Marble objective mt_WRRv1ABECC, Smart Versus Not-Smart Devices, ages 5-8. " +
      "Hard prerequisite for AI in Daily Life: the child must understand smart things before spotting AI. " +
      "The teacher confirms: sort objects into 'responds to input' and 'does the same thing every time'; " +
      "a smart speaker is not a radio; an automatic door senses and responds.",
    materials: [{ name: "Marble lesson walk, step 1: Smart Versus Not-Smart Devices (mt_WRRv1ABECC), ages 5-8" }],
    topic: "how smart devices respond to input",
    course: "Smart Versus Not-Smart Devices, ages 5-8",
    outcomes:
      "Sort objects into 'responds to input' and 'does the same thing every time'\n" +
      "Know that a smart speaker is not a radio\n" +
      "Know that an automatic door senses and responds",
  },
  {
    slug: "ai-in-daily-life",
    title: "AI in Daily Life",
    owner: "teacher",
    description:
      "Marble objective mt_AzTrT5ySCx, AI in Daily Life, ages 5-12; standards include ACARA AC9TDI2P03 " +
      "and Ontario science A2.2 for grades 1-6. The teacher confirms: at least five everyday examples " +
      "(face recognition, recommendations, predictive text, speech recognition, translation); they use " +
      "patterns and data, not magic; one way it helps, one time it fails.",
    materials: [{ name: "Marble lesson walk, step 2: AI in Daily Life (mt_AzTrT5ySCx), ages 5-12" }],
    topic: "where AI shows up in everyday life",
    course: "AI in Daily Life, ages 5-12",
    outcomes:
      "Give at least five everyday examples of AI such as face recognition, recommendations, predictive text, speech recognition and translation\n" +
      "Explain that these everyday tools use patterns and data, not magic\n" +
      "Describe one way AI helps and one time it fails",
  },
  {
    slug: "ecom-57-introductory-statistics",
    title: "Ecom 57, introductory statistics",
    owner: "teacher",
    description:
      "Control course: introductory statistics for university students, ages 19. " +
      "Three short objectives a teacher would write; no Marble node is involved.",
    materials: [{ name: "Ecom 57 course notes (introductory statistics, ages 19)" }],
    topic: "introductory statistics",
    course: "Ecom 57, introductory statistics, ages 19",
    outcomes:
      "Interpret a regression coefficient in plain language\n" +
      "Explain why correlation does not imply causation\n" +
      "Read a scatter plot and describe the direction and strength of the association",
  },
];

function portInUse(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (used) => { socket.removeAllListeners(); socket.destroy(); resolvePort(used); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function freePort(from = 8799) {
  for (let p = from; p < from + 20; p++) if (!(await portInUse(p))) return p;
  throw new Error("no free loopback port in 8799-8818");
}

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function safeLauncherLines(logPath) {
  try {
    return readFileSync(logPath, "utf8").split("\n").filter((l) => l.startsWith("silicus-host:")).slice(-10).join("\n");
  } catch { return ""; }
}

function whitelistStatus(body) {
  return {
    configured: body?.configured === true,
    zdr: body?.zdr === true,
    provider: typeof body?.provider === "string" ? body.provider : null,
    model: typeof body?.model === "string" ? body.model : null,
    typicalSeconds: body?.typicalSeconds ?? null,
  };
}

async function waitReady(child, logPath, origin) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`host exited ${child.exitCode} before it was ready\n${safeLauncherLines(logPath)}`);
    }
    try {
      const r = await fetch(`${origin}/api/worker/status`, { signal: AbortSignal.timeout(1000) });
      const body = await r.json();
      last = whitelistStatus(body);
      if (last.configured) return last;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`worker was not configured:true within ${READY_TIMEOUT_MS / 1000}s\n${safeLauncherLines(logPath)} (last: ${JSON.stringify(last)})`);
}

class Api {
  constructor(origin) { this.origin = origin; }
  async req(method, path, body, timeoutMs = 30_000) {
    const t0 = performance.now();
    const r = await fetch(`${this.origin}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON reply */ }
    return { httpStatus: r.status, json, latencyMs: Math.round(performance.now() - t0) };
  }
  async must(method, path, body, want = 200, timeoutMs = 30_000) {
    const r = await this.req(method, path, body, timeoutMs);
    if (r.httpStatus !== want) {
      throw new Error(`${method} ${path}: expected ${want}, got ${r.httpStatus} ${JSON.stringify(r.json)?.slice(0, 300)}`);
    }
    return r;
  }
}

async function runOne(api, spec, run, outDir, worker) {
  const created = await api.must("POST", "/api/courses", {
    owner: spec.owner, title: spec.title, description: spec.description, materials: spec.materials,
  }, 201);
  const courseId = created.json.courseId;
  const c = `/api/courses/${encodeURIComponent(courseId)}`;

  await api.must("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  const intakeBefore = await api.must("GET", `${c}/intake`);
  await api.must("POST", `${c}/intake/answer`, {
    text: `${spec.course}: the teacher's own answers.`,
    answers: { topic: spec.topic, course: spec.course, learning_outcomes: spec.outcomes },
  });
  const intakeAfter = await api.must("GET", `${c}/intake`);
  await api.must("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });

  const proposed = await api.must("POST", `${c}/objectives`, {});
  const proposals = proposed.json.proposals ?? [];
  if (proposals.length === 0) throw new Error(`${spec.slug} run ${run}: no proposals derived from answers`);

  await api.must("POST", `${c}/decisions`, {
    text: "Accept the objectives; they match my lesson.",
    decisions: proposals.map((p) => ({ verb: "accept", proposalId: p.id })),
  });

  // THE model call: the worker drafts from the confirmed objectives. Plan timeout is generous.
  const plan = await api.must("POST", `${c}/plan`, {}, 200, PLAN_TIMEOUT_MS);
  const planView = plan.json;
  const activities = planView?.activities ?? [];
  if (activities.length === 0) throw new Error(`${spec.slug} run ${run}: the draft has no activities`);

  await api.must("POST", `${c}/plan/confirm`, { text: "Confirm the lesson plan." });
  const view = await api.must("GET", `${c}`);
  if (view.json?.checkpoints?.plan?.status !== "confirmed") {
    throw new Error(`${spec.slug} run ${run}: plan checkpoint not confirmed after confirm (${view.json?.checkpoints?.plan?.status})`);
  }
  const verify = await api.must("GET", `${c}/verify`);
  if (verify.json?.ok !== true) throw new Error(`${spec.slug} run ${run}: chain does not verify`);

  const planSha256 = sha256(JSON.stringify(planView));
  const record = {
    course: spec.slug,
    run,
    courseId,
    title: spec.title,
    courseLabel: spec.course,
    modelId: worker.model,
    provider: worker.provider,
    zdr: worker.zdr,
    draftLatencyMs: plan.latencyMs,
    planSha256,
    chainHead: view.json?.integrity?.head ?? null,
    chainVerify: { ok: verify.json.ok, events: verify.json.events },
    intake: {
      questionsFrom: intakeBefore.json?.questionsFrom,
      outlineAuthorizedBefore: intakeBefore.json?.outlineAuthorized,
      outlineAuthorizedAfter: intakeAfter.json?.outlineAuthorized,
    },
    objectives: (view.json?.objectives ?? []).map((o) => ({ id: o.id, statement: o.statement })),
    plan: planView,
  };
  const fileName = `${spec.slug}-${run}.json`;
  const filePath = join(outDir, fileName);
  writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n");
  const onDisk = readFileSync(filePath, "utf8");
  const fileSha256 = sha256(onDisk);
  record.fileSha256 = fileSha256;
  writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n");
  return { record, filePath, fileSha256 };
}

async function main() {
  if (!existsSync(ENV_FILE)) {
    throw new Error(`worker env file not found: ${ENV_FILE}\n(the owner must create it; never read or copy its contents)`);
  }
  if (SPECS.length * 2 !== MODEL_CALLS_EXPECTED) throw new Error("spec/run layout changed; MODEL_CALLS_EXPECTED is stale");

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "silicus-b1-"));
  const logPath = join(dataDir, "host.log");
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn("npm", ["run", "start:worker"], {
    cwd: HOST_DIR,
    env: { ...process.env, SILICUS_WORKER_ENV_FILE: ENV_FILE, SILICUS_HOST_DATA: dataDir, SILICUS_HOST_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  try {
    const worker = await waitReady(child, logPath, origin);
    const kn = await (await fetch(`${origin}/api/knowledge/status`, { signal: AbortSignal.timeout(3000) })).json();
    console.log(`worker: model=${worker.model} provider=${worker.provider} zdr=${worker.zdr}`);
    console.log(`knowledge sources: ${JSON.stringify((kn.sources ?? []).map((s) => ({ id: s.id, enabled: s.enabled })))}`);
    console.log(`env file: ${ENV_FILE} (used by the launcher, not read here)`);

    mkdirSync(OUT_DIR, { recursive: true });
    const api = new Api(origin);
    const runs = [];
    let modelCalls = 0;
    for (const spec of SPECS) {
      for (let run = 1; run <= 2; run++) {
        const { record, filePath, fileSha256 } = await runOne(api, spec, run, OUT_DIR, worker);
        modelCalls += 1; // exactly one POST /plan per run
        runs.push({ ...record, filePath, fileSha256 });
        console.log(`#${modelCalls} ${spec.slug} run ${run}: plan ${record.planSha256.slice(0, 12)} latencyMs=${record.draftLatencyMs} -> ${filePath}`);
      }
    }

    if (modelCalls !== MODEL_CALLS_EXPECTED) throw new Error(`model calls: ${modelCalls}, expected ${MODEL_CALLS_EXPECTED}`);

    let gitHead = null;
    try { gitHead = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not fatal */ }
    const manifest = {
      generatedAt: new Date().toISOString(),
      gitHead,
      nodeVersion: process.version,
      script: "eval/plan-quality/run-baseline.mjs",
      worker: { modelId: worker.model, provider: worker.provider, zdr: worker.zdr, typicalSeconds: worker.typicalSeconds },
      knowledgeSources: (kn.sources ?? []).map((s) => ({ id: s.id, enabled: s.enabled })),
      modelCalls,
      runs: runs.map(({ filePath, fileSha256, ...r }) => ({ ...r, file: filePath, fileSha256 })),
    };
    writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    // Read-back verification: every declared file sha256 matches what is on disk now.
    let ok = 0;
    for (const r of runs) {
      const now = sha256(readFileSync(r.filePath, "utf8"));
      if (now !== r.fileSha256) throw new Error(`read-back sha mismatch: ${r.filePath}`);
      ok++;
    }
    console.log(`DONE: ${modelCalls} model calls, ${runs.length} plans, ${ok} files verified on disk, chain verified per course.`);
    console.log(`Outputs: ${OUT_DIR}`);
    return 0;
  } finally {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
    await new Promise((r) => { child.once("exit", () => r()); setTimeout(r, 2000).unref(); });
    logStream.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(`baseline run failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
