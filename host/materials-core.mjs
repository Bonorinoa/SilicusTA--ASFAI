/**
 * materials-core.mjs — the part of material intake that is the same on every host: the rules for
 * turning what a teacher hands over into named, bounded plain text, and what may be recorded about it.
 *
 *   - Material is untrusted INPUT. It informs proposals; it is never a teacher statement.
 *   - Material TEXT is never persisted. This module returns text to its caller and keeps nothing.
 *     What may be recorded about a material is its name, a sha256 digest and a character count.
 *
 * Pure (no network, no disk). HOW a link becomes text is the host's business and is injected as
 * `resolveUrl`: the Node host fetches it itself behind an SSRF guard (materials.mjs); the browser
 * host asks the site's guarded /api/fetch function. Every other rule (names, limits, clipping,
 * digests, skip-and-report) runs here, once, for both.
 */
import { createHash } from "node:crypto";

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

/* ------------------------------------ HTML ----------------------------------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };

export function decodeEntities(s) {
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
  // Prefer the page's own main content over navigation chrome, when it declares one.
  const main = src.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? src.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? src;
  const body = main
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

/** One-line, control-char-free, trimmed, bounded. `max` defaults to the display-name limit; callers that
 *  mirror another surface (the shipped UI's 200-char create names) pass their own bound. */
export const cleanName = (n, max = LIMITS.maxName) => String(n ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * A bounded, deterministic unique display name for a course's material list.
 *
 * The suffix is appended to a base TRUNCATED to leave room for it, so a name already at the length limit
 * still advances: recomputing `` `${name} (${n})`.slice(0, LIMITS.maxName) `` never changes a name that is
 * already at the limit, so the loop used to spin forever (U-5). The candidate count is bounded by the
 * number of names already taken, so this always terminates.
 *
 * @param {unknown} name @param {Set<string>} used @returns {string}
 */
export function uniqueName(name, used) {
  const base = cleanName(name);
  if (!used.has(base)) return base;
  for (let n = 2; n <= used.size + 2; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, Math.max(0, LIMITS.maxName - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return base; // unreachable while items are bounded; returning keeps the caller honest rather than hanging
}

/* ------------------------------ what a record may keep ------------------------------ */

/** How many material names a course record keeps, and how long each may be (the shipped UI's own bounds). */
export const MAX_MATERIAL_NAMES = 24;
export const MAX_MATERIAL_NAME_CHARS = 200;

/**
 * What a course record may keep about its materials AT CREATION: source NAMES only, exactly the shape the
 * shipped UI sends (`{ name: string }`), bounded the way the UI bounds them. Material TEXT is never a name,
 * so every other field (`text`, `extra`, a smuggled nested value) is dropped here instead of persisted
 * (lock: material transient; U-2). A non-object, or an object with no string name, contributes nothing.
 *
 * @param {unknown} materials @returns {{name: string}[]}
 */
export function materialNames(materials) {
  if (!Array.isArray(materials)) return [];
  const out = [];
  for (const m of materials) {
    if (!m || typeof m !== "object" || typeof m.name !== "string") continue;
    const name = cleanName(m.name, MAX_MATERIAL_NAME_CHARS);
    if (!name) continue;
    out.push({ name });
    if (out.length >= MAX_MATERIAL_NAMES) break;
  }
  return out;
}

/* ------------------------------- preparing a request ------------------------------- */

/**
 * Resolve the teacher's items into named plain texts. An item is `{name, text}` (they gave us the
 * words) or `{url, name?}` (`resolveUrl(url)` turns the link into `{text, title, kind}`). One bad item is
 * skipped and reported; it does not sink the request. Nothing is kept: the caller gets text back.
 *
 * @returns {Promise<{materials: {name: string, text: string, chars: number, digest: string, kind: string, truncated: boolean}[],
 *                    skipped: {name: string, code: string, reason: string}[]}>}
 */
export async function prepareMaterialsWith(items, resolveUrl) {
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
        const got = await resolveUrl(url);
        text = got.text; name = given || got.title || url; kind = got.kind;
      } else if (typeof item?.text === "string") {
        if (!given) throw new MaterialError("NAME_REQUIRED", "give this material a name");
        text = normalizeText(item.text, Infinity); kind = "text";
      } else {
        throw new MaterialError("BAD_MATERIAL", "a material needs text or a link");
      }
      name = cleanName(name) || "material";
      if (!text) throw new MaterialError("EMPTY", "there was no readable text");
      const unique = uniqueName(name, used);
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
