/**
 * ratelimit.mjs — a best-effort, in-memory, PER-INSTANCE rate limiter.
 *
 * Honest limits: state lives in one function instance's memory. Vercel may run several instances at
 * once and recycles them at will, so the real ceiling is (limit x live instances) and it resets on a
 * cold start. It slows a casual abuser and caps spend per instance; it is not a quota system. No
 * external store is used on purpose (no new service, nothing about visitors kept anywhere).
 *
 *   hit(ip)       per-IP sliding window (default 20 per 10 minutes). Count EVERY attempt, including a
 *                 wrong passcode, so guessing the passcode is rate limited too.
 *   spend(cap)    per-instance daily ceiling (UTC day). Count only requests that will go upstream, so
 *                 failed attempts cannot burn the day's budget for real users.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function createRateLimiter({ perIp = 20, windowMs = 10 * 60 * 1000, maxKeys = 10_000, now = Date.now } = {}) {
  /** ip -> ascending timestamps inside the window. Map order doubles as least-recently-used order. */
  const hits = new Map();
  let day = -1;
  let spent = 0;

  function hit(ip) {
    const t = now();
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < windowMs);
    hits.delete(ip);
    if (recent.length >= perIp) {
      hits.set(ip, recent);
      return { ok: false, retryAfter: (recent[0] + windowMs - t) / 1000 };
    }
    recent.push(t);
    hits.set(ip, recent);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return { ok: true };
  }

  function spend(cap) {
    const t = now();
    const today = Math.floor(t / DAY_MS);
    if (today !== day) { day = today; spent = 0; }
    if (spent >= cap) return { ok: false, retryAfter: ((today + 1) * DAY_MS - t) / 1000 };
    spent += 1;
    return { ok: true };
  }

  return { hit, spend, size: () => hits.size };
}

/** SILICUS_DAILY_CAP as a positive integer, else 300. */
export function dailyCap(env) {
  const n = Number(env?.SILICUS_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : 300;
}
