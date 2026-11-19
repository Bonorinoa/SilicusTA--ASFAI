/**
 * marble-graph.mjs — Marble (withmarbleapp/os-taxonomy) as a PURE local graph.
 *
 * No network, no fs, no model, no embeddings: whoever wants the graph gives us the snapshot
 * TEXT once (the Node host reads the committed file, the browser host fetches the built
 * asset), it is parsed here, and every lookup after that is in memory. The search is
 * deliberately dumb — fixed-weight term overlap over name (3), description (1) and
 * evidence (1) — the same philosophy as sources/local-ontology.mjs. If this ever needs a
 * vector store or an inference engine, that is the signal to stop and reconsider.
 *
 * The snapshot layout (written by scripts/marble-snapshot.mjs, pinned to one upstream
 * commit, hashes recorded inside):
 *   { format: "marble-snapshot",
 *     source: { repo, commit, licence },
 *     topicsSha256, dependenciesSha256,
 *     topics: [{id,type,subject,domain,name,description,evidence,ageRangeStart,ageRangeEnd}],
 *     dependencies: [{topicId, prerequisiteId, strength: "hard"|"soft", reason}] }
 *
 * Two units live here because BOTH hosts need them in the same byte-identical form:
 *   - audienceAges(text) — the grain guard's reading of the teacher's own answer
 *     ("AI literacy, ages 8-10"), used by sources/marble.mjs and by no other source.
 *   - createMarbleService(load) — the shared lazy facade the Node host, the browser host
 *     and the handler all call. `load` is the host's way to fetch the snapshot text.
 */

export const MARBLE_MIN_AGE = 3;
export const MARBLE_MAX_AGE = 15;

const STOP = new Set(["a", "an", "and", "are", "about", "can", "do", "for", "how", "in", "is", "lesson", "of", "on", "or", "the", "to", "what", "with", "students", "learners", "be", "able", "your", "have", "their", "from", "it", "as", "this", "that"]);

/** Lowercased word stems; a trailing plural s is dropped for matching strength. */
export function terms(text) {
  const raw = String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(raw.filter((t) => !STOP.has(t) && t.length > 1).map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t)))];
}

/** A course answer's age band, when the teacher names one: "ages 8-10", "aged 19", "19-year-old",
 * "19 and up", and since G1b the spaced phrasings teachers type ("19 year olds",
 * "16 to 18 year olds", "17 and 18 year olds", "16–18 year olds"). Anything else is null, and the
 * SOURCE then fails closed (a null band means "unreadable", never "the whole 3–15 band"). */
