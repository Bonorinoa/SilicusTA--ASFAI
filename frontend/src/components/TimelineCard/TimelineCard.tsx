import type { TimelineEvent } from "../../gate/types";
import { StateIcon } from "../icons";
import styles from "./TimelineCard.module.css";

/**
 * TimelineCard — the audit trail (C): the append-only record of everything
 * that happened on this course, as one chronological spine.
 *
 * Each node comes from REAL gate records (checkpoint confirmations, teacher
 * decisions, sealed versions) — derived by the parent, rendered here. The card
 * is read-only: no verbs, no live regions, nothing to dispatch. Machine keys
 * (turn refs, ids) are demoted to a quiet mono line so the human story reads
 * first (A2: machine data never masquerades as prose).
 */
export interface TimelineCardProps {
  /** Events in chronological order (the parent sorts them, from `harness.timeline()`). */
  events: readonly TimelineEvent[];
  /** Small caps kicker. */
  courseLabel?: string;
}

const VERB_TO_STATUS = {
  accept: "accepted",
  rename: "renamed",
  drop: "dropped",
  add: "added",
} as const;

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

export function TimelineCard({ events, courseLabel }: TimelineCardProps) {
  return (
    <section className={styles.card} aria-label="Decision history">
      <header className={styles.header}>
        {courseLabel ? <p className={styles.eyebrow}>{courseLabel}</p> : null}
        <h2 className={styles.heading}>Decision history</h2>
        <p className={styles.subhead}>
          Everything recorded on this course — who decided, what changed, and when it was sealed.
          The ledger is append-only; nothing here is ever rewritten.
        </p>
      </header>

      {events.length === 0 ? (
        <p className={styles.empty}>Nothing recorded yet — decisions and seals will appear here.</p>
      ) : (
        <ol className={styles.spine}>
          {events.map((event) => (
            <EventNode key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EventNode({ event }: { event: TimelineEvent }) {
  const status = event.verb ? VERB_TO_STATUS[event.verb] : null;
  return (
    <li className={styles.event} data-kind={event.kind}>
      <span className={styles.marker} aria-hidden="true">
        {status ? (
          <StateIcon status={status} size={14} />
        ) : (
          <span className={styles.dot} data-kind={event.kind} />
        )}
      </span>

      <div className={styles.body}>
        <p className={styles.head}>
          <span className={styles.time}>
            {new Date(event.at).toLocaleString("en-GB", TIME_FORMAT)}
          </span>
          <span className={styles.label} data-kind={event.kind} data-verb={event.verb}>
            {event.label}
          </span>
        </p>

        {event.before ? (
          <p className={styles.before}>as proposed: “{event.before}”</p>
        ) : null}
        {event.detail && event.detail !== event.before ? (
          <p className={styles.detail}>{event.detail}</p>
        ) : null}

        {event.source ? <p className={styles.source}>{event.source}</p> : null}

        {/* Machine keys demoted below the story — present for audit, never headline. */}
        <p className={styles.meta}>
          {event.kind === "publish"
            ? `sealed as version ${event.version}`
            : event.version !== undefined
              ? `binds to version ${event.version}`
              : `checkpoint ${event.id.replace("checkpoint:", "")}`}
          {" · "}
          {event.decidedBy}
          {" · "}
          {event.channel}
          {" · turn "}
          <span className={styles.monoId}>{event.turnRef}</span>
        </p>
      </div>
    </li>
  );
}

export default TimelineCard;