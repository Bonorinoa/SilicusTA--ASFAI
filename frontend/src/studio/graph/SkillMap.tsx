/**
 * SkillMap.tsx — the skill map on the plan (G2c). Three read-only surfaces for a course with a Marble anchor:
 *
 *   NeighbourhoodView     the two-hop picture, collapsible; every box is focusable and its evidence lines
 *                         show in a panel below (so a touch screen reads them without hover)
 *   PrereqStrip           "Before this, learners need: …" at the top of the plan
 *   EvidenceSuggestions   the anchor's evidence lines, each a "Use as my objective" button that only
 *                         PRE-FILLS the teacher's own field. Nothing is added or confirmed by the click.
 *
 * Every surface carries the one MarbleCredit line. Nothing here writes to the course record.
 */
import { useEffect, useId, useRef, useState } from "react";
import { MarbleCredit } from "../../components/MarbleCredit/MarbleCredit";
import { host, type MarbleNeighbourhood } from "../../gate/transport";
import { Button } from "../ui";
import { asObjective, COLUMNS, layoutNeighbourhood, relationOf, type ColumnKey, type LaidNode } from "./layout";
import g from "./Graph.module.css";

// ---- data: one fetch per anchor per tab --------------------------------------------------------------------
const cache = new Map<string, Promise<MarbleNeighbourhood>>();
export function useNeighbourhood(anchorId: string | undefined): { data: MarbleNeighbourhood | null; failed: boolean } {
  const [state, setState] = useState<{ id?: string; data: MarbleNeighbourhood | null; failed: boolean }>({ data: null, failed: false });
  useEffect(() => {
    if (!anchorId) return;
    let live = true;
    let p = cache.get(anchorId);
    if (!p) {
      p = host.marbleNeighbourhood(anchorId);
      cache.set(anchorId, p);
      p.catch(() => cache.delete(anchorId)); // one outage never poisons the tab
    }
    p.then((data) => { if (live) setState({ id: anchorId, data, failed: false }); },
      () => { if (live) setState({ id: anchorId, data: null, failed: true }); });
    return () => { live = false; };
  }, [anchorId]);
  // Never show another anchor's neighbourhood while this one loads.
  return state.id === anchorId ? { data: state.data, failed: state.failed } : { data: null, failed: false };
}
/** Tests only. */
export const _resetNeighbourhoodCache = () => cache.clear();

const ages = (a: number, b: number) => (a === b ? `age ${a}` : `ages ${a}–${b}`);

