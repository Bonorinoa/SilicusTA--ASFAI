import type { LessonPlanView, ObjectiveCiteView, PlanInvalidationView } from "../../gate/types";
import { plural } from "../../lib/plural";
import styles from "./PlanCard.module.css";

/**
 * PlanCard — a confirmed `LessonPlanRecord` typeset as a printable, shareable
 * page. Teachers print these and hand them to colleagues, so the page is
 * treated as a piece of typesetting: serif display for titles and statements,
 * small-caps meta labels, generous measure, hairline rules. `@media print`
 * strips the chrome and sets a clean page.
 *
 * The contract's honesty line closes the page as a quiet footer: asking the
 * assistant a question is not evidence of learning.
 *
 * An invalidated plan (D) carries the reason on the page itself — WHICH cited
 * objective was dropped and where it was cited — so the teacher sees the WHO
 * and WHY next to the sheet they must re-confirm or replace.
 */
export interface PlanCardProps {
  /** The gate's own LessonPlanRecord (confirmed) — rendered, never re-decided. */
  plan: LessonPlanView;
  /** Confirmed objectives (the citation key), from the gate's confirmed set. */
  objectives: readonly ObjectiveCiteView[];
  /** Who confirmed the plan (parent-supplied provenance summary). */
  teacher?: { name: string; confirmedAt?: Date };
  /** Optional print hook for the workbench toolbar ("Print this plan"). */
  onPrint?: () => void;
  /** WHY the plan is invalidated (D), derived by the parent from gate state. */
  invalidation?: PlanInvalidationView | null;
  /**
   * Cited objectives the teacher reworded since this plan was drafted or confirmed (host-derived). The plan
   * stays valid (its cited ids did not change) but was written from the old wording, so the page says so.
   */
  rewordedSince?: readonly { id: string; before: string | null; after: string }[];
  /**
   * Show the worker's alignment suggestions. They are NOT part of a sealed package, so a surface
   * that previews "exactly what will be published" must pass false, or it would imply they are.
   */
  showAlignment?: boolean;
}

const EVIDENCE_VALUE: Record<LessonPlanView["activities"][number]["evidenceIfAny"], string> = {
  none: "none collected in this activity",
  observation: "teacher observation",
  "work-product": "learner work product",
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  closeMatch: "close match",
  relatedTo: "related to",
  exactMatch: "exact match",
};

const AUDIENCE_BAND_LABEL = "Ages";

/** What a teacher sees for a knowledge source. An unknown source falls back to its own id. */
const SOURCE_LABEL: Record<string, string> = {
  "asfai-graph": "ASFAI's skill map",
  "local-ontology": "your ontology file",
};

