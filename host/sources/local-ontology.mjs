/**
 * local-ontology.mjs — a graph ontology that is NOT ASFAI, as a knowledge source.
 *
 * This is what makes "Silicus supports graph ontologies more generally" true rather than
 * aspirational: a school district's own skill list is a first-class source, with no network,
 * no embeddings, no vector store and no dependency. Deliberately dumb — a flat node list with
 * lexical matching and membership verification. If this ever grows an inference engine or a
 * hierarchy reasoner, that is the signal to stop and reconsider.
 *
 * File format (hand-editable):
 *   { "version": 1, "nodes": [ { "id": "algebra.block", "title": "Block algebra",
 *       "statement": "Model a situation with blocks.", "relatedTo": ["algebra.balance"] } ] }
 *
 * A missing, unreadable or malformed file is a state (no context), never a crash.
 */
import { readFile } from "node:fs/promises";
import { KnowledgeSource, makeCitation } from "../knowledge.mjs";

const STOP = new Set(["a", "an", "and", "are", "about", "can", "do", "for", "how", "in", "is", "lesson", "of", "on", "or", "the", "to", "what", "with", "students", "learners", "be", "able"]);

function terms(text) {
  const raw = String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(raw.filter((t) => !STOP.has(t) && t.length > 1).map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t)))];
}

export class LocalOntologySource extends KnowledgeSource {
  #file;

  /** @param {{file?: string | null}} [opts] */
  constructor({ file = null } = {}) {
    super();
    this.#file = file ? String(file) : null;
  }

  get id() { return "local-ontology"; }
  get label() { return "your ontology file"; }
  get namespace() { return "local"; }
  get enabled() { return Boolean(this.#file); }
  get canVerify() { return true; }       // membership on id
  get egress() { return null; }          // nothing leaves the machine

  async #nodes() {
    if (!this.#file) return [];
    try {
      const doc = JSON.parse(await readFile(this.#file, "utf8"));
      if (!doc || !Array.isArray(doc.nodes)) return [];
      return doc.nodes.filter((n) => n && typeof n.id === "string" && n.id && typeof n.title === "string" && n.title);
    } catch {
      return [];
    }
  }

  async retrieve({ topic = "", objectives = [], limit = 8 } = {}) {
    if (!this.enabled) return [];
    const nodes = await this.#nodes();
    const q = terms([topic, ...objectives.map((o) => o?.statement)].join(" "));
    if (nodes.length === 0 || q.length === 0) return [];
    const scored = nodes.map((n, i) => {
      const title = new Set(terms(n.title));
      const body = new Set(terms(n.statement));
      const score = q.reduce((s, t) => s + (title.has(t) ? 3 : 0) + (body.has(t) ? 1 : 0), 0);
      return { n, i, score };
    }).filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.slice(0, limit).map(({ n }) => makeCitation({
      ref: `local:${n.id}`, label: n.title, text: typeof n.statement === "string" ? n.statement : "", source: this.id,
    }));
  }

  async verify({ citations = [] } = {}) {
    if (!this.enabled) return { ok: true, unknown: [], checked: false };
    const have = new Set((await this.#nodes()).map((n) => `local:${n.id}`));
    if (have.size === 0) return { ok: true, unknown: [], checked: false }; // no readable file: we did not check
    const unknown = citations.map((c) => String(c?.ref ?? "")).filter((r) => r.startsWith("local:") && !have.has(r));
    return { ok: unknown.length === 0, unknown, checked: true };
  }
}