// ---- the two-hop view --------------------------------------------------------------------------------------
export function NeighbourhoodView({ data, defaultOpen = false }: { data: MarbleNeighbourhood; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches);
  const box = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(data.anchor.id);
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w > 0) setNarrow(w < 600); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  const lay = layoutNeighbourhood(data, narrow ? "narrow" : "wide");
  const chosen: LaidNode = lay.nodes.find((n) => n.id === selected) ?? lay.nodes.find((n) => n.column === "lesson")!;
  const reason = chosen.column === "lesson" ? "" : chosen.node.reason ?? "";
  const counts = COLUMNS.map((c) => `${lay.nodes.filter((n) => n.column === c.key).length} ${c.label.toLowerCase()}`).join(", ");

  return (
    <details className={g.panel} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-neighbourhood="true">
      <summary className={g.summary}>
        <span className={g.summaryTitle}>Where this lesson sits in the skill map</span>
        <span className={g.summaryHint}>{data.anchor.name} · {data.prerequisites.length} before, {data.dependents.length} after</span>
      </summary>
      <div className={g.body}>
        <p className={g.legend}>
          <span className={g.key} aria-hidden="true" /> hard prerequisite
          <span className={`${g.key} ${g.keySoft}`} aria-hidden="true" /> soft (helpful, optional)
          <span className={g.legendHint}>Select a box to read its evidence lines.</span>
        </p>
        <div ref={box} className={g.figure}>
          <svg
            viewBox={`0 0 ${lay.width} ${lay.height}`} width="100%" style={{ maxWidth: lay.width }}
            role="group" aria-label={`Skill-map neighbourhood of ${data.anchor.name}: ${counts}`}
            data-orientation={lay.orientation}
          >
            <defs>
              <marker id={`a${markerId}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0L10,5L0,10z" className={g.arrowHead} />
              </marker>
            </defs>
            {lay.headers.map((h) => <text key={h.key} x={h.x} y={h.y} className={g.colHead}>{h.label.toUpperCase()}</text>)}
            {lay.edges.map((e) => (
              <path key={`${e.from}>${e.to}`} d={e.d} className={g.edge} strokeWidth={e.width} strokeDasharray={e.dash ?? undefined}
                markerEnd={`url(#a${markerId})`} data-edge={`${e.from}>${e.to}`} data-strength={e.strength}
                data-active={e.from === chosen.id || e.to === chosen.id ? "true" : undefined} />
            ))}
            {lay.nodes.map((n) => {
              const rel = relationOf(n.node, n.column);
              const isSel = n.id === chosen.id;
              return (
                <g
                  key={n.id} className={g.node} role="button" tabIndex={0} aria-pressed={isSel}
                  aria-label={`${n.node.name}. ${rel}. ${ages(n.node.ageRangeStart, n.node.ageRangeEnd)}.`}
                  data-node-id={n.id} data-column={n.column} data-strength={n.node.strength ?? "anchor"}
                  data-selected={isSel ? "true" : undefined} data-anchor={n.column === "lesson" ? "true" : undefined}
                  onClick={() => setSelected(n.id)} onFocus={() => setSelected(n.id)} onMouseEnter={() => setSelected(n.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(n.id); } }}
                >
                  <title>{`${n.node.name} (${n.id})`}</title>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={8} className={g.box} />
                  <text x={n.x + 10} y={n.y + 20} className={g.name}>
                    {n.lines.map((l, k) => <tspan key={k} x={n.x + 10} dy={k === 0 ? 0 : 15}>{l}</tspan>)}
                  </text>
                  <text x={n.x + 10} y={n.y + n.h - 11} className={g.meta}>{ages(n.node.ageRangeStart, n.node.ageRangeEnd)}{lay.orientation === "narrow" ? ` · ${n.node.subject}` : ""}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <section className={g.evidence} aria-label="Evidence lines" data-evidence-for={chosen.id}>
          <p className={g.evKicker}>{relationOf(chosen.node, chosen.column)} · {ages(chosen.node.ageRangeStart, chosen.node.ageRangeEnd)}</p>
          <h3 className={g.evTitle}>{chosen.node.name}</h3>
          {reason ? <p className={g.evReason}>Why it is linked: {reason}</p> : null}
          {chosen.node.evidence.length > 0 ? (
            <>
              <p className={g.evLabel}>What a learner can show:</p>
              <ul className={g.evList}>{chosen.node.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
            </>
          ) : <p className={g.evReason}>The skill map lists no evidence lines for this topic.</p>}
        </section>
        <MarbleCredit className={g.credit} />
      </div>
    </details>
  );
}

// ---- the strip at the top of the plan ------------------------------------------------------------------------
export function PrereqStrip({ data }: { data: MarbleNeighbourhood }) {
  const direct = data.prerequisites.filter((p) => (p.hops ?? 1) < 2);
  const hard = direct.filter((p) => p.strength === "hard");
  const soft = direct.filter((p) => p.strength !== "hard");
  return (
    <section className={g.strip} aria-label="Before this lesson" data-prereq-strip="true">
      {direct.length === 0 ? (
        <p className={g.stripLine}>The skill map lists nothing learners need before <strong>{data.anchor.name}</strong>.</p>
      ) : (
        <p className={g.stripLine}>
          <span className={g.stripLead}>Before this, learners need:</span>{" "}
          {[...hard, ...soft].map((p, i, all) => (
            <span key={p.id} className={g.prereq} data-marble-id={p.id} data-strength={p.strength} title={p.reason || undefined}>
              <strong>{p.name}</strong>{" "}
              <span className={p.strength === "hard" ? g.tagHard : g.tagSoft}>{p.strength === "hard" ? "(hard prerequisite)" : "(optional)"}</span>
              {i < all.length - 1 ? <span aria-hidden="true">{" · "}</span> : null}
            </span>
          ))}
        </p>
      )}
      <MarbleCredit className={g.credit} />
    </section>
  );
}

// ---- evidence lines as the start of the teacher's own objective --------------------------------------------
export function EvidenceSuggestions({ data, onUse }: { data: MarbleNeighbourhood; onUse: (text: string) => void }) {
  const lines = data.anchor.evidence ?? [];
  const head = useId();
  if (lines.length === 0) return null;
  return (
    <section className={g.suggest} aria-labelledby={head} data-evidence-suggestions="true">
      <h2 id={head} className={g.suggestTitle}>Wording from the skill map</h2>
      <p className={g.suggestLede}>
        The skill map lists what a learner can show for <strong>{data.anchor.name}</strong>. Use one as the start of your own
        objective: it goes into your field above, you edit it, and you add it. Nothing is added until you do.
      </p>
      <ul className={g.suggestList}>
        {lines.map((line, i) => (
          <li key={line} className={g.suggestItem}>
            <span id={`${head}-${i}`} className={g.suggestLine}>{line}</span>
            <Button size="small" variant="quiet" aria-describedby={`${head}-${i}`} data-use-evidence={i} onClick={() => onUse(asObjective(line))}>Use as my objective</Button>
          </li>
        ))}
      </ul>
      <MarbleCredit className={g.credit} />
    </section>
  );
}

export type { ColumnKey };
