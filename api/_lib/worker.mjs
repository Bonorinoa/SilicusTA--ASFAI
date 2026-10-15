/**
 * worker.mjs — POST /api/worker (an OpenAI-compatible chat-completions proxy to OpenRouter) and
 * GET /api/worker/status.
 *
 * The browser hosts the course; this function exists only to hold the model key. It decides, the
 * client does not:
 *   - the model is SILICUS_WORKER_MODEL; a client `model` is discarded;
 *   - only messages / response_format / temperature / max_tokens are read from the body (every other
 *     key, including `reasoning`, `provider`, `tools`, `stream`, `n`, is dropped), messages are rebuilt as
 *     {role, content} strings;
 *   - max_tokens = min(client, SILICUS_WORKER_MAX_TOKENS, 4000 by default);
 *   - reasoning is SILICUS_WORKER_REASONING, low by default; the client cannot set it;
 *   - zero-data-retention routing `provider: {zdr: true, data_collection: "deny"}` is sent unless
 *     SILICUS_WORKER_ZDR === "0", and it fails CLOSED: one upstream attempt, never a retry elsewhere;
 *   - OPENROUTER_API_KEY goes only upstream as a Bearer token, never into a response or a log.
 * Stateless: nothing about a request is kept or logged.
 */
import { PASSCODE_HEADER, fail, json, rateLimited, readJson, clientIp, isPlainObject, raceAbort } from "./http.mjs";
import { passcodeConfigured, passcodeMatches } from "./passcode.mjs";
import { createRateLimiter, dailyCap } from "./ratelimit.mjs";
import { normalizeReasoning, reasoningBody, typicalSecondsFromJson } from "../../host/worker-config.mjs";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const MAX_BODY_BYTES = 512 * 1024;
export const UPSTREAM_TIMEOUT_MS = 115_000;
export const DEFAULT_MAX_TOKENS = 4000;
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
const ROLES = new Set(["system", "user", "assistant"]);
const MAX_MESSAGES = 200;
const ZDR_PROVIDER = Object.freeze({ zdr: true, data_collection: "deny" });

const nonEmpty = (v) => typeof v === "string" && v.length > 0;

/** The worker's settings from env. Config only; the key never leaves this module except upstream. */
export function workerSettings(env = {}) {
  const cap = Number(env.SILICUS_WORKER_MAX_TOKENS);
  return {
    key: nonEmpty(env.OPENROUTER_API_KEY) ? env.OPENROUTER_API_KEY : null,
    model: nonEmpty(env.SILICUS_WORKER_MODEL) ? env.SILICUS_WORKER_MODEL : null,
    passcode: passcodeConfigured(env) ? env.SILICUS_DEMO_PASSCODE : null,
    // Fail closed: anything but the exact string "0" keeps zero-data-retention routing on.
    zdr: env.SILICUS_WORKER_ZDR !== "0",
    reasoning: normalizeReasoning(env.SILICUS_WORKER_REASONING, "low"),
    maxTokensCap: Number.isInteger(cap) && cap > 0 ? Math.min(cap, DEFAULT_MAX_TOKENS) : DEFAULT_MAX_TOKENS,
    dailyCap: dailyCap(env),
  };
}

const isConfigured = (s) => Boolean(s.key && s.model && s.passcode);

/**
 * The upstream body, built from an allow-list. Returns `{body}` or `{error}` (a 400 code).
 * Exported for the tests' benefit only through the handler; kept pure.
 */
