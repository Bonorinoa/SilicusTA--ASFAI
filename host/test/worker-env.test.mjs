/**
 * worker-env.test.mjs — the local app must start with the drafting worker configured, from a
 * NAMED env file, WITHOUT loading every unrelated secret that lives in it.
 *
 * The failure this pins: the local host reads process.env only, so started with plain `npm start`
 * every AI step is "worker not configured". The fix is host/scripts/with-worker-env.mjs: it reads
 * one named env file, forwards ONLY the drafting-worker variables (SILICUS_WORKER_* and the key
 * names the presets read), and refuses to start with a clear one-line message when no credential
 * is found. A credential is never printed, logged or echoed.
 *
 * Two layers:
 *   1. the pure selection rules (no process, no I/O) — what gets forwarded and what does not;
 *   2. the real path at the PROCESS boundary — the CLI starts the real server.mjs, and a real
 *      GET /api/worker/status answers "configured":true while a decoy secret in the same file
 *      never reaches the child's environment, its stdout/stderr, or any HTTP response.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { parseEnvText, selectWorkerEnv, resolveCredential, missingCredentialMessage, WORKER_ENV_FILE_DEFAULT } from "../scripts/worker-env.mjs";

const HOST = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = resolve(HOST, "scripts", "with-worker-env.mjs");

const TMP = [];
after(() => TMP.forEach((d) => rmSync(d, { recursive: true, force: true })));

const tmpDir = () => { const d = mkdtempSync(join(tmpdir(), "silicus-env-")); TMP.push(d); return d; };

const FAKE_KEY = "sk-or-v1-TESTONLYSECRET-0123456789abcdef";
const DECOY = "DECOYHFSECRET-do-not-forward";

/** A free loopback port (open then close; the child binds it a tick later). */
function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

/** Spawn the launcher with a clean worker environment, so ambient shell vars cannot mask the file. */
function spawnLauncher(envFile, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const k of Object.keys(env)) if (/^SILICUS_WORKER_/.test(k) || k === "OPENROUTER_API_KEY" || k === "ANTHROPIC_API_KEY") delete env[k];
  return spawn(process.execPath, [LAUNCHER, envFile], { cwd: HOST, env, stdio: ["ignore", "pipe", "pipe"] });
}

function collect(child) {
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (c) => { out.stdout += c; });
  child.stderr.on("data", (c) => { out.stderr += c; });
  return out;
}

const waitExit = (child) => new Promise((res) => child.on("exit", (code) => res(code)));

