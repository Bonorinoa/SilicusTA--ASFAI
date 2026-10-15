/**
 * AiWaiting — the one waiting experience for every AI step (propose objectives, draft the plan, a student's answer).
 *
 * Honest by construction:
 *  - it says in plain words what is happening, counting things that are really in the view;
 *  - the clock is a real clock (it holds while the passcode dialog waits for the teacher) and the typical range is
 *    the worker status's `typicalSeconds`, or the documented defaults when that is absent;
 *  - there is NO progress bar and no percentage, because nothing the page can see measures progress. The motion
 *    is lines of type being set, looping, and still under prefers-reduced-motion;
 *  - "What the model sees" lists exactly what this step sends, derived from data already in the page;
 *  - it announces twice (start, finish) through one polite live region, never every second;
 *  - the receipt on finish is recomputed from the resulting view (see model.ts).
 * It decides nothing and never implies the AI did: the AI drafts, the teacher decides.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { AcceptedIcon } from "../icons";
import {
  describeStep, formatElapsed, rangePhrase, startAnnouncement, typicalRange,
  type WaitingStep,
} from "./model";
import styles from "./AiWaiting.module.css";

export type WaitingPhase = "running" | "done" | "failed";

export interface AiWaitingProps {
  step: WaitingStep;
  phase: WaitingPhase;
  /** The worker status's `typicalSeconds` (optional, unvalidated: malformed entries fall back to the defaults). */
  typicalSeconds?: unknown;
  /** The passcode dialog is open: the teacher is typing, not the model working, so the clock holds. */
  paused?: boolean;
  /** Lines of the true receipt, computed by the caller from the resulting view (done only). */
  receipt?: readonly string[];
  /** Only an explicit true earns the zero-retention sentence. */
  zdr?: boolean | null;
  /** "compact" is the in-chat variant for a student's answer. */
  variant?: "card" | "compact";
}

