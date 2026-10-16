/**
 * FirstRunTour — four short panels that say what each part of Silicus does, once, to a new teacher.
 *
 * A real modal, shaped like PasscodeDialog: role="dialog" + aria-modal, focus goes in, Tab stays in, Escape
 * closes, focus returns to whatever opened it. Persistence is the PARENT's job (localStorage "silicus.tour.seen");
 * the tour never writes the record and never stores anything. `onClose` fires for Escape, Close and the last
 * panel's "Start my course"; the parent decides what comes next (focusing the first field, for instance).
 */
import { useEffect, useId, useRef, useState } from "react";
import { laneOf } from "../ActivityRail/lanes";
import { PANELS } from "./panels";
import styles from "./FirstRunTour.module.css";

export interface FirstRunTourProps {
  open: boolean;
  onClose: () => void;
  /** True only in the local app; online, ASFAI is never mentioned. */
  asfaiAvailable: boolean;
}

const STOPS = "button:not([disabled])";

export function FirstRunTour({ open, onClose, asfaiAvailable }: FirstRunTourProps) {
  const [index, setIndex] = useState(0);
  const sheet = useRef<HTMLElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const ids = { title: useId(), body: useId() };

  // Opening starts at the first panel and puts focus inside; closing puts focus back where it was.
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      setIndex(0);
      next.current?.focus();
    } else if (opener.current) {
      (opener.current as HTMLElement).focus?.();
      opener.current = null;
    }
  }, [open]);

  if (!open) return null;

  const panel = PANELS[index];
  const last = index === PANELS.length - 1;
  const step = `Step ${index + 1} of ${PANELS.length}`;

  return (
    <div className={styles.scrim}>
      <section
        ref={sheet}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-describedby={ids.body}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
          if (e.key !== "Tab") return;
          const stops = Array.from(sheet.current?.querySelectorAll<HTMLElement>(STOPS) ?? []);
          if (stops.length === 0) return;
          const [first, end] = [stops[0], stops[stops.length - 1]];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
          else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
        }}
      >
        <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{`${step}: ${panel.title}`}</p>

        <div className={styles.top}>
          <p className={styles.eyebrow}>How it works {"\u00b7"} {index + 1} of {PANELS.length}</p>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close the tour">Close</button>
        </div>

        <h2 id={ids.title} className={styles.title}>{panel.title}</h2>
        <div id={ids.body} className={styles.prose}>
          {panel.body.map((p) => <p key={p}>{p}</p>)}
          {asfaiAvailable && panel.asfai ? <p className={styles.aside}>{panel.asfai}</p> : null}
        </div>

        <ul className={styles.cast} aria-hidden="true">
          {(["teacher", "silicus", "worker", "asfai"] as const)
            .filter((a) => a !== "asfai" || asfaiAvailable)
            .map((a) => (
              <li key={a} className={styles.player} data-on={panel.actors.includes(a) || (a === "asfai" && index === 1) ? "" : undefined} data-actor={a}>
                <span className={styles.dot} />{laneOf(a).name}
              </li>
            ))}
        </ul>

        <div className={styles.verbs}>
          <span className={styles.ticks} aria-hidden="true">
            {PANELS.map((p, i) => <span key={p.title} className={styles.tick} data-state={i === index ? "now" : i < index ? "past" : "later"} />)}
          </span>
          {index > 0 ? <button type="button" className={styles.quiet} onClick={() => setIndex(index - 1)}>Back</button> : null}
          <button
            ref={next}
            type="button"
            className={styles.primary}
            onClick={() => (last ? onClose() : setIndex(index + 1))}
          >
            {last ? "Start my course" : "Next"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default FirstRunTour;
