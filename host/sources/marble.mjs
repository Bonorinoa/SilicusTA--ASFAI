/**
 * marble.mjs — Marble's open skill taxonomy as a knowledge source (the LOCAL one).
 *
 * Marble (withmarbleapp/os-taxonomy, ODbL-1.0) is a children's graph, ages 3 to 15. This
 * source reads a PINNED, TRIMMED snapshot that ships with the app — no network, no OAuth,
 * no ASFAI — so both hosts can draw on it, and the online app finally has a knowledge
 * source (asfai-education CORS issue #16 forced the browser host to serve none).
 *
 * The grain guard is the point. Marble is a children's map: a university topic returns
 * nothing (normal) or a plausible-looking children's node ("maximum likelihood" →
 * "Likelihood Language", ages 9-10, is the documented live behaviour of the same data).
 * So when the teacher's own course answer puts the audience entirely outside 3 to 15, this
 * source returns nothing at all; and when only a band of the graph overlaps the audience,
 * only that band is searched. The label carries the node's age range either way, so neither
 * the worker nor the teacher mistakes it for course content. It is only ever CONTEXT.
 *
 * Egress: null. The teacher's words go nowhere; the snapshot is already on this device.
 */
import { KnowledgeSource, makeCitation } from "../knowledge.mjs";
import { audienceAges, overlaps, MARBLE_MIN_AGE, MARBLE_MAX_AGE } from "../marble/marble-graph.mjs";

/** One citation's context text: the description, plus the evidence lines it implies. */
function citeText(topic) {
  const parts = [];
  if (typeof topic.description === "string" && topic.description) parts.push(topic.description);
  for (const e of Array.isArray(topic.evidence) ? topic.evidence : []) {
    if (typeof e === "string" && e) parts.push(`Evidence: ${e}`);
  }
  return parts.join(" ");
}

export class MarbleSource extends KnowledgeSource {
  #marble;

  /** @param {{marble?: {search: Function, get: Function} | null}} [opts] */
  constructor({ marble = null } = {}) {
    super();
    this.#marble = marble;
  }

  get id() { return "marble"; }
  get label() { return "Marble skill taxonomy"; }
  get namespace() { return "marble"; }
  get enabled() { return Boolean(this.#marble); }
  get canVerify() { return true; }       // membership in the snapshot
  get egress() { return null; }          // nothing leaves the device

  async retrieve({ topic = "", objectives = [], limit = 8, course = "" } = {}) {
    if (!this.enabled) return [];
    const query = [topic, ...(objectives ?? []).map((o) => o?.statement)]
      .map((q) => String(q ?? "").trim().slice(0, 300))
      .filter(Boolean)
      .join(" ");
    if (!query) return [];

    // Grain guard: the audience comes from the teacher's OWN course answer ("AI literacy,
    // ages 8-10"). Wholly outside Marble's band -> nothing, even when the words match.
    const band = audienceAges(course);
    if (band && !overlaps(band, { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE })) return [];
    const { min, max } = band ?? { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE };
    const take = Math.max(1, Math.min(50, Number(limit) || 10));

    let hits;
    try {
      ({ hits } = await this.#marble.search(query, { ageMin: min, ageMax: max, limit: take }));
    } catch {
      return []; // an unreadable snapshot is a state (no context), never a course failure
    }
    if (!Array.isArray(hits)) return [];

    const out = [];
    for (const h of hits) {
      if (!h || typeof h.id !== "string" || typeof h.name !== "string") continue;
      // The graph's own name sometimes already ends in an age phrase; never print a second one.
      const ages = Number.isFinite(h.ageRangeStart) && Number.isFinite(h.ageRangeEnd) && !/\(ages? [^)]*\)\s*$/i.test(h.name)
        ? ` (ages ${h.ageRangeStart}–${h.ageRangeEnd})` : "";
      let full = null;
      try { full = await this.#marble.get(h.id); } catch { /* degrade below */ }
      out.push(makeCitation({
        ref: `marble:${h.id}`,
        label: `${h.name}${ages}`,
        text: full ? citeText(full) : "",
        source: this.id,
      }));
      if (out.length >= take) break;
    }
    return out;
  }

  /**
   * Is each cited topic real in the snapshot? Membership. If the snapshot cannot be read we
   * did NOT check, and say so: unreachable is never silently "ok".
   */
  async verify({ citations = [] } = {}) {
    if (!this.enabled) return { ok: true, unknown: [], checked: false };
    try {
      const unknown = [];
      for (const c of citations) {
        const ref = String(c?.ref ?? "");
        if (!ref.startsWith("marble:")) continue;
        const t = await this.#marble.get(ref.slice("marble:".length));
        if (!t) unknown.push(ref);
      }
      return { ok: unknown.length === 0, unknown, checked: true };
    } catch {
      return { ok: true, unknown: [], checked: false }; // could not check; never claim it did
    }
  }
}
