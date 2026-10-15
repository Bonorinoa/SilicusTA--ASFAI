/**
 * fetch.mjs — POST /api/fetch: read one public web page the teacher named, as plain text.
 *
 * The SSRF guard is the host's own code path, imported unchanged from host/materials.mjs:
 * `fetchPublic` vets the URL with `assertPublicUrl` (https only, no credentials, standard port, no
 * private / loopback / link-local / metadata address, IPv6 as an allow-list) and re-vets EVERY
 * redirect hop before following it. A DNS rebind between the check and the connect is the same
 * documented residual the host has.
 *
 * Stateless: the page text goes back to the browser in the response and nowhere else. It is never
 * stored or logged. YouTube is refused up front: yt-dlp does not run here, and YouTube blocks cloud IPs.
 */
import { fetchPublic, htmlToText, normalizeText, youtubeVideoId, digestText, cleanName, MaterialError, LIMITS } from "../../host/materials.mjs";
import { PASSCODE_HEADER, fail, json, rateLimited, readJson, clientIp, isPlainObject, raceAbort } from "./http.mjs";
import { passcodeConfigured, passcodeMatches } from "./passcode.mjs";
import { createRateLimiter, dailyCap } from "./ratelimit.mjs";

export const MAX_BODY_BYTES = 4 * 1024;
export const FETCH_DEADLINE_MS = 20_000;
const MAX_URL = 2048;
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const YOUTUBE_MESSAGE = "YouTube captions need the local app. Paste the transcript instead.";

function isYoutube(raw) {
  if (youtubeVideoId(raw)) return true;
  try {
    return YOUTUBE_HOST.test(new URL(raw).hostname.replace(/\.$/, ""));
  } catch {
    return false;
  }
}

/**
 * @param {{fetchImpl?: typeof fetch, lookupImpl?: Function, env?: Record<string, string|undefined>,
 *          now?: () => number, limiter?: ReturnType<typeof createRateLimiter>, deadlineMs?: number}} [deps]
 */
export function createFetchHandler({ fetchImpl = (...a) => fetch(...a), lookupImpl = undefined, env = process.env, now = Date.now, limiter = null, deadlineMs = FETCH_DEADLINE_MS } = {}) {
  const rl = limiter ?? createRateLimiter({ now });

  async function POST(request) {
    if (!passcodeConfigured(env)) return fail(503, "NOT_CONFIGURED");

    const perIp = rl.hit(clientIp(request));
    if (!perIp.ok) return rateLimited(perIp.retryAfter);

    if (!passcodeMatches(request.headers.get(PASSCODE_HEADER), env.SILICUS_DEMO_PASSCODE)) return fail(401, "BAD_PASSCODE");

    const parsed = await readJson(request, MAX_BODY_BYTES);
    if (parsed.response) return parsed.response;
    const url = isPlainObject(parsed.value) && typeof parsed.value.url === "string" ? parsed.value.url.trim() : "";
    if (!url || url.length > MAX_URL) return fail(400, "BAD_REQUEST");

    if (isYoutube(url)) return fail(422, "YOUTUBE_LOCAL_ONLY", { message: YOUTUBE_MESSAGE });

    const daily = rl.spend(dailyCap(env));
    if (!daily.ok) return rateLimited(daily.retryAfter);

    // One deadline for the whole fetch (every hop and the body), on top of the host's per-hop timeout.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deadlineMs);
    const bounded = (u, init = {}) => fetchImpl(u, { ...init, signal: init.signal ? AbortSignal.any([init.signal, ac.signal]) : ac.signal });
    try {
      const page = await raceAbort(fetchPublic(url, { fetchImpl: bounded, ...(lookupImpl ? { lookupImpl } : {}) }), ac.signal);
      const isHtml = /html/i.test(page.contentType);
      const read = isHtml ? htmlToText(page.body) : { title: "", text: normalizeText(page.body, Infinity) };
      const text = read.text.slice(0, LIMITS.maxChars);
      if (!text) return fail(422, "EMPTY", { message: "there was no readable text" });
      const name = cleanName(read.title) || cleanName(new URL(page.url).hostname) || "material";
      return json(200, { name, text, chars: text.length, digest: digestText(text) });
    } catch (e) {
      if (ac.signal.aborted) return fail(504, "UPSTREAM_TIMEOUT");
      if (e instanceof MaterialError) return fail(422, e.code, { message: e.message });
      return fail(500, "INTERNAL");
    } finally {
      clearTimeout(timer);
    }
  }

  return { POST };
}
