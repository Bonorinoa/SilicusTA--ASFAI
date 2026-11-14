/**
 * marble.mjs — Marble's open skill taxonomy as a knowledge source (the LOCAL one).
 *
 * Marble (withmarbleapp/os-taxonomy; database ODbL 1.0, Marble-authored text CC BY-SA 4.0) is a
 * children's graph, ages 3 to 15. This
 * source reads a PINNED, TRIMMED snapshot that ships with the app — no network, no OAuth,
 * no ASFAI — so both hosts can draw on it, and the online app finally has a knowledge
 * source (asfai-education CORS issue #16 forced the browser host to serve none).
 *
 * The grain guard is the point. Marble is a children's map: a university topic returns
 * nothing (normal) or a plausible-looking children's node ("maximum likelihood" →
 * "Likelihood Language", ages 9-10, is the documented live behaviour of the same data).
 * So when the teacher's own course answer puts the audience entirely outside 3 to 15, this
 * source returns nothing at all; when only a band of the graph overlaps the audience,
 * only that band is searched; and (G1b, owner 14 Nov) when the audience cannot be read at
 * all, this source FAILS CLOSED — no citations, never a search of the whole band. The label
 * carries the node's age range either way, so neither the worker nor the teacher mistakes it
 * for course content. It is only ever CONTEXT.
 *
 * Egress: null. The teacher's words go nowhere; the snapshot is already on this device.
 */
import { KnowledgeSource, makeCitation } from "../knowledge.mjs";
import { audienceAges, overlaps, MARBLE_MIN_AGE, MARBLE_MAX_AGE } from "../marble/marble-graph.mjs";

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
    // G1b (C1): unreadable -> nothing. The parser is widened for the phrasings teachers type,
    // but an audience the parser cannot place in an age band is never searched whole-band.
    const band = audienceAges(course);
    if (!band) return [];
    if (!overlaps(band, { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE })) return [];
    const { min, max } = band;
    const take = Math.max(1, Math.min(50, Number(limit) || 10));

    let hits;
    try {
      ({ hits } = await this.#marble.search(query, { ageMin: min, ageMax: max, limit: take }));
    } catch {
      return []; // an unreadable snapshot is a state (no context), never a course failure
    }
    if (!Array.isArray(hits)) return [];

    const scope = { min, max };
    const inBand = (t) => {
      const lo = Number(t?.ageRangeStart); const hi = Number(t?.ageRangeEnd);
      return Number.isFinite(lo) && Number.isFinite(hi) && lo <= scope.max && hi >= scope.min;
    };
    const labelFor = (name, lo, hi) => Number.isFinite(lo) && Number.isFinite(hi)
      && !/\(ages? [^)]*\)\s*$/i.test(name) ? `${name} (ages ${lo}–${hi})` : name;
    const out = [];
    const seen = new Set();
    const pushTopic = async (id) => {
      if (seen.has(id)) return;
      let full = null;
      try { full = await this.#marble.get(id); } catch { return; } // a broken read is skipped, not fatal
      if (!full || !inBand(full)) return;
      seen.add(id);
      out.push(makeCitation({
        ref: `marble:${id}`,
        label: labelFor(String(full.name ?? ""), Number(full.ageRangeStart), Number(full.ageRangeEnd)),
        text: typeof full.description === "string" ? full.description : "",
        source: this.id,
      }));
    };
    // Scored hits keep their places; around each hit the graph's OWN edges set the order
    // (committee walk 2026-11-12): hard prerequisites, soft unlocks, then the topics that
    // build on it — the same age band, never the words. A neighbour who cannot be mentioned
    // by any keyword ("AI in Daily Life" has none of "smart device") still belongs in the
    // context, which is the entire point of reading a GRAPH and not a bag of words.
    for (const h of hits) {
      if (!h || typeof h.id !== "string" || typeof h.name !== "string") continue;
      await pushTopic(h.id);
      if (out.length >= take) break;
      let n = null;
      try { n = await this.#marble.topic(h.id); } catch { n = null; }
      const rows = [...(n?.prerequisites?.hard ?? []), ...(n?.prerequisites?.soft ?? []), ...(n?.dependents ?? [])];
      for (const row of rows) {
        if (out.length >= take) break;
        if (typeof row?.topicId === "string") await pushTopic(row.topicId);
      }
    }
    return out.slice(0, take);
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
