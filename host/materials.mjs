/**
 * materials.mjs — turning what a teacher hands over into plain text for the worker.
 *
 * The rules, whole:
 *   - Material is untrusted INPUT. It informs proposals; it is never a teacher statement,
 *     provenance or a confirmation, and nothing here can confirm anything.
 *   - Material TEXT is never persisted. This module returns text to its caller and keeps nothing.
 *     What may be recorded about a material is its name, a sha256 digest and a character count.
 *   - A public URL is fetched by the host, so the fetch is guarded: https only, no credentials, no
 *     private / loopback / link-local address (re-checked on EVERY redirect hop), size and time
 *     capped. The host is loopback-only and the teacher supplies the URL, which keeps the risk low;
 *     the check is still done, because "the teacher typed it" is not a security property. A DNS
 *     rebind between the address check and the connect is a documented residual.
 *   - YouTube captions are best-effort. YouTube now often serves empty caption files to a plain fetch, so
 *     the host first tries the page's own caption track, then (if the teacher's machine has yt-dlp and
 *     SILICUS_YTDLP names it) an OSS acquisition worker behind this seam. The product never depends on it.
 *     NO_TRANSCRIPT is a normal state; pasting a transcript always works.
 */
import { execFile } from "node:child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MaterialError, LIMITS, digestText, normalizeText, htmlToText, decodeEntities, youtubeVideoId, cleanName, prepareMaterialsWith,
} from "./materials-core.mjs";

export { MaterialError, LIMITS, digestText, normalizeText, htmlToText, youtubeVideoId, cleanName, prepareMaterialsWith };

/* ------------------------------ address policy ------------------------------ */

function v4Private(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0)
  );
}

/** The eight 16-bit groups of an IPv6 address, or null if it does not parse. Handles :: and a dotted tail. */
function parseV6(ip) {
  let s = String(ip).toLowerCase().split("%")[0];
  const tail = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const p = tail.slice(2).map(Number);
    if (p.some((n) => n > 255)) return null;
    s = `${tail[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const g = [...head, ...Array(fill).fill("0"), ...rest].map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return g.length === 8 && g.every(Number.isInteger) ? g : null;
}

/**
 * True for any address a public fetch must never reach. IPv6 is an ALLOW-list: only global unicast
 * (2000::/3) outside the transition and documentation ranges counts as public. That one rule refuses
 * every spelling of loopback, link-local, unique-local, site-local, IPv4-mapped (::ffff:a.b.c.d, which
 * the URL parser rewrites to hex), IPv4-compatible and NAT64, none of which a public page needs.
 * An unparseable address is refused.
 */
export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) return v4Private(ip);
  if (v === 6) {
    const g = parseV6(ip);
    if (!g) return true;
    const inGlobal = g[0] >= 0x2000 && g[0] <= 0x3fff;
    const transition = g[0] === 0x2002 || (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8));
    return !inGlobal || transition;
  }
  return true;
}

/** Parse and vet a URL for a public fetch. Returns the URL; throws URL_REFUSED. */
export async function assertPublicUrl(raw, { lookupImpl = dnsLookup } = {}) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new MaterialError("URL_REFUSED", "that is not a valid URL");
  }
  if (u.protocol !== "https:") throw new MaterialError("URL_REFUSED", "only https links can be read");
  if (u.username || u.password) throw new MaterialError("URL_REFUSED", "a link with a login in it cannot be read");
  if (u.port && u.port !== "443") throw new MaterialError("URL_REFUSED", "only the standard https port can be read");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new MaterialError("URL_REFUSED", "that address is not a public one");
    return u;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new MaterialError("URL_REFUSED", "that address is not a public one");
  }
  let addrs;
  try {
    addrs = await lookupImpl(host, { all: true });
  } catch {
    throw new MaterialError("URL_UNREACHABLE", "that address could not be found");
  }
  const list = Array.isArray(addrs) ? addrs : [addrs];
  if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
    throw new MaterialError("URL_REFUSED", "that address is not a public one");
  }
  return u;
}

/* ---------------------------------- fetching --------------------------------- */

const TEXTLIKE = /^(text\/|application\/(json|xml|xhtml\+xml)|application\/x-subrip)/i;

async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const t = await res.text();
    if (Buffer.byteLength(t) > maxBytes) throw new MaterialError("TOO_LARGE", "that page is too large to read");
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try { await reader.cancel(); } catch { /* already closing */ }
      throw new MaterialError("TOO_LARGE", "that page is too large to read");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * GET a public URL as text. Redirects are followed by hand so every hop is vetted.
 * @returns {Promise<{url: string, contentType: string, body: string}>}
 */
export async function fetchPublic(raw, { fetchImpl = fetch, lookupImpl = dnsLookup, limits = LIMITS, headers = {} } = {}) {
  let url = await assertPublicUrl(raw, { lookupImpl });
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    let res;
    try {
      res = await fetchImpl(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(limits.timeoutMs),
        headers: { accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1", "user-agent": "SilicusTA/0.1 (+teacher-initiated fetch)", ...headers },
      });
    } catch {
      throw new MaterialError("URL_UNREACHABLE", "that link could not be reached");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location"), url).href, { lookupImpl });
      continue;
    }
    if (!res.ok) throw new MaterialError("URL_UNREACHABLE", `that link answered ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!TEXTLIKE.test(contentType)) throw new MaterialError("UNSUPPORTED_TYPE", "that link is not text or a web page");
    return { url: url.href, contentType, body: await readCapped(res, limits.maxBytes) };
  }
  throw new MaterialError("URL_UNREACHABLE", "that link redirected too many times");
}

