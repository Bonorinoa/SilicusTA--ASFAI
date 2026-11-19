/**
 * WaitLines — the rotating wait (M1, DECISIONS §5). One line at a time, advancing every `every` ms and STOPPING on
 * the last one (never a loop). After `lateAfter` ms a late line appears. A breathing dot, no spinner, no ticks, no
 * percentage. Under prefers-reduced-motion the dot is still and lines swap without a fade. The caller unmounts it
 * the moment the result arrives.
 */
import { useEffect, useState } from "react";
import css from "./WaitLines.module.css";

import { Elapsed } from "./Elapsed";
export function WaitLines({ lines, every, sub, late, lateAfter, label, live = true }: {
  lines: string[]; every: number; sub?: string; late?: string; lateAfter?: number; label: string;
  /** K5: false where the page already has its one status line (the studio's StepStatus); then this is a labelled group. */
  live?: boolean;
}) {
  const [i, setI] = useState(0);
  const [isLate, setLate] = useState(false);
  useEffect(() => {
    if (i >= lines.length - 1) return;
    const t = setTimeout(() => setI((x) => Math.min(x + 1, lines.length - 1)), every);
    return () => clearTimeout(t);
  }, [i, lines.length, every]);
  useEffect(() => {
    if (!lateAfter) return;
    const t = setTimeout(() => setLate(true), lateAfter);
    return () => clearTimeout(t);
  }, [lateAfter]);
  return (
    <div className={css.wait} role={live ? "status" : "group"} aria-label={label} data-wait-lines>
      <p className={css.line}><span className={css.dot} aria-hidden="true" /><span key={i} className={css.text} data-line-index={i}>{lines[Math.min(i, lines.length - 1)]}</span></p>
      {live ? <p className={css.sub}><Elapsed /></p> : null}
      {isLate && late ? <p className={css.late}>{late}</p> : null}
      {sub ? <p className={css.sub}>{sub}</p> : null}
    </div>
  );
}