export function buildUpstreamBody(input, settings) {
  if (!isPlainObject(input)) return { error: "BAD_REQUEST" };
  const { messages } = input;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return { error: "BAD_MESSAGES" };
  const clean = [];
  for (const m of messages) {
    if (!isPlainObject(m) || !ROLES.has(m.role) || typeof m.content !== "string") return { error: "BAD_MESSAGES" };
    clean.push({ role: m.role, content: m.content });
  }
  const body = { model: settings.model, messages: clean };
  if (isPlainObject(input.response_format) && typeof input.response_format.type === "string") {
    body.response_format = JSON.parse(JSON.stringify(input.response_format));
  }
  if (typeof input.temperature === "number" && Number.isFinite(input.temperature) && input.temperature >= 0 && input.temperature <= 2) {
    body.temperature = input.temperature;
  }
  const asked = input.max_tokens;
  body.max_tokens = Number.isInteger(asked) && asked > 0 ? Math.min(asked, settings.maxTokensCap) : settings.maxTokensCap;
  if (settings.zdr) body.provider = { ...ZDR_PROVIDER };
  const reasoning = reasoningBody(settings.reasoning);
  if (reasoning) body.reasoning = reasoning;
  return { body };
}

async function readUpstream(res, maxBytes) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try { await reader.cancel(); } catch { /* closing */ }
      throw new Error("upstream body too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>, now?: () => number,
 *          limiter?: ReturnType<typeof createRateLimiter>, timeoutMs?: number}} [deps]
 */
export function createWorkerHandler({ fetchImpl = (...a) => fetch(...a), env = process.env, now = Date.now, limiter = null, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  const rl = limiter ?? createRateLimiter({ now });

  async function POST(request) {
    const s = workerSettings(env);
    if (!isConfigured(s)) return fail(503, "NOT_CONFIGURED");

    const perIp = rl.hit(clientIp(request));
    if (!perIp.ok) return rateLimited(perIp.retryAfter);

    if (!passcodeMatches(request.headers.get(PASSCODE_HEADER), s.passcode)) return fail(401, "BAD_PASSCODE");

    const parsed = await readJson(request, MAX_BODY_BYTES);
    if (parsed.response) return parsed.response;
    const built = buildUpstreamBody(parsed.value, s);
    if (built.error) return fail(400, built.error);

    const daily = rl.spend(s.dailyCap);
    if (!daily.ok) return rateLimited(daily.retryAfter);

    // One attempt, one deadline covering the response AND its body. No retry: with ZDR on, a retry
    // could only ever be a different route, and fail-closed means the answer is a refusal instead.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await raceAbort(Promise.resolve().then(() => fetchImpl(OPENROUTER_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(built.body),
          signal: ac.signal,
        })), ac.signal);
      } catch {
        return ac.signal.aborted ? fail(504, "UPSTREAM_TIMEOUT") : fail(502, "UPSTREAM_ERROR");
      }
      if (!res.ok) {
        // The status only. An upstream error body can echo request details, so it is never relayed.
        try { await res.body?.cancel(); } catch { /* closing */ }
        return fail(502, "UPSTREAM_ERROR", { status: res.status });
      }
      let text;
      try {
        text = await raceAbort(readUpstream(res, MAX_UPSTREAM_BYTES), ac.signal);
      } catch {
        return ac.signal.aborted ? fail(504, "UPSTREAM_TIMEOUT") : fail(502, "UPSTREAM_ERROR", { status: res.status });
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return fail(502, "UPSTREAM_ERROR", { status: res.status });
      }
      const out = JSON.stringify(data);
      // Belt and braces: whatever happened upstream, the key never goes back to a browser.
      if (out.includes(s.key)) return fail(502, "UPSTREAM_ERROR", { status: res.status });
      return new Response(out, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    } finally {
      clearTimeout(timer);
    }
  }

  return { POST };
}

/**
 * GET /api/worker/status. The Node host's shape ({configured, zdr, provider}) plus passcodeRequired
 * and the model slug (not a secret). zdr is reported exactly as configured, never as a guarantee
 * the function cannot make. No passcode needed.
 */
export function createStatusHandler({ env = process.env } = {}) {
  async function GET() {
    const s = workerSettings(env);
    return json(200, { configured: isConfigured(s), zdr: s.zdr, provider: "openrouter", passcodeRequired: true, model: s.model,
      typicalSeconds: typicalSecondsFromJson(env.SILICUS_TYPICAL_SECONDS) });
  }
  return { GET };
}
