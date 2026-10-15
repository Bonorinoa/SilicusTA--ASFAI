/**
 * http.mjs — small Web-standard helpers shared by the functions.
 *
 * Every response is JSON with `cache-control: no-store`. Nothing here logs, and nothing here
 * ever puts a request body, an upstream body or an env value into a response.
 */

export const PASSCODE_HEADER = "x-silicus-passcode";

const BASE_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

/** A JSON response with the no-store headers. */
export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** An error response: `{error: {code, ...extra}}`. */
export function fail(status, code, extra = {}, headers = {}) {
  return json(status, { error: { code, ...extra } }, headers);
}

/** 429 with retry-after (whole seconds, at least 1). */
export function rateLimited(retryAfterSec) {
  return fail(429, "RATE_LIMITED", {}, { "retry-after": String(Math.max(1, Math.ceil(retryAfterSec))) });
}

/**
 * Read a request body as UTF-8 text, refusing past `maxBytes` WITHOUT buffering unbounded:
 * a declared content-length over the cap is refused before a byte is read, and the stream is
 * cancelled the moment the running total passes the cap (content-length can lie or be absent).
 *
 * @returns {Promise<{ok: true, text: string} | {ok: false, reason: "TOO_LARGE"|"BAD_BODY"}>}
 */
export async function readBodyCapped(request, maxBytes) {
  const declared = request.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) return { ok: false, reason: "BAD_BODY" };
    if (n > maxBytes) {
      try { await request.body?.cancel(); } catch { /* already closed */ }
      return { ok: false, reason: "TOO_LARGE" };
    }
  }
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    let step;
    try {
      step = await reader.read();
    } catch {
      return { ok: false, reason: "BAD_BODY" };
    }
    if (step.done) break;
    size += step.value.byteLength;
    if (size > maxBytes) {
      try { await reader.cancel(); } catch { /* already closing */ }
      return { ok: false, reason: "TOO_LARGE" };
    }
    chunks.push(step.value);
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) };
  } catch {
    return { ok: false, reason: "BAD_BODY" };
  }
}

/** Read and JSON-parse a capped body. Returns the value or an error Response. */
export async function readJson(request, maxBytes) {
  const body = await readBodyCapped(request, maxBytes);
  if (!body.ok) return { response: body.reason === "TOO_LARGE" ? fail(413, "TOO_LARGE") : fail(400, "BAD_REQUEST") };
  try {
    return { value: JSON.parse(body.text) };
  } catch {
    return { response: fail(400, "BAD_JSON") };
  }
}

/**
 * The client's IP for rate limiting: the first x-forwarded-for hop, then x-real-ip. On Vercel the
 * platform sets both (a client-sent x-forwarded-for is overwritten), so this is the real peer there;
 * anywhere else it is only a best-effort key.
 */
export function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  const first = xff ? xff.split(",")[0].trim() : "";
  const ip = first || (request.headers.get("x-real-ip") ?? "").trim();
  return ip ? ip.slice(0, 64) : "unknown";
}

export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Reject when `signal` aborts, whatever `promise` does (a stub or a stalled body read cannot outlive the deadline). */
export function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(new DOMException("deadline", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("deadline", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}
