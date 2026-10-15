/**
 * site.ts — the browser host's only two network neighbours: the site's model proxy (/api/worker) and its
 * guarded link reader (/api/fetch). Both are stateless functions that hold what a browser must not (the
 * model key, a server-side fetch behind an SSRF guard); neither keeps a course.
 *
 * Every refusal is turned into words a teacher can act on, carried as the SAME error types the shared
 * course code already understands (WorkerError, MaterialError), so the handler maps them exactly as it maps
 * a refusal on the Node host.
 */
import { WorkerError } from "../../../host/worker.mjs";
import { MaterialError, normalizeText, youtubeVideoId } from "../../../host/materials-core.mjs";
import type { PasscodeKeeper } from "./passcode";
import type { TypicalSeconds } from "../gate/types";

// The JS default (LIMITS.maxChars) makes TypeScript infer a literal type for `max`; it takes any number.
const normalize = normalizeText as (raw: unknown, max?: number) => string;

export interface SiteStatus {
  configured: boolean;
  /** Zero-data-retention routing, as the SITE reports it. The UI may claim zero-retention only when true. */
  zdr: boolean;
  provider: string;
  passcodeRequired: boolean;
  model?: string;
  typicalSeconds?: TypicalSeconds;
}

const NOT_SET_UP: SiteStatus = { configured: false, zdr: false, provider: "openrouter", passcodeRequired: false };

export const MESSAGES = {
  noCredits: "The model account has no credits, so the AI cannot draft right now. Everything you have recorded still works.",
  notSetUp: "AI drafting is not set up on this site.",
  rejected: "The demo passcode was not accepted, so nothing was sent to the model.",
  cancelled: "AI drafting needs the demo passcode. Nothing was sent.",
  timeout: "The model did not answer in time. Try again.",
  tooLarge: "That is too much to send to the model at once. Use less material.",
  youtube: "YouTube captions can only be read by the local Silicus app. Paste the transcript as text instead.",
  wait: (seconds: number | null) => `Too many AI requests just now. Wait ${seconds ? `${seconds} seconds` : "a minute"} and try again.`,
} as const;

/** The site's own deadline for one network attempt (the model proxy gives up upstream at 115 s). */
export const REQUEST_TIMEOUT_MS = 120_000;
/** The status check is tiny; if it does not answer quickly the site is treated as not set up (and asked again next time). */
export const STATUS_TIMEOUT_MS = 10_000;

/** The request left the page and did not come back in time. */
class SiteTimeout extends Error {}

class PasscodeUnavailable extends Error {
  constructor(readonly rejected: boolean) { super(rejected ? "rejected" : "cancelled"); }
}

const retryAfter = (res: Response) => {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
};

async function errorBody(res: Response): Promise<{ code?: string; status?: number; message?: string }> {
  try {
    const j = (await res.clone().json()) as { error?: { code?: string; status?: number; message?: string } };
    return j?.error ?? {};
  } catch {
    return {};
  }
}

export interface Site {
  status(): Promise<SiteStatus>;
  /** A fetch for PlanWorker: adds the passcode, and turns the function's refusals into WorkerErrors. */
  workerFetch(url: string, init: RequestInit): Promise<Response>;
  /** How the browser host turns a teacher's link into text: the site reads it behind its guard. */
  resolveUrl(url: string): Promise<{ text: string; title: string; kind: string }>;
}

