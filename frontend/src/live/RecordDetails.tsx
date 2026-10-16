/**
 * RecordDetails — where the machine's words live. Ids, the event count, the gate's own refusal text and the
 * intake guard's own wording are all kept (the record is evidence, and a teacher can always see it), but they are
 * a click away instead of in the reading path. Nothing here is verified by being shown: "Verify the event log"
 * checks the log's chain, which is evidence of what was recorded, not proof of who decided it.
 */
import type { ReactNode } from "react";
import { plural } from "../lib/plural";
import styles from "./Stage.module.css";

export function RecordDetails({ courseId, events, busy, onVerify, gateMessages, intakeGuard, children }: {
  courseId: string;
  events: number;
  busy: boolean;
  onVerify: () => void;
  /** The gate's raw publish blockers, exactly as the gate wrote them. */
  gateMessages: readonly string[];
  /** The intake guard's own refusal text (developer wording). */
  intakeGuard: string | null;
  children?: ReactNode;
}) {
  return (
    <details className={styles.record} aria-label="Record details">
      <summary className={styles.recordSummary}>Record details</summary>
      <div className={styles.recordBody}>
        <dl className={styles.recordFacts}>
          <div><dt>Course</dt><dd className={styles.mono}>{courseId}</dd></div>
          <div><dt>Event log</dt><dd>{plural(events, "event")}, each linked to the one before it</dd></div>
        </dl>
        <button type="button" className={styles.textButton} onClick={onVerify} disabled={busy}>Verify the event log</button>
        {gateMessages.length > 0 ? (
          <section aria-label="What the gate said">
            <h3 className={styles.recordHeading}>What the gate said</h3>
            <ul className={styles.recordList}>{gateMessages.map((m) => <li key={m} className={styles.mono}>{m}</li>)}</ul>
          </section>
        ) : null}
        {intakeGuard ? (
          <section aria-label="What the intake guard said">
            <h3 className={styles.recordHeading}>What the intake guard said</h3>
            <p className={styles.mono}>{intakeGuard}</p>
          </section>
        ) : null}
        {children}
      </div>
    </details>
  );
}
