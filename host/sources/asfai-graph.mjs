/**
 * asfai-graph.mjs — ASFAI's Marble graph as a knowledge source (the RECOMMENDED one).
 *
 * Verified against the partner source (src/lib/register-asfai-tools.ts), not guessed:
 *   search_objectives  payload { query: string (min 1), limit?: int 1..100 }, STRICT.
 *                      Result: an array of topics { id, name, subject, domain, description,
 *                      ageRangeStart, ageRangeEnd, standards[], ... }.
 *   get_objective      payload { id } → the topic, or a tool error "No objective '<id>'."
 *   verify_standard_alignment takes { objectiveId, standardCode } — it checks that a STANDARD
 *                      CODE is mapped to an objective. It cannot check an arbitrary citation,
 *                      and our citations are objective ids, so verify() uses get_objective
 *                      (membership) instead. Using the wrong action would have "verified" nothing.
 *
 * Marble is a children's map. A university topic returns an empty list (normal) or a
 * plausible-looking children's node (documented: "maximum likelihood" → "Likelihood Language",
 * ages 9–10). The label therefore carries the node's age range so neither the worker nor the
 * teacher mistakes it for course content. It is only ever CONTEXT.
 *
 * Egress: querying sends the topic and the teacher's confirmed objective sentences to ASFAI.
 * `egress` says so, and the course only consults this source for a course whose answers the
 * teacher has already sent to ASFAI — no new egress without the teacher's own act.
 */
import { KnowledgeSource, makeCitation } from "../knowledge.mjs";

const MAX_QUERIES = 4;      // the topic + up to three objective sentences
const PER_QUERY = 5;

export class AsfaiGraphSource extends KnowledgeSource {
  #client;
  #isConnected;

  /**
   * @param {{client?: {callTool: Function} | null, isConnected?: () => boolean}} [opts]
   */
  constructor({ client = null, isConnected = () => true } = {}) {
    super();
    this.#client = client;
    this.#isConnected = isConnected;
  }

  get id() { return "asfai-graph"; }
  get label() { return "ASFAI's skill map"; }
  get namespace() { return "asfai"; }
  get enabled() {
    try { return Boolean(this.#client) && this.#isConnected() === true; } catch { return false; }
  }
  get canVerify() { return true; }       // for its OWN refs only, by membership
  get egress() { return "asfai"; }

  async retrieve({ topic = "", objectives = [], limit = 8 } = {}) {
    if (!this.enabled) return [];
    const queries = [...new Set([topic, ...objectives.map((o) => o?.statement)]
      .map((q) => String(q ?? "").trim().slice(0, 300))
      .filter(Boolean))].slice(0, MAX_QUERIES);
    if (queries.length === 0) return [];

    const per = Math.max(1, Math.min(PER_QUERY, limit));
    const batches = await Promise.all(queries.map(async (query) => {
      try {
        const hits = await this.#client.callTool("asfai_graph", { action: "search_objectives", payload: { query, limit: per } });
        return Array.isArray(hits) ? hits : [];
      } catch {
        return []; // an empty graph answer is a normal signal; an outage is not a course failure
      }
    }));

    const seen = new Set();
    const out = [];
    for (const hit of batches.flat()) {
      if (!hit || typeof hit.id !== "string" || typeof hit.name !== "string") continue;
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      // The graph's own name sometimes already ends in an age phrase ("... (age 8+)"): never print a second one.
      const ages = Number.isFinite(hit.ageRangeStart) && Number.isFinite(hit.ageRangeEnd) && !/\(ages? [^)]*\)\s*$/i.test(hit.name)
        ? ` (ages ${hit.ageRangeStart}–${hit.ageRangeEnd})` : "";
      out.push(makeCitation({
        ref: `asfai:${hit.id}`,
        label: `${hit.name}${ages}`,
        text: typeof hit.description === "string" ? hit.description : "",
        source: this.id,
      }));
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Is each cited objective real in the graph? Membership via get_objective. A tool error that says
   * the objective does not exist is "unknown"; anything else (outage, auth) means we did NOT check.
   */
  async verify({ citations = [] } = {}) {
    if (!this.enabled) return { ok: true, unknown: [], checked: false };
    const unknown = [];
    for (const c of citations) {
      const ref = String(c?.ref ?? "");
      if (!ref.startsWith("asfai:")) continue;
      try {
        await this.#client.callTool("asfai_graph", { action: "get_objective", payload: { id: ref.slice("asfai:".length) } });
      } catch (e) {
        if (e?.code === "TOOL_ERROR" && /No objective/i.test(String(e?.message))) { unknown.push(ref); continue; }
        return { ok: true, unknown: [], checked: false }; // could not check; never claim it did
      }
    }
    return { ok: unknown.length === 0, unknown, checked: true };
  }
}