/* ----------------------------------- YouTube --------------------------------- */

/** Take the JSON array that follows `"captionTracks":` out of a watch page, by bracket matching. */
function captionTracksOf(html) {
  const at = html.indexOf('"captionTracks":');
  if (at < 0) return [];
  const start = html.indexOf("[", at);
  if (start < 0) return [];
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length && i < start + 200_000; i += 1) {
    const c = html[i];
    if (inStr) { if (c === "\\") i += 1; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "[") depth += 1;
    else if (c === "]" && --depth === 0) {
      try { const v = JSON.parse(html.slice(start, i + 1)); return Array.isArray(v) ? v : []; } catch { return []; }
    }
  }
  return [];
}

function transcriptText(body, contentType) {
  if (/json/i.test(contentType) || /^\s*\{/.test(body)) {
    try {
      const events = JSON.parse(body).events ?? [];
      return normalizeText(events.map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join("")).filter((l) => l.trim()).join(" "), Infinity);
    } catch { return ""; }
  }
  return normalizeText(decodeEntities([...body.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]).join(" ")), Infinity);
}

/** @returns {Promise<{title: string, text: string}>} */
export async function fetchYoutubeTranscript(id, deps = {}) {
  const page = await fetchPublic(`https://www.youtube.com/watch?v=${id}`, { ...deps, headers: { "accept-language": "en", cookie: "CONSENT=YES+1" } });
  const tracks = captionTracksOf(page.body).filter((t) => typeof t?.baseUrl === "string");
  if (tracks.length === 0) throw new MaterialError("NO_TRANSCRIPT", "that video has no captions Silicus can read. Paste a transcript instead.");
  const pick = tracks.find((t) => String(t.languageCode ?? "").startsWith("en") && t.kind !== "asr") ?? tracks.find((t) => String(t.languageCode ?? "").startsWith("en")) ?? tracks[0];
  const base = new URL(pick.baseUrl);
  if (base.protocol !== "https:" || !/(^|\.)youtube\.com$/.test(base.hostname)) throw new MaterialError("NO_TRANSCRIPT", "that video's captions are not somewhere Silicus will fetch from");
  base.searchParams.set("fmt", "json3");
  const cap = await fetchPublic(base.href, deps);
  const text = transcriptText(cap.body, cap.contentType);
  if (!text) throw new MaterialError("NO_TRANSCRIPT", "that video's captions were empty. Paste a transcript instead.");
  const title = htmlToText(page.body).title.replace(/\s*-\s*YouTube$/i, "");
  return { title, text };
}