export function audienceAges(text) {
  const s = String(text ?? "");
  const toBand = (lo, hi) => ({ min: Math.min(lo, hi), max: Math.max(lo, hi) });
  let m;
  m = s.match(/(?:ages?|aged|years?\s*(?:old)?)\s*(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})/i);
  if (m) return toBand(Number(m[1]), Number(m[2]));
  m = s.match(/(\d{1,2})\s*(?:-|–|—)\s*(\d{1,2})\s*(?:-|\s)?year-?olds?/i);
  if (m) return toBand(Number(m[1]), Number(m[2]));
  // G1b C1: a space before "year olds" — "16 to 18 year olds", "16–18 year olds", "8-10 year olds".
  m = s.match(/(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s+year\s+olds?/i);
  if (m) return toBand(Number(m[1]), Number(m[2]));
  m = s.match(/(\d{1,2})\s+and\s+(\d{1,2})\s+year\s+olds?/i);
  if (m) return toBand(Number(m[1]), Number(m[2]));
  m = s.match(/(?:ages?|aged)\s*(\d{1,2})\s*(?:\+|and\s*up|or\s*older|plus)/i);
  if (m) return { min: Number(m[1]), max: Infinity };
  m = s.match(/(\d{1,2})\s*[- ]year-?old/i);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  m = s.match(/(\d{1,2})\s+year\s+olds?/i);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  m = s.match(/(?:aged|age(?:\s|$))\s*(\d{1,2})\b/i);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

/** Do two age bands overlap? (Infinity is a legal max.) */
export function overlaps(a, b) {
  return a.min <= b.max && a.max >= b.min;
}

/** Parse and validate the snapshot text. Throws; the callers degrade to "no graph". */
export function parseMarbleSnapshot(text) {
  let doc;
  try { doc = JSON.parse(String(text)); } catch { throw new Error("marble snapshot: not valid JSON"); }
  if (!doc || doc.format !== "marble-snapshot" || !Array.isArray(doc.topics) || !Array.isArray(doc.dependencies)) {
    throw new Error("marble snapshot: wrong shape");
  }
  if (doc.topics.length === 0) throw new Error("marble snapshot: no topics");
  for (const t of doc.topics) {
    if (!t || typeof t.id !== "string" || !t.id || typeof t.name !== "string" || !t.name) throw new Error("marble snapshot: a topic lacks id/name");
  }
  for (const e of doc.dependencies) {
    if (!e || typeof e.topicId !== "string" || typeof e.prerequisiteId !== "string" || (e.strength !== "hard" && e.strength !== "soft")) {
      throw new Error("marble snapshot: a dependency lacks topicId/prerequisiteId/strength");
    }
  }
  return doc;
}

/**
 * The in-memory graph. Immutable in practice: built once from the parsed snapshot.
 * `search` returns slim hits (the route shape); `prerequisites`/`dependents` return edge
 * rows enriched with the neighbour's name when it is in the snapshot, null when the id is
 * not, and empty arrays when a known topic simply has no edges.
 */
export class MarbleGraph {
  #byId = new Map();
  #prereqs = new Map();      // topicId -> edges where it is the topic
  #dependents = new Map();   // prerequisiteId -> edges where it is the prerequisite

  constructor(doc) {
    this.topics = (doc?.topics ?? []).filter((t) => t && typeof t.id === "string" && typeof t.name === "string");
    this.dependencies = (doc?.dependencies ?? []).filter((e) => e && typeof e.topicId === "string" && typeof e.prerequisiteId === "string" && (e.strength === "hard" || e.strength === "soft"));
    for (const t of this.topics) this.#byId.set(t.id, t);
    for (const e of this.dependencies) {
      const a = this.#prereqs.get(e.topicId) ?? []; a.push(e); this.#prereqs.set(e.topicId, a);
      const b = this.#dependents.get(e.prerequisiteId) ?? []; b.push(e); this.#dependents.set(e.prerequisiteId, b);
    }
  }

  get topicCount() { return this.topics.length; }
  get edgeCount() { return this.dependencies.length; }

  /** Full trimmed topic by id, or null. */
  get(id) { return this.#byId.get(id) ?? null; }

  /** Plain lexical scoring over name, description and evidence; age-overlap filtered; bounded.
   * `scope` (G2a) is the course's skill-map anchor: `{ subject, domain }`. When set, only topics
   * whose subject OR domain matches the anchor's are candidates at all — a Computing/AI anchor
   * makes "Daily Life in a Roman Town" (History) unreachable even when the words overlap, which
   * is the point of an anchored course. Without scope, the current whole-band behaviour stays. */
  search(query, { ageMin = MARBLE_MIN_AGE, ageMax = MARBLE_MAX_AGE, limit = 10, scope = null } = {}) {
    const q = terms(query);
    if (q.length === 0) return [];
    const take = Math.max(0, Math.min(50, Number(limit) || 10));
    const out = [];
    const scoped = Boolean(scope && typeof scope === "object");
    for (const t of this.topics) {
      if (scoped && String(t.subject ?? "") !== String(scope.subject ?? "") && String(t.domain ?? "") !== String(scope.domain ?? "")) continue;
      const lo = Number.isFinite(Number(t.ageRangeStart)) ? Number(t.ageRangeStart) : MARBLE_MIN_AGE;
      const hi = Number.isFinite(Number(t.ageRangeEnd)) ? Number(t.ageRangeEnd) : MARBLE_MAX_AGE;
      if (lo > ageMax || hi < ageMin) continue;
      const name = new Set(terms(t.name));
      const desc = new Set(terms(t.description));
      const evid = new Set(terms((t.evidence ?? []).join(" ")));
      let score = 0;
      for (const w of q) score += (name.has(w) ? 3 : 0) + (desc.has(w) ? 1 : 0) + (evid.has(w) ? 1 : 0);
      if (score === 0) continue;
      out.push({ id: t.id, name: t.name, subject: t.subject ?? "", domain: t.domain ?? "", ageRangeStart: lo, ageRangeEnd: hi, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, take);
  }

  /** @returns {{hard: object[], soft: object[]} | null} */
  prerequisites(id) {
    if (!this.#byId.has(id)) return null;
    const row = (e) => ({ topicId: e.prerequisiteId, name: this.#byId.get(e.prerequisiteId)?.name ?? null, strength: e.strength, reason: e.reason ?? "" });
    const edges = this.#prereqs.get(id) ?? [];
    return { hard: edges.filter((e) => e.strength === "hard").map(row), soft: edges.filter((e) => e.strength === "soft").map(row) };
  }

  /** @returns {object[] | null} */
  dependents(id) {
    if (!this.#byId.has(id)) return null;
    const row = (e) => ({ topicId: e.topicId, name: this.#byId.get(e.topicId)?.name ?? null, strength: e.strength, reason: e.reason ?? "" });
    return (this.#dependents.get(id) ?? []).map(row);
  }

  /**
   * The wizard's histogram strip (G2a). For a requested age range, how many topics overlap it,
   * and how many topics are live at each single age from 3 to 25. One pass over the topics.
   * @param {{min?: number, max?: number}} [range]
   * @returns {{overlapping: number, perAge: {age: number, count: number}[]}}
   */
  coverage({ min = MARBLE_MIN_AGE, max = MARBLE_MAX_AGE } = {}) {
    const lo = Number.isFinite(Number(min)) ? Number(min) : MARBLE_MIN_AGE;
    const hi = Number.isFinite(Number(max)) ? Number(max) : MARBLE_MAX_AGE;
    const perAge = [];
    let overlapping = 0;
    for (const t of this.topics) {
      const a = Number.isFinite(Number(t.ageRangeStart)) ? Number(t.ageRangeStart) : MARBLE_MIN_AGE;
      const b = Number.isFinite(Number(t.ageRangeEnd)) ? Number(t.ageRangeEnd) : MARBLE_MAX_AGE;
      if (a <= hi && b >= lo) overlapping += 1;
    }
    for (let age = 3; age <= 25; age += 1) {
      let count = 0;
      for (const t of this.topics) {
        const a = Number.isFinite(Number(t.ageRangeStart)) ? Number(t.ageRangeStart) : MARBLE_MIN_AGE;
        const b = Number.isFinite(Number(t.ageRangeEnd)) ? Number(t.ageRangeEnd) : MARBLE_MAX_AGE;
        if (a <= age && b >= age) count += 1;
      }
      perAge.push({ age, count });
    }
    return { overlapping, perAge };
  }

  /**
   * The anchor's neighbourhood (G2a): prerequisites TWO hops up and dependents ONE hop down,
   * deduplicated by topic id (first edge wins), each row carrying the full trimmed node (id,
   * name, subject, domain, ages, evidence) plus the edge's strength, reason and hop distance.
   * @returns {{anchor: object, prerequisites: object[], dependents: object[], edges: {from: string, to: string, strength: string}[]} | null}
   */
  neighbourhood(id) {
    const t = this.#byId.get(id);
    if (!t) return null;
    const rowOf = (topicId, strength, reason, hops) => {
      const n = this.#byId.get(topicId);
      if (!n) return null;
      return {
        id: n.id, name: n.name, subject: n.subject ?? "", domain: n.domain ?? "",
        ageRangeStart: Number.isFinite(Number(n.ageRangeStart)) ? Number(n.ageRangeStart) : MARBLE_MIN_AGE,
        ageRangeEnd: Number.isFinite(Number(n.ageRangeEnd)) ? Number(n.ageRangeEnd) : MARBLE_MAX_AGE,
        strength, reason: reason ?? "", hops,
        evidence: Array.isArray(n.evidence) ? [...n.evidence] : [],
      };
    };
    const prerequisites = [];
    const dependents = [];
    // Dedupe PER DIRECTION: a topic that is both a prerequisite and a dependent of the anchor
    // (a cycle in the map) must still appear once on each side, not vanish from one.
    // N2 (L1): a topic never lists itself. A cycle walked two hops (A needs B, B needs A) would bring the
    // anchor back as its own prerequisite, and a duplicate node under another id with the same name reads
    // the same to a teacher, so both are skipped.
    const seenPrereq = new Set([id]);
    const seenDependent = new Set([id]);
    const sameName = (n) => String(n ?? "").trim().toLowerCase() === String(t.name ?? "").trim().toLowerCase();
    const push = (list, seen, topicId, strength, reason, hops) => {
      if (seen.has(topicId)) return;
      const row = rowOf(topicId, strength, reason, hops);
      if (!row || sameName(row.name)) return;
      seen.add(topicId);
      list.push(row);
    };
    // Every edge the walk followed (G2c), as {from: prerequisite, to: topic, strength}, so a view can
    // draw the real arrows — including one between two one-hop prerequisites that the per-id dedupe
    // above folds into a single row. Only edges whose two ends are both in the view are kept.
    const walked = [];
    const walk = (e) => walked.push({ from: e.prerequisiteId, to: e.topicId, strength: e.strength });
    for (const e of this.#prereqs.get(id) ?? []) { walk(e); push(prerequisites, seenPrereq, e.prerequisiteId, e.strength, e.reason, 1); }
    for (const e of this.#prereqs.get(id) ?? []) {
      for (const e2 of this.#prereqs.get(e.prerequisiteId) ?? []) { walk(e2); push(prerequisites, seenPrereq, e2.prerequisiteId, e2.strength, e2.reason, 2); }
    }
    for (const e of this.#dependents.get(id) ?? []) { walk(e); push(dependents, seenDependent, e.topicId, e.strength, e.reason, 1); }
    const shown = new Set([id, ...prerequisites.map((r) => r.id), ...dependents.map((r) => r.id)]);
    const seenEdge = new Set();
    const edges = walked.filter((e) => {
      const k = `${e.from}>${e.to}`;
      if (!shown.has(e.from) || !shown.has(e.to) || e.from === e.to || seenEdge.has(k)) return false;
      seenEdge.add(k);
      return true;
    });
    return {
      // The anchor carries its own evidence lines (G2c): the objectives step offers them as wording a
      // teacher may copy into their own objective field. They are never bound to an objective.
      anchor: { id: t.id, name: t.name, subject: t.subject ?? "", domain: t.domain ?? "", ageRangeStart: t.ageRangeStart, ageRangeEnd: t.ageRangeEnd, evidence: Array.isArray(t.evidence) ? [...t.evidence] : [] },
      prerequisites,
      dependents,
      edges,
    };
  }
}

/**
 * The shared lazy facade. `load` returns the snapshot TEXT (Promise<string>). The graph is
 * built on first use, cached, and rebuilt after a failed load so one outage never poisons
 * the rest of the session. `search` returns {hits}; `topic` returns the node plus its
 * prerequisites and dependents in one object (or null).
 */
export function createMarbleService(load) {
  if (typeof load !== "function") throw new Error("marble: a snapshot loader is required");
  let ready = null;
  const graph = () => {
    if (!ready) {
      ready = Promise.resolve()
        .then(async () => new MarbleGraph(parseMarbleSnapshot(await load())))
        .catch((e) => { ready = null; throw e; });
    }
    return ready;
  };
  return {
    async search(query, opts = {}) { return { hits: (await graph()).search(query, opts) }; },
    async get(id) { return (await graph()).get(id); },
    async topic(id) {
      const g = await graph();
      const t = g.get(id);
      if (!t) return null;
      return { ...t, prerequisites: g.prerequisites(id), dependents: g.dependents(id) };
    },
    async coverage(range = {}) { return (await graph()).coverage(range); },
    async neighbourhood(id) { return (await graph()).neighbourhood(id); },
    /** M1: the graph itself, for the skill-map step's ranking input, validation and lanes (read-only). */
    async graph() { return graph(); },
  };
}
