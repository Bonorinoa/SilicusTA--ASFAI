/**
 * EarlierSteps — the stages the teacher has finished, one line each. A line opens on request to show what was
 * decided there. The page shows ONE stage expanded; this is how the rest stay reachable without competing with it.
 *
 * The body of a line is rendered only while it is open, so a closed line costs nothing and never puts a second
 * copy of anything (above all the lesson plan) on the page.
 */
import { useEffect, useState, type ReactNode } from "react";
import styles from "./Stage.module.css";

export interface EarlierStep {
  id: string;
  /** One line, what happened there: "Material list confirmed · 2 materials". */
  line: string;
  /** What opens under the line. Absent: the line is just a line. */
  body?: ReactNode;
  /** Open it (and keep it open) while this is true, e.g. while the teacher is revising. */
  forceOpen?: boolean;
}

function Line({ step }: { step: EarlierStep }) {
  const [open, setOpen] = useState(!!step.forceOpen);
  useEffect(() => { if (step.forceOpen) setOpen(true); }, [step.forceOpen]);
  if (!step.body) {
    return <li className={styles.earlier}><p className={styles.earlierLine}><span className={styles.tick} aria-hidden="true">{"\u2713"}</span><span>{step.line}</span></p></li>;
  }
  return (
    <li className={styles.earlier}>
      <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className={styles.earlierSummary}>
          <span className={styles.tick} aria-hidden="true">{"\u2713"}</span>
          <span>{step.line}</span>
          <span className={styles.show} aria-hidden="true">{open ? "Hide" : "Show"}</span>
        </summary>
        {open ? <div className={styles.earlierBody}>{step.body}</div> : null}
      </details>
    </li>
  );
}

export function EarlierSteps({ steps }: { steps: readonly EarlierStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className={styles.earlierList} aria-label="Earlier steps">
      {steps.map((s) => <Line key={s.id} step={s} />)}
    </ul>
  );
}