export function createSite({ origin, fetchImpl, passcode, requestTimeoutMs = REQUEST_TIMEOUT_MS, statusTimeoutMs = STATUS_TIMEOUT_MS }: { origin: string; fetchImpl: typeof fetch; passcode: PasscodeKeeper; requestTimeoutMs?: number; statusTimeoutMs?: number }): Site {
  let known: SiteStatus | null = null;

  async function status(): Promise<SiteStatus> {
    if (known) return known;
    try {
      // Bounded like every other request (verifier finding): a hung status check must not hang the AI step behind it.
      // The signal also covers reading the body below.
      const res = await fetchImpl(`${origin}/api/worker/status`, { method: "GET", signal: AbortSignal.timeout(statusTimeoutMs) });
      if (!res.ok) return { ...NOT_SET_UP };
      const j = (await res.json()) as Partial<SiteStatus>;
      known = {
        configured: j.configured === true, zdr: j.zdr === true, provider: String(j.provider ?? "openrouter"),
        passcodeRequired: j.passcodeRequired !== false, ...(typeof j.model === "string" ? { model: j.model } : {}),
        ...(j.typicalSeconds !== undefined ? { typicalSeconds: j.typicalSeconds } : {}),
      };
      return known;
    } catch {
      return { ...NOT_SET_UP }; // not cached: the site may come back
    }
  }

  /** Call a site function with the passcode; a 401 forgets it and asks again (twice at most). */
  async function withPasscode(url: string, init: RequestInit): Promise<Response> {
    const st = await status();
    let required = st.passcodeRequired;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let code: string | null = null;
      if (required) {
        code = passcode.get() ?? (await passcode.ask(attempt === 0 ? "needed" : "rejected"));
        if (!code) throw new PasscodeUnavailable(attempt > 0);
      }
      const headers = new Headers(init.headers);
      if (code) headers.set("x-silicus-passcode", code);
      // The deadline covers the NETWORK, never the teacher: start it now, after the passcode is in hand. The caller's
      // signal (PlanWorker's AbortSignal.timeout) started before the dialog opened, so a teacher who took a minute to
      // type the passcode used to find it already expired and nothing was sent ("signal timed out"; found live).
      const signal = AbortSignal.timeout(requestTimeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(url, { ...init, headers, signal });
      } catch (e) {
        if (signal.aborted) throw new SiteTimeout();
        throw e;
      }
      if (res.status !== 401) return res;
      passcode.clear();
      required = true;
      if (known) known = { ...known, passcodeRequired: true };
    }
    throw new PasscodeUnavailable(true);
  }

  async function workerFetch(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await withPasscode(url, init);
    } catch (e) {
      if (e instanceof PasscodeUnavailable) throw new WorkerError("PASSCODE_REQUIRED", e.rejected ? MESSAGES.rejected : MESSAGES.cancelled);
      if (e instanceof SiteTimeout) throw new WorkerError("WORKER_UNREACHABLE", MESSAGES.timeout);
      throw new WorkerError("WORKER_UNREACHABLE", "The site could not be reached. Check the connection and try again.");
    }
    if (res.ok) return res;
    const err = await errorBody(res);
    if (res.status === 503) throw new WorkerError("WORKER_NOT_CONFIGURED", MESSAGES.notSetUp);
    if (res.status === 429) throw new WorkerError("RATE_LIMITED", MESSAGES.wait(retryAfter(res)));
    if (res.status === 413) throw new WorkerError("TOO_LARGE", MESSAGES.tooLarge);
    if (res.status === 504) throw new WorkerError("WORKER_UNREACHABLE", MESSAGES.timeout);
    if (res.status === 502 && err.status === 402) throw new WorkerError("MODEL_NO_CREDITS", MESSAGES.noCredits);
    if (res.status === 502) throw new WorkerError("WORKER_UNREACHABLE", `The model service answered with an error${err.status ? ` (${err.status})` : ""}. Try again later.`);
    return res; // PlanWorker reports any other status honestly
  }

  async function resolveUrl(url: string): Promise<{ text: string; title: string; kind: string }> {
    if (youtubeVideoId(url)) throw new MaterialError("YOUTUBE_LOCAL_ONLY", MESSAGES.youtube);
    let res: Response;
    try {
      res = await withPasscode(`${origin}/api/fetch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    } catch (e) {
      if (e instanceof PasscodeUnavailable) throw new MaterialError("PASSCODE_REQUIRED", e.rejected ? "The demo passcode was not accepted, so the link was not read." : "Reading a link needs the demo passcode. Paste the text instead.");
      if (e instanceof SiteTimeout) throw new MaterialError("URL_UNREACHABLE", "reading that link took too long");
      throw new MaterialError("URL_UNREACHABLE", "that link could not be reached");
    }
    if (res.ok) {
      let j: { name?: unknown; text?: unknown };
      try { j = (await res.json()) as { name?: unknown; text?: unknown }; } catch { throw new MaterialError("URL_UNREACHABLE", "that link could not be read"); }
      return { text: normalize(typeof j.text === "string" ? j.text : "", Infinity), title: typeof j.name === "string" ? j.name : "", kind: "url" };
    }
    const err = await errorBody(res);
    if (res.status === 422) {
      if (err.code === "YOUTUBE_LOCAL_ONLY") throw new MaterialError("YOUTUBE_LOCAL_ONLY", MESSAGES.youtube);
      throw new MaterialError(err.code || "URL_REFUSED", err.message || "that link cannot be read here: only public web pages can be");
    }
    if (res.status === 503) throw new MaterialError("FETCH_NOT_CONFIGURED", "Reading links is not set up on this site. Paste the text instead.");
    if (res.status === 429) throw new MaterialError("RATE_LIMITED", "Too many links read just now. Wait a minute and try again.");
    if (res.status === 413) throw new MaterialError("TOO_LARGE", "that page is too large to read");
    throw new MaterialError("URL_UNREACHABLE", `that link could not be read (${res.status})`);
  }

  return { status, workerFetch, resolveUrl };
}