export function PlanCard({ plan, objectives, teacher, onPrint, invalidation, rewordedSince = [], showAlignment = true }: PlanCardProps) {
  const citedIds = plan.activities.flatMap((a) => a.objectiveIds);
  const cited = objectives.filter((o) => citedIds.includes(o.id));
  const citeNumber = new Map(cited.map((o, i) => [o.id, i + 1]));
  const totalMinutes = plan.activities.reduce((n, a) => n + a.minutes, 0);

  return (
    <article className={styles.page} aria-label={`Lesson plan: ${plan.title}`}>
      {invalidation?.invalidated && invalidation.gaps.length > 0 ? (
        <section className={styles.invalidated} aria-label="Why this plan was invalidated">
          <p className={styles.invalidatedTitle}>Why this plan is invalidated</p>
          {invalidation.gaps.map((gap) => (
            <p key={gap.id} className={styles.invalidatedLine}>
              “{gap.statement}” was dropped, but this plan still cites it — in{" "}
              {gap.citedIn.join(", ")}.
            </p>
          ))}
          <p className={styles.invalidatedNote}>
            A revoked objective cannot be confirmed again, so re-confirming this plan as it reads would not
            make it publishable while it cites one. Draft a new plan from your confirmed objectives. This one
            cannot be published until every cited objective is confirmed again.
          </p>
        </section>
      ) : null}
      {plan.status !== "invalidated" && rewordedSince.length > 0 ? (
        <section className={styles.reworded} aria-label="Objectives reworded since this plan was written">
          <p className={styles.rewordedTitle}>
            {rewordedSince.length === 1 ? "An objective was" : `${rewordedSince.length} objectives were`} reworded since this plan was{" "}
            {plan.status === "confirmed" ? "confirmed" : "drafted"}
          </p>
          {rewordedSince.map((r) => (
            <p key={r.id} className={styles.rewordedLine}>
              “{r.after}”
              {r.before ? <span className={styles.rewordedWas}>The plan was written from: “{r.before}”</span> : null}
            </p>
          ))}
          <p className={styles.rewordedNote}>
            The plan still cites {rewordedSince.length === 1 ? "it" : "them"}, so it stays valid. Its activities were written from the
            earlier wording: read them again, then confirm the plan as it reads or draft a new one.
          </p>
        </section>
      ) : null}
      <header className={styles.masthead}>
        <p className={styles.eyebrow}>Silicus · Lesson plan</p>
        <p className={styles.statusChip} data-status={plan.status}>
          {plan.status === "confirmed"
            ? `Confirmed${teacher ? ` by ${teacher.name}` : ""}`
            : plan.status === "invalidated"
              ? "Invalidated — needs re-confirmation"
              : "Draft"}
        </p>
      </header>

      <h1 className={styles.title}>{plan.title}</h1>

      <p className={styles.meta}>
        {plan.audience?.ageRangeStart !== undefined ? (
          <span>
            {AUDIENCE_BAND_LABEL} {plan.audience.ageRangeStart}
            {plan.audience.ageRangeEnd !== undefined ? `–${plan.audience.ageRangeEnd}` : "+"}
          </span>
        ) : null}
        <span className={styles.metaDot}> · </span>
        <span>{plural(totalMinutes, "minute")}</span>
        <span className={styles.metaDot}> · </span>
        <span>
          {plan.activities.length} {plan.activities.length === 1 ? "activity" : "activities"}
        </span>
        <span className={styles.metaDot}> · </span>
        <span>Course version {plan.courseVersion}</span>
      </p>

      <ol className={styles.activities}>
        {plan.activities.map((activity, index) => (
          <li key={activity.id} className={styles.activity}>
            <p className={styles.activityNumber} aria-hidden="true">
              {index + 1}
            </p>
            <div className={styles.activityBody}>
              <div className={styles.activityHead}>
                <h2 className={styles.activityTitle}>{activity.title}</h2>
                <p className={styles.minutes}>{activity.minutes} min</p>
              </div>

              <p className={styles.line}>
                <span className={styles.lineLabel}>Learners</span>
                <span className={styles.lineText}>{activity.learnerDoes}</span>
              </p>
              <p className={styles.line}>
                <span className={styles.lineLabel}>Teacher</span>
                <span className={styles.lineText}>{activity.teacherDoes}</span>
              </p>

              {/* Every label/value pair on the page uses the ONE gutter style,
                  including evidence and the not-evidence note. */}
              <p className={styles.line}>
                <span className={styles.lineLabel}>Evidence</span>
                <span className={styles.lineText}>
                  {EVIDENCE_VALUE[activity.evidenceIfAny]}
                  {activity.objectiveIds
                    .map((id) => citeNumber.get(id))
                    .filter((n): n is number => Boolean(n))
                    .map((n) => (
                      <a
                        key={n}
                        className={styles.cite}
                        href={`#obj-${n}`}
                        aria-label={`Objective ${n} in the objectives key`}
                      >
                        {n}
                      </a>
                    ))}
                </span>
              </p>

              {activity.notEvidence ? (
                <p className={styles.line}>
                  <span className={styles.lineLabel}>Not evidence</span>
                  <span className={styles.lineText}>{activity.notEvidence}</span>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <section className={styles.key} aria-label="Objectives referenced">
        <h2 className={styles.keyHeading}>Objectives referenced</h2>
        <ol className={styles.keyList}>
          {cited.map((objective, index) => (
            <li key={objective.id} id={`obj-${index + 1}`} className={styles.keyItem}>
              <span className={styles.keyNumber}>{index + 1}</span>
              <span className={styles.keyStatement}>
                {objective.statement}
                {objective.alignment ? (
                  <span className={styles.garnish}>
                    {" · aligns to "}
                    <span className={styles.garnishId}>{objective.alignment.publicId}</span>
                    {" ("}
                    {RELATIONSHIP_LABEL[objective.alignment.relationship] ??
                      objective.alignment.relationship}
                    {")"}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {showAlignment && plan.citations && plan.citations.length > 0 ? (
        <section className={styles.key} aria-label="Suggested alignment">
          <h2 className={styles.keyHeading}>Suggested alignment</h2>
          <p className={styles.alignmentNote}>
            References the drafting assistant suggested. They are not requirements, not objectives, and
            not part of the sealed package; you decide whether any of them fits.
          </p>
          <ul className={styles.keyList}>
            {plan.citations.map((c) => (
              <li key={c.ref} className={styles.keyItem}>
                <span className={styles.keyNumber} aria-hidden="true">·</span>
                <span className={styles.keyStatement}>
                  {c.label}
                  <span className={styles.garnish}>
                    {` · from ${SOURCE_LABEL[c.source] ?? c.source}`}
                    {c.verified ? ` · checked against ${SOURCE_LABEL[c.source] ?? c.source}` : " · not independently checked"}
                    {` · activit${c.activityIndexes.length === 1 ? "y" : "ies"} ${c.activityIndexes.map((i) => i + 1).join(", ")}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <p className={styles.honesty}>Asking the assistant a question is not evidence.</p>
        <p className={styles.colophon}>
          Silicus TA · plan <span className={styles.monoId}>{plan.id}</span>
          {plan.courseId ? (
            <>
              {" · course "}
              <span className={styles.monoId}>{plan.courseId}</span>
            </>
          ) : null}
          {teacher?.confirmedAt
            ? ` · confirmed ${teacher.confirmedAt.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}`
            : ""}
        </p>
        {onPrint ? (
          <p className={styles.printHint} data-print="hide">
            This page is set to print cleanly — use your browser’s print command.
          </p>
        ) : null}
      </footer>
    </article>
  );
}

export default PlanCard;
