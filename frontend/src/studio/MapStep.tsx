/**
 * MapStep — step 2 of the new-course wizard, "On the skill map" (M1). Design: D1 DECISIONS.md + the PM's binding
 * comment (18 Nov).
 *
 *  - One model call ranks the topics that fit the ages (host: POST /knowledge/marble/rank). While it runs, the
 *    rotating wait lines say what really happens; Skip works at any time.
 *  - Lanes = threads. Five columns: Earlier · Comes before · Best fit · Leads to · Later, built by the HOST from real
 *    Marble edges only. A suggestion not on the chain is an "Also in this thread" pill. Positions never move.
 *  - Nothing is pre-anchored (the teacher confirms): suggestion 1 is only SELECTED. Continue stays disabled until
 *    "Anchor here" or "Skip the map". One connection, from another thread, is optional.
 *  - Search is the fallback (and the whole step when the ranking gave nothing). Anchoring a search result shows one
 *    lane, "Your pick": its real chain, no rank, no "why".
 *  - Under 640 px the lanes become a list (top to bottom: each topic comes before the next).
 *  - One Marble credit on this screen.
 */
import { useEffect, useMemo, useState } from "react";
import { host, type MarbleMap, type MarbleMapTopic } from "../gate/transport";
import { MarbleCredit } from "../components/MarbleCredit/MarbleCredit";
import { WaitLines } from "../components/WaitLines/WaitLines";
import { RANKING_LATE, RANKING_SUB, rankingLines } from "./mapLines";
import type { Anchor } from "./audience";
import { Button } from "./ui";
import m from "./MapStep.module.css";

export const COLUMNS = ["Earlier", "Comes before", "Best fit", "Leads to", "Later"] as const;
type Ages = { min: number; max: number };
export interface MapChoice { anchor: Anchor | null; connected: Anchor | null; skipped: boolean }

const rankCache = new Map<string, Promise<MarbleMap>>();
export const _resetRankCache = () => rankCache.clear();
function rankOnce(title: string, goal: string, ages: Ages): Promise<MarbleMap> {
  const key = JSON.stringify([title.trim(), goal.trim(), ages.min, ages.max]);
  let p = rankCache.get(key);
  if (!p) {
    p = host.marbleRank({ title: title.trim(), goal: goal.trim(), ages }).catch(() => ({ threads: [], topics: {}, suggestions: [], reason: "UNREACHABLE" }) as MarbleMap);
    rankCache.set(key, p);
  }
  return p;
}

