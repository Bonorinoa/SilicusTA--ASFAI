/**
 * rank-map.mjs — the skill-map step (M1): what the host sends the model, how it judges the reply, and how it
 * lays the result out as threads of real Marble chains. Shared by BOTH hosts (handler.mjs imports it).
 *
 *   rankInput(graph, ages)        the topics overlapping the course ages: id, name, subject, domain. Never a
 *                                 description: the model ranks by names, the teacher reads the descriptions.
 *   validateRanking(raw, graph, ages)
 *                                 the model's reply, judged: every id exists and overlaps the ages, a thread name is
 *                                 1-40 characters, `why` is cleaned to 120. Anything invalid is DROPPED, never
 *                                 repaired into something the model did not say. At most 8 suggestions, 3 threads.
 *   mapLanes(graph, suggestions, ages)
 *                                 one lane per thread. Five columns (Earlier · Comes before · Best fit · Leads to ·
 *                                 Later) built ONLY from real edges around the thread's best suggestion; a suggestion
 *                                 that is not on that chain becomes an "Also in this thread" pill with a true note.
 *   lane(graph, id, ages)         the same lane for one topic the teacher found by search ("Your pick").
 *   titleOnMap(graph, ages, title) does any topic NAME at these ages contain a word of the title? (wait line 3)
 *
 * Marble: withmarbleapp/os-taxonomy; database ODbL 1.0, Marble-authored text CC BY-SA 4.0.
 */
import { clean } from "../worker.mjs";
import { overlaps, terms } from "./marble-graph.mjs";

export const MAX_RANKED = 8;
export const MAX_THREADS = 3;
export const MAX_THREAD_CHARS = 40;
export const MAX_WHY_CHARS = 120;
export const COLUMNS = ["Earlier", "Comes before", "Best fit", "Leads to", "Later"];

const agesOf = (t) => ({ min: Number(t?.ageRangeStart), max: Number(t?.ageRangeEnd) });
const fits = (t, ages) => Boolean(t) && (!ages || overlaps(agesOf(t), ages));

/** The ranking input: topics overlapping the ages, names + subject + domain only. */
export function rankInput(graph, ages) {
  return graph.topics.filter((t) => fits(t, ages)).map((t) => ({ id: t.id, name: t.name, subject: t.subject, domain: t.domain }));
}

/** @returns {{id: string, thread: string, why: string}[]} */
export function validateRanking(raw, graph, ages) {
  const list = Array.isArray(raw?.suggestions) ? raw.suggestions : [];
  const out = [];
  const seen = new Set();
  const threads = [];
  for (const s of list) {
    if (out.length >= MAX_RANKED) break;
    const id = typeof s?.id === "string" ? s.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const t = graph.get(id);
    if (!t || !fits(t, ages)) continue;
    const thread = clean(s?.thread, 200);
    if (!thread || thread.length > MAX_THREAD_CHARS) continue;
    if (!threads.includes(thread)) {
      if (threads.length >= MAX_THREADS) continue;
      threads.push(thread);
    }
    seen.add(id);
    out.push({ id, thread, why: clean(s?.why, MAX_WHY_CHARS) });
  }
  return out;
}

/** Pick the neighbour to put on the chain: a suggestion of this thread first, then one at the class's ages, then a hard edge. */
function pickNeighbour(rows, { prefer, ages, graph, taken }) {
  const cands = rows.filter((r) => !taken.has(r.topicId) && graph.get(r.topicId));
  if (cands.length === 0) return null;
  const score = (r) => (prefer.has(r.topicId) ? 4 : 0) + (fits(graph.get(r.topicId), ages) ? 2 : 0) + (r.strength === "hard" ? 1 : 0);
  return [...cands].sort((a, b) => score(b) - score(a))[0].topicId;
}

function prereqRows(graph, id) {
  const p = graph.prerequisites(id);
  return p ? [...p.hard, ...p.soft] : [];
}

/** One chain of five columns around `best`, from real edges only. Empty columns are null. */
function chainAround(graph, best, ages, prefer) {
  const taken = new Set([best]);
  const take = (id) => { if (id) taken.add(id); return id; };
  const before1 = take(pickNeighbour(prereqRows(graph, best), { prefer, ages, graph, taken }));
  const before2 = before1 ? take(pickNeighbour(prereqRows(graph, before1), { prefer, ages, graph, taken })) : null;
  const after1 = take(pickNeighbour(graph.dependents(best) ?? [], { prefer, ages, graph, taken }));
  const after2 = after1 ? take(pickNeighbour(graph.dependents(after1) ?? [], { prefer, ages, graph, taken })) : null;
  return [before2, before1, best, after1, after2];
}

