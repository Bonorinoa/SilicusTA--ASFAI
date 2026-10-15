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
 *   - YouTube captions are best-effort over the same guarded fetcher. NO_TRANSCRIPT is a normal state;
 *     pasting a transcript always works.
 */
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class MaterialError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "MaterialError";
    this.code = code;
  }
}

export const LIMITS = Object.freeze({
  maxMaterials: 8,
  maxChars: 60_000,        // per material
  maxTotalChars: 120_000,  // across the request
  maxBytes: 2_000_000,     // a fetched body
  timeoutMs: 8_000,
  maxRedirects: 3,
  maxName: 160,
});

export function digestText(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** Plain text: control characters out, runs of blank lines collapsed, bounded. */
export function normalizeText(raw, max = LIMITS.maxChars) {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

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

/** True for any address a public fetch must never reach. Unknown shapes are refused. */
export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) return v4Private(ip);
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return v4Private(mapped[1]);
    return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || /^fe[89ab]/.test(x) || x.startsWith("ff");
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
  const host = u.hostname.replace(/^\[|\]$/g, "");
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

/* ------------------------------------ HTML ----------------------------------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
function safeChar(cp) {
  try { return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : " "; } catch { return " "; }
}

/** Readable text and a title from an HTML page. Not a browser: it only needs to be honest and bounded. */
export function htmlToText(html) {
  const src = String(html ?? "");
  const title = decodeEntities((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, LIMITS.maxName);
  const body = src
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|ul|ol|table)>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return { title, text: normalizeText(decodeEntities(body), Infinity) };
}

/* ----------------------------------- YouTube --------------------------------- */

/** The 11-character video id from a YouTube link, or null. */
export function youtubeVideoId(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else { const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/); if (m) id = m[2]; }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

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

/* ------------------------------- preparing a request ------------------------------- */

const cleanName = (n) => String(n ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.maxName);

/**
 * Resolve the teacher's items into named plain texts. An item is `{name, text}` (they gave us the
 * words) or `{url, name?}` (we fetch a public page or a YouTube video's captions). One bad item is
 * skipped and reported; it does not sink the request. Nothing is kept: the caller gets text back.
 *
 * @returns {Promise<{materials: {name: string, text: string, chars: number, digest: string, kind: string, truncated: boolean}[],
 *                    skipped: {name: string, code: string, reason: string}[]}>}
 */
export async function prepareMaterials(items, deps = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new MaterialError("NO_MATERIALS", "no material was given");
  if (items.length > LIMITS.maxMaterials) throw new MaterialError("TOO_MANY", `at most ${LIMITS.maxMaterials} materials at a time`);
  const materials = [];
  const skipped = [];
  const used = new Set();
  let total = 0;
  for (const item of items) {
    const given = cleanName(item?.name);
    try {
      let name = given;
      let text;
      let kind;
      if (typeof item?.url === "string" && item.url.trim()) {
        const url = item.url.trim();
        const vid = youtubeVideoId(url);
        if (vid) { const t = await fetchYoutubeTranscript(vid, deps); text = t.text; name = given || t.title || url; kind = "youtube"; }
        else {
          const page = await fetchPublic(url, deps);
          const isHtml = /html/i.test(page.contentType);
          const parsed = isHtml ? htmlToText(page.body) : { title: "", text: normalizeText(page.body, Infinity) };
          text = parsed.text; name = given || parsed.title || url; kind = "url";
        }
      } else if (typeof item?.text === "string") {
        if (!given) throw new MaterialError("NAME_REQUIRED", "give this material a name");
        text = normalizeText(item.text, Infinity); kind = "text";
      } else {
        throw new MaterialError("BAD_MATERIAL", "a material needs text or a link");
      }
      name = cleanName(name) || "material";
      if (!text) throw new MaterialError("EMPTY", "there was no readable text");
      let unique = name;
      for (let n = 2; used.has(unique); n += 1) unique = `${name} (${n})`.slice(0, LIMITS.maxName);
      const room = LIMITS.maxTotalChars - total;
      if (room <= 0) throw new MaterialError("TOO_LARGE", "that is more material than can be read at once");
      const clipped = text.slice(0, Math.min(room, LIMITS.maxChars));
      used.add(unique);
      total += clipped.length;
      materials.push({ name: unique, text: clipped, chars: clipped.length, digest: digestText(clipped), kind, truncated: clipped.length < text.length });
    } catch (e) {
      if (!(e instanceof MaterialError)) throw e;
      skipped.push({ name: given || String(item?.url ?? "").slice(0, 120) || "(unnamed)", code: e.code, reason: e.message });
    }
  }
  if (materials.length === 0) {
    const first = skipped[0];
    throw new MaterialError(first?.code ?? "NO_MATERIALS", first?.reason ?? "no readable material");
  }
  return { materials, skipped };
}
