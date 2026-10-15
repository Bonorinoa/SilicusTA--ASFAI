/**
 * knowledge.mjs — the knowledge-source seam.
 *
 * A source retrieves CONTEXT for the drafting worker. It never decides anything:
 * retrieved text is untrusted input, and a citation is a reference, not a claim.
 * The gate is not widened by any of this — a plan may cite, and the teacher still
 * confirms. Nothing here may become an objective or a teacher statement.
 *
 * Two capabilities, deliberately separate:
 *   retrieve({...})     → Citation[]                         candidates to put in the prompt
 *   verify({citations}) → { ok, unknown: string[], checked } is a citation real?
 * A source that can retrieve but not verify is usable; it just cannot back a VERIFIED
 * citation, and the UI must not claim otherwise. `checked: false` means the source could
 * not actually check (it cannot, or it was unreachable) — it is never a silent "ok".
 *
 * Two more rules live here so they live ONCE:
 *   - A source failure degrades, never breaks. `retrieveAll` catches every source,
 *     bounds it with a timeout, and returns whatever the healthy ones produced.
 *   - Refs are namespaced by source (`asfai:`, `local:`). A citation whose ref is not in
 *     its own source's namespace is dropped at the door, so two sources can never mint
 *     the same ref and a source cannot impersonate another.
 */

/** @typedef {{ref: string, label: string, text: string, source: string}} Citation */

const MAX_REF = 200;
const MAX_LABEL = 200;
const MAX_TEXT = 600;

const str = (v, max) => String(v ?? "").slice(0, max);

/**
 * A frozen, strings-only citation. The text is kept VERBATIM (bounded) as untrusted
 * context; it is never interpreted here.
 * @returns {Readonly<Citation>}
 */
export function makeCitation({ ref, label, text, source } = {}) {
  return Object.freeze({
    ref: str(ref, MAX_REF),
    label: str(label, MAX_LABEL),
    text: str(text, MAX_TEXT),
    source: str(source, 60),
  });
}

/**
 * Which of these refs did we NOT supply? The anti-invention check for citations.
 * Falsy entries are ignored (a model that emits `null` cited nothing).
 * @param {unknown[]} refs
 * @param {{ref: string}[]} supplied
 * @returns {string[]}
 */
export function unknownRefs(refs, supplied) {
  const known = new Set((supplied ?? []).map((c) => c?.ref));
  return (Array.isArray(refs) ? refs : []).filter((r) => r && !known.has(String(r))).map(String);
}

/** The shape every source implements. Everything defaults to "not available". */
export class KnowledgeSource {
  /** Stable machine id, e.g. "asfai-graph". Appears on every citation it makes. */
  get id() { throw new Error("not implemented"); }
  /** What a teacher sees, e.g. "ASFAI's skill map". */
  get label() { throw new Error("not implemented"); }
  /** The ref prefix this source owns, without the colon, e.g. "asfai". */
  get namespace() { throw new Error("not implemented"); }
  /** Is the source configured and (if remote) connected? Not-enabled is a state, not an error. */
  get enabled() { return false; }
  /** Can verify() actually check a citation? The UI reads this and must not over-claim. */
  get canVerify() { return false; }
  /**
   * Does retrieving send the teacher's words off this machine, and to whom?
   * null = nowhere. "asfai" = ASFAI. The course decides whether that is allowed.
   */
  get egress() { return null; }
  /** @returns {Promise<Citation[]>} */
  async retrieve(_query) { return []; }
  /** @returns {Promise<{ok: boolean, unknown: string[], checked: boolean}>} */
  async verify(_args) { return { ok: true, unknown: [], checked: false }; }
}

/** A promise that gives up. A hung knowledge base must not hang a course. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("source timed out")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Retrieve from every usable source, in parallel, ASFAI-first by caller order.
 * Never throws. A source that is disabled, not permitted to send the teacher's words
 * anywhere, failing, hung, or returning junk contributes nothing.
 *
 * @param {KnowledgeSource[]} sources
 * @param {{topic?: string, objectives?: {id: string, statement: string}[], limit?: number,
 *          allowEgress?: string[], timeoutMs?: number}} query
 * @returns {Promise<Readonly<Citation>[]>}
 */
export async function retrieveAll(sources, { topic = "", objectives = [], limit = 8, allowEgress = [], timeoutMs = 4000 } = {}) {
  const usable = (sources ?? []).filter((s) => {
    try {
      if (!s?.enabled) return false;
      return s.egress == null || allowEgress.includes(s.egress);
    } catch { return false; }
  });
  const settled = await Promise.all(
    usable.map(async (s) => {
      try {
        const hits = await withTimeout(Promise.resolve(s.retrieve({ topic, objectives, limit })), timeoutMs);
        return Array.isArray(hits) ? { s, hits } : { s, hits: [] };
      } catch {
        return { s, hits: [] };
      }
    }),
  );
  const seen = new Set();
  const out = [];
  for (const { s, hits } of settled) {
    for (const h of hits) {
      const c = makeCitation({ ...h, source: s.id });
      if (!c.ref || !c.label) continue;
      if (!c.ref.startsWith(`${s.namespace}:`)) continue; // a source may only mint refs in its own namespace
      if (seen.has(c.ref)) continue;
      seen.add(c.ref);
      out.push(c);
    }
  }
  return out;
}

/**
 * Ask each source to check the citations it owns. Returns, per ref, whether it was
 * CHECKED and found real. Unknown refs are reported so the caller can drop them; an
 * unchecked ref (source cannot verify, or was unreachable) is never reported as verified.
 *
 * @param {KnowledgeSource[]} sources
 * @param {{ref: string, source: string}[]} citations
 * @returns {Promise<{verified: Set<string>, unknown: Set<string>}>}
 */
export async function verifyCitations(sources, citations, { timeoutMs = 4000 } = {}) {
  const verified = new Set();
  const unknown = new Set();
  for (const s of sources ?? []) {
    const mine = (citations ?? []).filter((c) => c.source === s.id);
    if (mine.length === 0) continue;
    let r;
    try {
      if (!s.enabled || !s.canVerify) continue;
      r = await withTimeout(Promise.resolve(s.verify({ citations: mine })), timeoutMs);
    } catch {
      continue; // unreachable is not "unknown", and it is not "verified" either
    }
    if (!r || r.checked !== true) continue;
    const bad = new Set(Array.isArray(r.unknown) ? r.unknown.map(String) : []);
    for (const c of mine) (bad.has(c.ref) ? unknown : verified).add(c.ref);
  }
  return { verified, unknown };
}
