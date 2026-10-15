/**
 * with-worker-env.mjs — start the local host with the drafting worker configured, from a NAMED
 * env file, forwarding ONLY the worker's own variables.
 *
 *   npm run start:worker                          # reads host/.env.worker
 *   node scripts/with-worker-env.mjs ~/.silicus/worker.env
 *   SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env npm run start:worker
 *
 * The file is named, not discovered: pointed at a file that also holds unrelated secrets
 * (`~/.hermes/.env`), only SILICUS_WORKER_* and the key names reach the host process — nothing else
 * does. A credential is never printed, logged or echoed. If no credential is found, the launcher
 * refuses to start with one actionable line instead of silently running with AI features off.
 *
 * Why not `node --env-file`: it loads every name in the file, and it is not on the host's Node
 * floor (--env-file needs Node >= 20.6, --env-file-if-exists Node >= 22.9; host/README documents
 * Node >= 18). This launcher is plain Node 18, zero dependencies.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import process from "node:process";
import {
  HOST_DIR, WORKER_ENV_FILE_DEFAULT, parseEnvText, selectWorkerEnv, resolveCredential, missingCredentialMessage,
} from "./worker-env.mjs";

const file = process.argv[2] || process.env.SILICUS_WORKER_ENV_FILE || WORKER_ENV_FILE_DEFAULT;

let parsed = {};
if (existsSync(file)) {
  parsed = parseEnvText(readFileSync(file, "utf8"));
} else {
  // No file is not fatal on its own — the shell may already export the credential. Say so quietly.
  console.error(`silicus-host: no env file at ${file}; using the process environment only.`);
}

const selected = selectWorkerEnv(parsed);
const dropped = Object.keys(parsed).filter((k) => !(k in selected)).length;

// Shell exports win for anything the file does not set; the file wins for the worker variables it does.
const childEnv = { ...process.env, ...selected };

const credential = resolveCredential(childEnv);
if (!credential.present) {
  console.error(missingCredentialMessage({ file, preset: credential.preset }));
  process.exit(1);
}

console.error(
  `silicus-host: drafting worker enabled via ${credential.via} from ${existsSync(file) ? file : "(process environment)"}` +
  (dropped > 0 ? `; ${dropped} unrelated name(s) in the file were not forwarded` : "") + ".",
);

const child = spawn(process.execPath, ["server.mjs"], { cwd: HOST_DIR, env: childEnv, stdio: "inherit" });

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { try { child.kill(sig); } catch { /* child already gone */ } });
}

child.on("error", (err) => { console.error(`silicus-host: could not start the server: ${err.message}`); process.exit(1); });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
