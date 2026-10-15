/**
 * worker-env.mjs — the drafting-worker environment, read from ONE named file and reduced to
 * exactly the variables the worker uses.
 *
 * Why this exists: the Node host reads `process.env` only (there is no dotenv anywhere in host/),
 * so a plain `npm start` leaves the worker unconfigured and every AI step fails. The obvious fix —
 * `node --env-file` — would load EVERY name in the file, and the file a teacher actually has
 * (`~/.hermes/.env`) also holds Telegram, GitHub, Hugging Face and other tokens. The host does not
 * need those, so it must not receive them.
 *
 * This module is pure: parse a file's text, keep only the worker's own variables, and say which
 * name carries the credential. `with-worker-env.mjs` does the spawning. Nothing here logs a value.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** host/, resolved from this file, so the default path never depends on the caller's cwd. */
export const HOST_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** Default env file: host/.env.worker (covered by .gitignore's `.env.*`). */
export const WORKER_ENV_FILE_DEFAULT = join(HOST_DIR, ".env.worker");

/**
 * The ONLY names forwarded from the env file:
 *   - every `SILICUS_WORKER_*` (provider, url, model, api key, zdr, reasoning);
 *   - the two key aliases the presets read (OPENROUTER_API_KEY, ANTHROPIC_API_KEY).
 * Anything else in the file — HF_TOKEN, GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, ... — is ignored on purpose.
 */
export function isWorkerVar(name) {
  return /^SILICUS_WORKER_/.test(name) || name === "OPENROUTER_API_KEY" || name === "ANTHROPIC_API_KEY";
}

/**
 * Parse dotenv-ish text. One `KEY=VALUE` per line; `#` comments and blank lines are skipped; a
 * leading `export ` is tolerated; a value's surrounding matching quotes are removed; a value may
 * contain `=`. Values are taken verbatim (no inline-comment stripping), so a URL or a base64 key
 * survives intact. Later keys win.
 */
export function parseEnvText(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const q = value[0];
      if ((q === '"' || q === "'") && value[value.length - 1] === q) value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Keep only the drafting-worker variables. */
export function selectWorkerEnv(parsed) {
  const out = {};
  for (const [k, v] of Object.entries(parsed)) if (isWorkerVar(k)) out[k] = v;
  return out;
}

/**
 * Which name carries the credential, if any — mirroring server.mjs `workerFromEnv` exactly, so the
 * launcher never green-lights a config the host would still run with the worker OFF. Notably,
 * `OPENROUTER_API_KEY` is read only under the `openrouter` preset; on its own it configures nothing.
 * The value is never returned.
 */
export function resolveCredential(env) {
  const preset = env.SILICUS_WORKER_PROVIDER ?? null;
  const names = preset === "anthropic" ? ["SILICUS_WORKER_API_KEY", "ANTHROPIC_API_KEY"]
    : preset === "openrouter" ? ["SILICUS_WORKER_API_KEY", "OPENROUTER_API_KEY"]
    : ["SILICUS_WORKER_API_KEY"];
  for (const name of names) {
    if (typeof env[name] === "string" && env[name].length > 0) return { present: true, via: name, preset };
  }
  return { present: false, via: null, preset };
}

/** The one-line, actionable refusal. Never contains a value. */
export function missingCredentialMessage({ file, preset = null }) {
  const setup = preset === "anthropic" ? "SILICUS_WORKER_PROVIDER=anthropic and an ANTHROPIC_API_KEY"
    : preset === "openrouter" ? "SILICUS_WORKER_PROVIDER=openrouter and an OPENROUTER_API_KEY"
    : "SILICUS_WORKER_PROVIDER=openrouter and an OPENROUTER_API_KEY (or a SILICUS_WORKER_API_KEY for your own endpoint)";
  return `No drafting-worker credential found: set ${setup} in ${file}, then run \`npm run start:worker\`.`;
}