async function waitFor(fn, { timeoutMs = 8000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw last ?? new Error("timed out");
}

// ---------------------------------------------------------------------------
// 1. The pure selection rules.
// ---------------------------------------------------------------------------

test("parseEnvText reads KEY=VALUE lines, ignoring comments and blank lines, stripping quotes", () => {
  const parsed = parseEnvText([
    "# a comment",
    "",
    "export OPENROUTER_API_KEY=\"quoted-value\"",
    "HF_TOKEN='single-quoted'",
    "SILICUS_WORKER_MODEL=deepseek/deepseek-v4-flash-0731",
    "SILICUS_WORKER_URL=https://example.test/v1/chat/completions?a=b",
    "not a pair",
    "  SILICUS_WORKER_ZDR = 0  ",
  ].join("\n"));
  assert.equal(parsed.OPENROUTER_API_KEY, "quoted-value");
  assert.equal(parsed.HF_TOKEN, "single-quoted");
  assert.equal(parsed.SILICUS_WORKER_MODEL, "deepseek/deepseek-v4-flash-0731");
  assert.equal(parsed.SILICUS_WORKER_URL, "https://example.test/v1/chat/completions?a=b", "a value may contain =");
  assert.equal(parsed.SILICUS_WORKER_ZDR, "0");
  assert.equal(parsed["not a pair"], undefined);
});

test("selectWorkerEnv forwards only the drafting-worker variables, dropping every unrelated secret", () => {
  const parsed = {
    OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "a",
    SILICUS_WORKER_PROVIDER: "openrouter", SILICUS_WORKER_MODEL: "m", SILICUS_WORKER_ZDR: "1",
    SILICUS_YTDLP: "/usr/local/bin/yt-dlp",
    HF_TOKEN: DECOY, XAI_API_KEY: DECOY, TYPESAFE_API_KEY: DECOY, TELEGRAM_BOT_TOKEN: DECOY, GITHUB_TOKEN: DECOY,
  };
  assert.deepEqual(Object.keys(selectWorkerEnv(parsed)).sort(), [
    "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SILICUS_WORKER_MODEL", "SILICUS_WORKER_PROVIDER", "SILICUS_WORKER_ZDR",
  ]);
  assert.ok(!("HF_TOKEN" in selectWorkerEnv(parsed)), "an unrelated token is never forwarded");
});

test("resolveCredential mirrors workerFromEnv: the preset decides which key name is read", () => {
  assert.deepEqual(resolveCredential({ SILICUS_WORKER_PROVIDER: "openrouter", OPENROUTER_API_KEY: "x" }), { present: true, via: "OPENROUTER_API_KEY", preset: "openrouter" });
  assert.deepEqual(resolveCredential({ SILICUS_WORKER_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" }), { present: true, via: "ANTHROPIC_API_KEY", preset: "anthropic" });
  assert.deepEqual(resolveCredential({ SILICUS_WORKER_API_KEY: "x" }), { present: true, via: "SILICUS_WORKER_API_KEY", preset: null });
  assert.deepEqual(resolveCredential({ SILICUS_WORKER_MODEL: "m" }), { present: false, via: null, preset: null });
  // The honesty case the old "any key name" check got wrong: a bare OPENROUTER_API_KEY without the
  // openrouter preset configures NOTHING (workerFromEnv reads it only when preset === "openrouter").
  assert.equal(resolveCredential({ OPENROUTER_API_KEY: "x" }).present, false, "the key alone is not enough");
});

test("the missing-credential message is one line, names the file and the exact fix, and carries no value", () => {
  const msg = missingCredentialMessage({ file: "/home/teacher/.silicus/worker.env" });
  assert.ok(!msg.includes("\n"), "one line");
  assert.match(msg, /SILICUS_WORKER_PROVIDER=openrouter/);
  assert.match(msg, /OPENROUTER_API_KEY/);
  assert.match(msg, /\/home\/teacher\/\.silicus\/worker\.env/, "names the exact file");
  assert.match(msg, /npm run start:worker/, "names the exact command");
  const ani = missingCredentialMessage({ file: "/f", preset: "anthropic" });
  assert.match(ani, /SILICUS_WORKER_PROVIDER=anthropic/);
  assert.match(ani, /ANTHROPIC_API_KEY/);
});

// ---------------------------------------------------------------------------
// 2. The real path at the process boundary.
// ---------------------------------------------------------------------------

test("no credential in the named file: the launcher refuses to start, exit 1, with a clear one-line message", async () => {
  const dir = tmpDir();
  const file = join(dir, "worker.env");
  writeFileSync(file, "# only unrelated secrets here\nHF_TOKEN=" + DECOY + "\nTYPESAFE_API_KEY=" + DECOY + "\n");

  const child = spawnLauncher(file);
  const out = collect(child);
  const code = await waitExit(child);

  assert.equal(code, 1, "a missing key is a hard, visible failure");
  const said = out.stderr + out.stdout;
  assert.match(said, /OPENROUTER_API_KEY/, "names the variable to set");
  assert.match(said, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "names the file it read");
  assert.ok(!said.includes(DECOY), "no unrelated secret is echoed back");
});

test("a key without its preset is refused: the launcher names the missing provider, not a false success", async () => {
  const dir = tmpDir();
  const file = join(dir, "worker.env");
  writeFileSync(file, "OPENROUTER_API_KEY=" + FAKE_KEY + "\n"); // no SILICUS_WORKER_PROVIDER

  const child = spawnLauncher(file);
  const out = collect(child);
  const code = await waitExit(child);

  assert.equal(code, 1, "a config the host would run with the worker OFF is refused up front");
  const said = out.stderr + out.stdout;
  assert.match(said, /SILICUS_WORKER_PROVIDER=openrouter/, "names the exact fix (the preset, not just the key)");
  assert.ok(!said.includes(FAKE_KEY), "the key value is never echoed");
});

test("a credential in the named file: the launcher starts the real server, configured true, and leaks nothing", async () => {
  const dir = tmpDir();
  const file = join(dir, "worker.env");
  writeFileSync(file, [
    "# the drafting worker, plus unrelated secrets that must NOT be forwarded",
    "SILICUS_WORKER_PROVIDER=openrouter",
    "OPENROUTER_API_KEY=" + FAKE_KEY,
    "HF_TOKEN=" + DECOY,
    "XAI_API_KEY=" + DECOY,
    "TYPESAFE_API_KEY=" + DECOY,
    "",
  ].join("\n"));

  const port = await freePort();
  const dataDir = join(dir, "data");
  const child = spawnLauncher(file, { SILICUS_HOST_PORT: String(port), SILICUS_HOST_DATA: dataDir });
  const out = collect(child);

  try {
    const status = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/worker/status`, { signal: AbortSignal.timeout(1000) });
      const j = await r.json();
      return j.configured === true ? j : null;
    });
    assert.equal(status.configured, true, "the worker is configured through the new path");
    assert.equal(status.zdr, true, "the openrouter preset keeps zero-data-retention on");
    assert.equal(status.provider, "openai", "the preset speaks the openai (chat-completions) wire");

    // The status body is a real HTTP response: it must not carry the key.
    const body = JSON.stringify(status);
    assert.ok(!body.includes(FAKE_KEY), "no credential in the HTTP response");

    // ...and nothing reached the child's own output.
    assert.ok(!out.stdout.includes(FAKE_KEY), "no credential on stdout");
    assert.ok(!out.stderr.includes(FAKE_KEY), "no credential on stderr");
    assert.ok(!out.stdout.includes(DECOY), "no unrelated secret on stdout");
    assert.ok(!out.stderr.includes(DECOY), "no unrelated secret on stderr");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([waitExit(child), new Promise((r) => setTimeout(r, 2000))]);
    child.kill("SIGKILL");
  }
});