/** Lines of type: the width of each word, in ch. Fixed, decorative, and meaningless on purpose. */
const LINES: readonly (readonly number[])[] = [
  [5, 3, 7, 4, 2, 6],
  [4, 6, 3, 5, 4],
  [7, 2, 5],
];

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export function AiWaiting({
  step, phase, typicalSeconds, paused = false, receipt = [], zdr = null, variant = "card",
}: AiWaitingProps) {
  const text = describeStep(step);
  const range = typicalRange(step.kind, typicalSeconds);
  const reduced = useReducedMotion();
  const compact = variant === "compact";
  const ids = { title: useId(), panel: useId() };

  // ---- a real clock: milliseconds of ACTUAL waiting, held while the teacher is at the passcode dialog
  const [seconds, setSeconds] = useState(0);
  const spent = useRef(0);
  const last = useRef(Date.now());
  const holding = useRef(paused);
  const tick = () => {
    const now = Date.now();
    if (!holding.current) spent.current += now - last.current;
    last.current = now;
    setSeconds(Math.floor(spent.current / 1000));
  };
  useEffect(() => {
    tick(); // bank the time up to now under the OLD state before the state changes
    holding.current = paused;
  }, [paused]);
  useEffect(() => {
    if (phase !== "running") { tick(); return; }
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [phase]);

  // ---- one polite live region, written at the start and at the finish only
  const [announcement, setAnnouncement] = useState("");
  const title = text.title;
  useEffect(() => { setAnnouncement(startAnnouncement(title, range)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finishedAt = useRef<WaitingPhase>("running");
  useEffect(() => {
    if (phase === finishedAt.current) return;
    finishedAt.current = phase;
    if (phase === "done") setAnnouncement(`Finished after ${formatElapsed(Math.floor(spent.current / 1000))}. ${receipt.join(" ")}`.trim());
    if (phase === "failed") setAnnouncement(`Stopped after ${formatElapsed(Math.floor(spent.current / 1000))}.`);
  }); // after every render: cheap, and it must see the receipt that arrives WITH the phase

  // ---- bring a card the teacher did not scroll to into view (never steals focus)
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!compact && el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [open, setOpen] = useState(false);
  const running = phase === "running";
  const longer = running && !paused && seconds > range[1];

  const live = <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announcement}</p>;

  // A finished compact step has nothing to add: the answer itself is the result. Only the announcement remains.
  if (compact && phase === "done") return <section aria-label="AI step finished" ref={root} data-variant="compact" data-phase="done">{live}</section>;

  const eyebrow = running ? "The AI is drafting \u00b7 nothing is decided yet" : phase === "done" ? "Draft ready \u00b7 nothing is decided yet" : "Stopped";

  return (
    <section
      ref={root}
      className={styles.root}
      aria-labelledby={ids.title}
      data-phase={phase}
      data-variant={variant}
      data-motion={reduced ? "still" : "live"}
    >
      {live}
      {compact ? null : <p className={styles.eyebrow}>{eyebrow}</p>}
      <p id={ids.title} className={styles.title}>{phase === "done" ? text.doneTitle : title}</p>
      {text.detail && !compact ? <p className={styles.detail}>{text.detail}</p> : null}

      {running ? <div className={styles.ink} aria-hidden="true" data-lines={compact ? 1 : LINES.length}>
        {(compact ? LINES.slice(0, 1) : LINES).map((line, li) => (
          <div key={li} className={styles.line}>
            {line.map((w, wi) => (
              <span key={wi} className={styles.word} style={{ width: `${w}ch`, "--d": ((li * 6 + wi) * 7) % 17 } as CSSProperties} />
            ))}
          </div>
        ))}
      </div> : null}

      {running ? (
        paused ? (
          <p className={styles.clock}>Waiting for your passcode. The clock is held until you continue.</p>
        ) : (
          <p className={styles.clock}>
            <span className={styles.elapsed}>{formatElapsed(seconds)}</span> elapsed <span aria-hidden="true">{"\u00b7"}</span> {rangePhrase(range)}
          </p>
        )
      ) : (
        <p className={styles.clock}>
          {phase === "done" ? "Took" : "Stopped after"} <span className={styles.elapsed}>{formatElapsed(seconds)}</span>
        </p>
      )}

      {longer ? (
        <p className={styles.longer}>
          Taking longer than usual. If the model does not answer, this step stops by itself, and nothing you have recorded is lost.
        </p>
      ) : null}

      {phase === "done" && receipt.length > 0 ? (
        <div className={styles.receipt}>
          <AcceptedIcon size={16} className={styles.receiptMark} />
          <div className={styles.receiptLines}>{receipt.map((l, i) => <p key={i}>{l}</p>)}</div>
        </div>
      ) : null}

      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={ids.panel} onClick={() => setOpen((o) => !o)}>
        <span className={styles.chevron} aria-hidden="true" />
        What the model sees
      </button>
      <div id={ids.panel} className={styles.sees} hidden={!open}>
        {text.sends.map((g) => (
          <div key={g.heading} className={styles.group}>
            <p className={styles.groupHead}>{g.heading}</p>
            {g.ordered ? (
              <ol className={styles.items} data-quote={g.quote || undefined}>{g.items.map((it, i) => <li key={i}>{it}</li>)}</ol>
            ) : (
              <ul className={styles.items} data-quote={g.quote || undefined}>{g.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
            )}
          </div>
        ))}
        <div className={`${styles.group} ${styles.never}`}>
          <p className={styles.groupHead}>What it never sees</p>
          <ul className={styles.items}>{text.never.map((it) => <li key={it}>{it}</li>)}</ul>
        </div>
        {zdr === true ? (
          <div className={styles.group}>
            <p className={styles.groupHead}>Retention</p>
            <p className={styles.fine}>Sent to a drafting provider that is set to zero-data-retention endpoints only.</p>
          </div>
        ) : zdr === false ? (
          <div className={styles.group}>
            <p className={styles.groupHead}>Retention</p>
            <p className={styles.fine}>Sent to the drafting provider under its normal data-retention terms (not zero-retention).</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default AiWaiting;