/** Run an executable with an argument ARRAY (never a shell). Output is returned even when the exit code is not 0. */
function defaultRun(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 90_000, maxBuffer: 1_000_000 }, (_err, stdout) => resolve(String(stdout ?? "")));
  });
}

/**
 * Captions through yt-dlp, an OSS tool that keeps up with YouTube's changes so this product does not
 * have to. The video id is a validated 11-character token, the command is server config, and the
 * files go to a private temp directory that is removed afterwards. A non-zero exit is tolerated:
 * yt-dlp fails the auto-caption track with 429 even when the human captions downloaded fine.
 */
export async function ytdlpTranscript(id, { cmd, runImpl = defaultRun, tmpRoot = tmpdir() } = {}) {
  if (!cmd || !/^[\w-]{11}$/.test(id)) throw new MaterialError("NO_TRANSCRIPT", "that video's captions could not be read");
  const dir = await mkdtemp(join(tmpRoot, "silicus-yt-"));
  try {
    const stdout = await runImpl(cmd, [
      "--ignore-config", "--skip-download", "--no-playlist", "--no-warnings", "--no-simulate", "--write-subs", "--write-auto-subs",
      "--sub-langs", "en.*,en", "--sub-format", "json3", "--print", "title",
      "-o", join(dir, "%(id)s.%(ext)s"), `https://www.youtube.com/watch?v=${id}`,
    ]);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json3")).sort((a, b) => Number(/-ar|-orig/.test(a)) - Number(/-ar|-orig/.test(b)));
    if (files.length === 0) throw new MaterialError("NO_TRANSCRIPT", "that video has no captions Silicus can read. Paste a transcript instead.");
    const text = transcriptText(await readFile(join(dir, files[0]), "utf8"), "application/json");
    if (!text) throw new MaterialError("NO_TRANSCRIPT", "that video's captions were empty. Paste a transcript instead.");
    return { title: cleanName(String(stdout).split("\n")[0]), text };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ------------------------------- preparing a request ------------------------------- */

/* ------------------------------- preparing a request ------------------------------- */

/** How the Node host turns a link into text: it fetches it itself, behind the guard above. */
async function resolveUrlOnNode(url, deps) {
  const vid = youtubeVideoId(url);
  if (vid) {
    let t;
    try {
      t = await fetchYoutubeTranscript(vid, deps);
    } catch (e) {
      if (!(e instanceof MaterialError) || e.code !== "NO_TRANSCRIPT" || !deps.ytdlp) throw e;
      t = await ytdlpTranscript(vid, { cmd: deps.ytdlp, ...(deps.runImpl ? { runImpl: deps.runImpl } : {}) });
    }
    return { text: t.text, title: t.title, kind: "youtube" };
  }
  const page = await fetchPublic(url, deps);
  const isHtml = /html/i.test(page.contentType);
  const parsed = isHtml ? htmlToText(page.body) : { title: "", text: normalizeText(page.body, Infinity) };
  return { text: parsed.text, title: parsed.title, kind: "url" };
}

/**
 * Resolve the teacher's items into named plain texts. An item is `{name, text}` (they gave us the
 * words) or `{url, name?}` (we fetch a public page or a YouTube video's captions). One bad item is
 * skipped and reported; it does not sink the request. Nothing is kept: the caller gets text back.
 *
 * @returns {Promise<{materials: {name: string, text: string, chars: number, digest: string, kind: string, truncated: boolean}[],
 *                    skipped: {name: string, code: string, reason: string}[]}>}
 */
export async function prepareMaterials(items, deps = {}) {
  return prepareMaterialsWith(items, (url) => resolveUrlOnNode(url, deps));
}