function useNarrow(): boolean {
  const q = "(max-width: 640px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

const asAnchor = (t: MarbleMapTopic): Anchor => ({ id: t.id, name: t.name, subject: t.subject, ageRangeStart: t.ageRangeStart, ageRangeEnd: t.ageRangeEnd });

export function MapStep({ title, goal, ages, choice, onChoice }: {
  title: string; goal: string; ages: Ages; choice: MapChoice; onChoice: (c: MapChoice) => void;
}) {
  const narrow = useNarrow();
  const [ranked, setRanked] = useState<MarbleMap | null>(null);
  const [facts, setFacts] = useState<{ fit: number | null; total: number | null; missingWord: string | null }>({ fit: null, total: null, missingWord: null });
  const [pick, setPick] = useState<MarbleMap | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Anchor[] | null>(null);

  useEffect(() => {
    let live = true;
    host.marbleCoverageFor(ages.min, ages.max, title).then((c) => { if (live) setFacts({ fit: c.overlapping, total: c.total ?? null, missingWord: c.missingWord ?? null }); }).catch(() => {});
    void rankOnce(title, goal, ages).then((r) => { if (!live) return; setRanked(r); setSel((s) => s ?? r.suggestions[0]?.id ?? null); if (r.threads.length === 0) setSearching(true); });
    return () => { live = false; };
  }, [title, goal, ages.min, ages.max]);

  // An anchor that is not on the ranked map (a search result) shows its own lane, "Your pick".
  const anchorId = choice.anchor?.id ?? null;
  const onRanked = (id: string | null) => !!id && !!ranked?.topics[id];
  useEffect(() => {
    if (!anchorId || onRanked(anchorId)) { setPick(null); return; }
    let live = true;
    host.marbleLane(anchorId, ages.min, ages.max).then((l) => { if (live) setPick(l); }).catch(() => {});
    return () => { live = false; };
  }, [anchorId, ranked, ages.min, ages.max]);

  useEffect(() => {
    if (!searching || q.trim().length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => {
      host.marbleSearch(q.trim(), ages.min, ages.max)
        .then((r) => { if (live) setHits(r.hits.map((h) => ({ id: h.id, name: h.name, subject: h.subject, ageRangeStart: h.ageRangeStart, ageRangeEnd: h.ageRangeEnd }))); })
        .catch(() => { if (live) setHits([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [searching, q, ages.min, ages.max]);

  const shown: MarbleMap | null = pick ?? ranked;
  const rank = useMemo(() => new Map((shown?.suggestions ?? []).map((s) => [s.id, s])), [shown]);
  const threadOf = (id: string | null) => (id ? shown?.threads.find((t) => t.chain.includes(id) || t.also.some((a) => a.id === id)) ?? null : null);

  const anchorHere = (t: Anchor) => {
    const sameThread = choice.connected && threadOf(choice.connected.id) === threadOf(t.id);
    onChoice({ anchor: t, connected: sameThread || choice.connected?.id === t.id ? null : choice.connected, skipped: false });
    setSel(t.id);
  };
  const anchorFromSearch = (t: Anchor) => { onChoice({ anchor: t, connected: null, skipped: false }); setSel(t.id); setSearching(false); setQ(""); };

  if (!ranked) {
    return (
      <div className={m.card} aria-busy="true">
        <WaitLines label="Ranking skill-map topics" every={1300} lateAfter={8000} late={RANKING_LATE} sub={RANKING_SUB}
          lines={rankingLines({ fit: facts.fit, total: facts.total, ages, title, missingWord: facts.missingWord })} />
        <div className={m.skeleton} aria-hidden="true"><span /><span /><span /></div>
        <MarbleCredit className={m.credit} />
      </div>
    );
  }

  const selected = sel ? shown?.topics[sel] ?? null : null;
  const detail = selected ? (
    <Detail t={selected} s={rank.get(selected.id) ?? null} thread={threadOf(selected.id)?.name ?? null} ages={ages}
      hasAnchor={!!choice.anchor} isAnchor={anchorId === selected.id} isConnected={choice.connected?.id === selected.id}
      canConnect={!!choice.anchor && anchorId !== selected.id && !pick && threadOf(selected.id) !== threadOf(anchorId)}
      onAnchor={() => anchorHere(asAnchor(selected))}
      onConnect={() => onChoice({ ...choice, connected: asAnchor(selected) })}
      onUndo={() => onChoice({ ...choice, connected: null })} />
  ) : null;

  const lede = pick ? "Your pick, with what comes before and after it on the map."
    : ranked.threads.length === 0 && ranked.reason === "WORKER_TIMEOUT" ? "The map took too long. Search it, or skip it."
    : ranked.threads.length === 0 ? "Silicus had no suggestions for this. Search the map, or skip it."
    : `${ranked.threads.length === 1 ? "One thread fits" : `${ranked.threads.length === 2 ? "Two" : "Three"} threads fit`} your question. Pick the topic your lesson stands on.`;

  return (
    <div className={m.card}>
      <div className={m.cardHead}>
        <p className={m.lede}>{lede}</p>
        <button type="button" className={m.link} onClick={() => setSearching((x) => !x)} aria-expanded={searching}>{searching ? "Close search" : "Search the map"}</button>
      </div>
      {searching ? (
        <div className={m.search}>
          <label className={m.searchLabel} htmlFor="map-search">Search topics for ages {ages.min}–{ages.max}</label>
          <input id="map-search" type="search" className={m.searchInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder="light, plants, colour…" autoComplete="off" />
          {hits === null ? null : hits.length === 0 ? <p className={m.quiet}>Nothing at these ages matches. Try other words, or skip the map.</p> : (
            <ul className={m.hits} aria-label="Skill-map topics">
              {hits.map((h) => (
                <li key={h.id} className={m.hit}>
                  <span><span className={m.hitName}>{h.name}</span> <span className={m.quiet}>· ages {h.ageRangeStart}–{h.ageRangeEnd} · {h.subject}</span></span>
                  <button type="button" className={m.hitAnchor} onClick={() => anchorFromSearch(h)} aria-label={`Anchor here: ${h.name}`}>Anchor here</button>
                </li>
              ))}
            </ul>
          )}
          <p className={m.quiet}>A search result has no rank and no thread; the map still shows what comes before it.</p>
        </div>
      ) : null}
      {shown && shown.threads.length > 0 ? (
        <>
          {narrow ? <p className={m.legend}>Top to bottom: each topic comes before the next. Numbers are Silicus’s suggestions, best first.</p> : (
            <div className={m.cols} aria-hidden="true">{COLUMNS.map((c, i) => <span key={c} data-best={i === 2 ? "true" : undefined}>{c}</span>)}</div>
          )}
          {/* K4 (C6): the skip arc gets a key, so the thin line above a row is not a mystery. */}
          {!narrow && shown.threads.some((th) => th.edges.some((e) => e.to - e.from > 1)) ? (
            <p className={m.legend} data-arc-legend>
              <svg className={m.legendArc} viewBox="0 0 28 10" aria-hidden="true"><path d="M 1 10 C 1 1 27 1 27 10" /></svg>
              Arc over a row: must come first (skips a step)
            </p>
          ) : null}
          {shown.threads.map((th, ti) => (
            <section key={th.name} className={m.lane} aria-label={`Thread: ${th.name}`}>
              <h3 className={m.laneHead}><span className={m.laneNum}>{pick ? "" : `Thread ${ti + 1}`}</span>{th.name}</h3>
              <div className={m.row} data-arcs={!narrow && th.edges.some((e) => e.to - e.from > 1) ? "true" : undefined}>
                {!narrow ? <Arcs edges={th.edges} /> : null}
                <ol className={m.chain}>
                  {th.chain.map((id, col) => id ? (
                    <li key={id} className={m.cell} style={narrow ? undefined : { gridColumn: col + 1 }} data-col={col}
                      data-in={th.edges.some((e) => e.to === col && e.from === col - 1) ? "true" : undefined}>
                      <Node t={shown.topics[id]} r={rank.get(id)?.rank ?? null} sel={sel === id} anchor={anchorId === id} connected={choice.connected?.id === id} onSelect={() => setSel(id)} />
                    </li>
                  ) : null)}
                </ol>
              </div>
              {th.also.length > 0 ? (
                <div className={m.also}>
                  <span className={m.alsoLabel}>{narrow ? "Not on this path" : "Also in this thread:"}</span>
                  {th.also.map((a) => (
                    <span key={a.id} className={m.alsoItem}>
                      <button type="button" className={m.pill} data-sel={sel === a.id ? "true" : undefined} data-anchor={anchorId === a.id ? "true" : undefined}
                        data-connected={choice.connected?.id === a.id ? "true" : undefined} onClick={() => setSel(a.id)}>
                        {rank.get(a.id) ? <span className={m.badge}>{rank.get(a.id)!.rank}</span> : null}{shown.topics[a.id]?.name}
                      </button>
                      <span className={m.quiet}>{a.note}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {narrow && selected && threadOf(selected.id) === th ? detail : null}
            </section>
          ))}
          {pick ? <button type="button" className={m.link} onClick={() => { onChoice({ anchor: null, connected: null, skipped: false }); setSel(ranked.suggestions[0]?.id ?? null); }}>Back to Silicus’s suggestions</button> : null}
          {!narrow ? detail : null}
        </>
      ) : null}
      <MarbleCredit className={m.credit} />
    </div>
  );
}

function Node({ t, r, sel, anchor, connected, onSelect }: { t: MarbleMapTopic; r: number | null; sel: boolean; anchor: boolean; connected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={m.node} onClick={onSelect} aria-pressed={sel}
      data-sel={sel ? "true" : undefined} data-anchor={anchor ? "true" : undefined} data-connected={connected ? "true" : undefined} data-out={t.fits ? undefined : "true"}>
      {r ? <span className={m.badge} aria-label={`Suggestion ${r}`}>{r}</span> : null}
      <span className={m.nodeName}>{t.name}</span>
      {/* K4 (C6): the state word sits on its own line, so no separator is left at a line break. */}
      <span className={m.nodeAges}>{`ages\u00a0${t.ageRangeStart}\u2060–\u2060${t.ageRangeEnd}${t.fits ? "" : "\u00a0·\u00a0later"}`}</span>
      {anchor || connected ? <span className={m.nodeState} data-node-state>{anchor ? "anchor" : "connected"}</span> : null}
    </button>
  );
}

/** Skip edges (a real edge that jumps a column) as thin arcs above the row, clear of the number badges. */
function Arcs({ edges }: { edges: { from: number; to: number }[] }) {
  const skips = edges.filter((e) => e.to - e.from > 1);
  if (skips.length === 0) return null;
  // Column centres (five columns, 14 px gaps): the arc leaves each node's top centre, rises straight up and runs
  // along the top of the 24 px band, so it stays above the number badges (which sit 8 px above a node's top-left).
  const x = (c: number) => c * 20.4 + 9.1;
  return (
    <svg className={m.arcs} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      {skips.map((e) => <path key={`${e.from}-${e.to}`} d={`M ${x(e.from)} 24 C ${x(e.from)} 0 ${x(e.to)} 0 ${x(e.to)} 24`} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

function Detail({ t, s, thread, ages, hasAnchor, isAnchor, isConnected, canConnect, onAnchor, onConnect, onUndo }: {
  t: MarbleMapTopic; s: { rank: number; why: string } | null; thread: string | null; ages: Ages; hasAnchor: boolean;
  isAnchor: boolean; isConnected: boolean; canConnect: boolean; onAnchor: () => void; onConnect: () => void; onUndo: () => void;
}) {
  const L = 3, R = 15, pct = (v: number) => `${((Math.min(Math.max(v, L), R + 1) - L) / (R + 1 - L)) * 100}%`;
  return (
    <div className={m.detail} aria-live="polite" data-map-detail>
      <div className={m.detailBody}>
        <span className={m.kicker}>{s ? `Suggestion ${s.rank}` : "On the map"}{thread ? ` · ${thread}` : ""}</span>
        <h3 className={m.detailName}>{t.name}</h3>
        <span className={m.ageRow}>
          <span className={m.ageBar} aria-hidden="true">
            <i style={{ left: pct(ages.min), width: `calc(${pct(ages.max + 1)} - ${pct(ages.min)})` }} />
            <b style={{ left: pct(t.ageRangeStart), width: `calc(${pct(t.ageRangeEnd + 1)} - ${pct(t.ageRangeStart)})` }} />
          </span>
          <span className={m.quiet}>ages {t.ageRangeStart}–{t.ageRangeEnd}{t.fits ? "" : " · after your learners’ ages"}</span>
        </span>
        {s?.why ? <p className={m.why}><span className={m.whyTag}>Silicus’s suggestion:</span> {s.why}</p> : null}
        <p className={m.desc}>{t.description}</p>
        {t.evidence.length ? (
          <details className={m.evidence}><summary>What a learner can show ({t.evidence.length})</summary><ul>{t.evidence.map((e) => <li key={e}>{e}</li>)}</ul></details>
        ) : null}
      </div>
      <div className={m.actions}>
        {isAnchor ? <span className={m.status}>Your anchor</span>
          : isConnected ? <><span className={m.status}>Connected</span><button type="button" className={m.link} onClick={onUndo}>Undo</button></>
          : t.fits ? (
            <>
              <Button variant="primary" onClick={onAnchor} data-anchor-here="true">{hasAnchor ? "Anchor here instead" : "Anchor here"}</Button>
              {canConnect ? <Button variant="secondary" onClick={onConnect} data-connect="true">Connect</Button> : null}
            </>
          ) : <span className={m.quiet}>Outside your learners’ ages, so it can’t be the anchor.</span>}
      </div>
    </div>
  );
}