/** Every real edge between two topics on the chain, by column (adjacent ones and skips). */
function chainEdges(graph, chain) {
  const edges = [];
  chain.forEach((to, j) => {
    if (!to) return;
    for (const r of prereqRows(graph, to)) {
      const i = chain.indexOf(r.topicId);
      if (i >= 0 && i < j) edges.push({ from: i, to: j, strength: r.strength });
    }
  });
  return edges;
}

/** A true note for a suggestion that is not on the chain. */
function offChainNote(graph, id, chain) {
  const pre = prereqRows(graph, id);
  const onChain = pre.find((r) => chain.includes(r.topicId));
  if (onChain) return `comes after ${onChain.name}`;
  const dep = (graph.dependents(id) ?? []).find((r) => chain.includes(r.topicId));
  if (dep) return `comes before ${dep.name}`;
  if (pre[0]?.name) return `comes after ${pre[0].name}`;
  return "not linked to the topics above";
}

function topicCard(graph, id, ages) {
  const t = graph.get(id);
  return {
    id, name: t.name, subject: t.subject, domain: t.domain,
    ageRangeStart: t.ageRangeStart, ageRangeEnd: t.ageRangeEnd,
    description: t.description ?? "", evidence: Array.isArray(t.evidence) ? t.evidence.slice(0, 3) : [],
    fits: fits(t, ages),
  };
}

/**
 * @param {any} graph
 * @param {{id: string, thread: string, why: string}[]} suggestions  already validated
 * @param {{min: number, max: number} | null} ages
 */
export function mapLanes(graph, suggestions, ages) {
  const rank = new Map(suggestions.map((s, i) => [s.id, i + 1]));
  const names = [...new Set(suggestions.map((s) => s.thread))];
  const topics = {};
  const threads = names.map((name) => {
    const mine = suggestions.filter((s) => s.thread === name);
    const prefer = new Set(mine.map((s) => s.id));
    const chain = chainAround(graph, mine[0].id, ages, prefer);
    const also = mine.filter((s) => !chain.includes(s.id)).map((s) => ({ id: s.id, note: offChainNote(graph, s.id, chain) }));
    for (const id of [...chain, ...also.map((a) => a.id)]) if (id) topics[id] = topicCard(graph, id, ages);
    return { name, chain, edges: chainEdges(graph, chain), also };
  });
  return {
    threads,
    topics,
    suggestions: suggestions.map((s) => ({ ...s, rank: rank.get(s.id) })),
  };
}

/** "Your pick": one lane around a topic the teacher found by search. No rank, no why. */
export function lane(graph, id, ages) {
  if (!graph.get(id)) return null;
  const chain = chainAround(graph, id, ages, new Set());
  const topics = {};
  for (const x of chain) if (x) topics[x] = topicCard(graph, x, ages);
  return { threads: [{ name: "Your pick", chain, edges: chainEdges(graph, chain), also: [] }], topics, suggestions: [] };
}

const TITLE_STOP = new Set(["why", "when", "where", "who", "which", "does", "did", "make", "makes"]);

/** Does any topic NAME at these ages contain a word of the title (as a whole word)? */
export function titleOnMap(graph, ages, title) {
  const words = terms(String(title ?? "")).filter((w) => w.length > 2 && !TITLE_STOP.has(w));
  if (words.length === 0) return true;
  return graph.topics.some((t) => fits(t, ages) && words.some((w) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "")}s?\\b`, "i").test(t.name)));
}

/** The first title word that is NOT in any topic name (for "{Grass} isn't a topic on the map"). */
export function missingTitleWord(graph, ages, title) {
  // The teacher's own word is returned ("grass"), not the stemmed term ("gras").
  for (const word of String(title ?? "").match(/[\p{L}\p{N}]+/gu) ?? []) {
    const w = terms(word)[0];
    if (!w || w.length <= 2 || TITLE_STOP.has(w)) continue;
    if (!titleOnMap(graph, ages, word)) return word.toLowerCase();
  }
  return null;
}

/** The skill-map source text for objective proposals: description + evidence lines. Transient: never recorded. */
export function mapSourceText(t) {
  return [
    `Skill-map topic (Marble, CC BY-SA 4.0): ${t.name}, ages ${t.ageRangeStart}–${t.ageRangeEnd}.`,
    t.description ?? "",
    "What a learner can show:",
    ...(Array.isArray(t.evidence) ? t.evidence : []).map((e) => `- ${e}`),
  ].join("\n");
}
