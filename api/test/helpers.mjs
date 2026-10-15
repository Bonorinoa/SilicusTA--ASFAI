/**
 * Shared test helpers for the Vercel functions. Not a test file itself.
 *
 * Every response a test looks at goes through `read()`, which asserts the API key string appears
 * in neither the body nor any header value. So "the key never leaks" is checked on EVERY case,
 * not in one dedicated test.
 */
import assert from "node:assert/strict";

// Obviously fake, but distinctive enough that a leak cannot match by accident.
export const KEY = "test-only-not-a-real-key-7f3c9a1e5b";
export const PASS = "correct horse battery";
export const MODEL = "vendor/env-chosen-model";

export const baseEnv = (over = {}) => ({
  OPENROUTER_API_KEY: KEY,
  SILICUS_WORKER_MODEL: MODEL,
  SILICUS_DEMO_PASSCODE: PASS,
  ...over,
});

/** Read a Response, asserting the key leaks nowhere. Returns {status, headers, text, json}. */
export async function read(res) {
  assert.ok(res instanceof Response, "handlers must return a Web Response");
  const text = await res.text();
  assert.ok(!text.includes(KEY), "the API key appeared in a response body");
  for (const [name, value] of res.headers) {
    assert.ok(!value.includes(KEY) && !name.includes(KEY), `the API key appeared in response header ${name}`);
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

/** A POST Request with a JSON body. */
export function post(url, body, { passcode = PASS, headers = {} } = {}) {
  const h = { "content-type": "application/json", ...headers };
  if (passcode !== null) h["x-silicus-passcode"] = passcode;
  return new Request(url, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) });
}

/** A stub upstream: records calls, answers with `respond(url, init, call)` (default: a chat-completions reply). */
export function upstream(respond) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (respond) return respond(url, init, call);
    return Response.json({ id: "gen-1", choices: [{ index: 0, message: { role: "assistant", content: "{\"ok\":true}" } }] });
  };
  return { fetchImpl, calls };
}

/** A manual clock. */
export function clock(start = Date.UTC(2026, 9, 14, 12, 0, 0)) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

export const WORKER_URL = "https://silicus.test/api/worker";
export const FETCH_URL = "https://silicus.test/api/fetch";
export const STATUS_URL = "https://silicus.test/api/worker/status";
