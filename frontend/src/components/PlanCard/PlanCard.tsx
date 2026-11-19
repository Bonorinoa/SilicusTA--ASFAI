import type { LessonPlanView, ObjectiveCiteView, PlanInvalidationView } from "../../gate/types";
import { Fragment, useRef, useState } from "react";
import { EditButton, EditForm, type EditField, type PlanEdit } from "./PlanEdit";
import { plural } from "../../lib/plural";
import styles from "./PlanCard.module.css";
import { MarbleCredit } from "../MarbleCredit/MarbleCredit";
import {
  AI_STATUS_LABEL, CHANNEL_LABEL, PHASE_LABEL, REVIEW_FORM_LABEL,
  adjustedNotes, aiPolicyPlain, reviewOffset, sessionEvidenceLine, showActivityAiTags,
} from "./design";

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
  /** K2: the lesson length the teacher set on the course (minutes). Absent on courses created without one. */
  lessonMinutes?: number;
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
   * Show the worker's alignment suggestions. They are NOT part of a published version, so a surface
   * that previews "exactly what will be published" must pass false, or it would imply they are.
   */
  showAlignment?: boolean;
  /**
   * Where the machine's ids and the print note live. "inline" (default): in the sheet's footer, as before.
   * "record": the course page keeps them in Record details; the sheet still PRINTS its footer (the urn is the
   * printed page's own signature) but shows the date only on screen, and the print note is not drawn.
   */
  ids?: "inline" | "record";
  /**
   * N3: the teacher edits the plan in place. When given, each activity and plan section shows an Edit button
   * (screen only). Resolves true when the host recorded the edit. Absent: the page is read-only, as before.
   */
  onEdit?: (edits: PlanEdit[], text: string) => Promise<boolean>;
  /** N3: Save is disabled while another act runs. */
  editBusy?: boolean;
  /** N3: the course has ages, so its activities carry an AI status the teacher may set. */
  aiEditable?: boolean;
}

/** N3: "Teacher override: AI permitted for ages 4–10 (the rule says forbidden)". */
const OVERRIDE_WORD: Record<string, string> = { forbidden: "forbidden", permitted: "permitted", required: "required" };
export function overrideLine(o: NonNullable<LessonPlanView["activities"][number]["teacherOverride"]>): string {
  const ages = o.ages ? ` for ages ${o.ages.min}–${o.ages.max}` : "";
  return `Teacher override: AI ${OVERRIDE_WORD[o.aiStatus]}${ages} (the rule says ${OVERRIDE_WORD[o.rule]})`;
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
  "marble": "Marble's skill taxonomy",
};

export function PlanCard({ plan, lessonMinutes, objectives, teacher, onPrint, invalidation, rewordedSince = [], showAlignment = true, ids = "inline", onEdit, editBusy = false, aiEditable = false }: PlanCardProps) {
  // N3: which part is open for editing ("plan", "a:<activity id>", "r:<review index>"); one at a time.
  const [editing, setEditing] = useState<string | null>(null);
  // N5 (C5): the activity whose removal waits for a second click ("Remove activity 2?").
  const [removing, setRemoving] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const canEdit = !!onEdit && plan.status !== "invalidated";
  const closeEdit = (key: string) => {
    setEditing(null);
    queueMicrotask(() => editButtons.current.get(key)?.focus());
  };
  const save = (key: string, what: string) => async (edits: PlanEdit[], labels: string[]) => {
    if (!onEdit) return false;
    const ok = await onEdit(edits, `Edit ${what}: ${labels.join(", ")}.`);
    if (ok) closeEdit(key);
    return ok;
  };
  const editButton = (key: string, what: string) => canEdit && editing !== key ? (
    <EditButton what={what} disabled={editing !== null} onClick={() => setEditing(key)}
      buttonRef={(el) => { editButtons.current.set(key, el); }} />
  ) : null;
  // N5 (C5): the objectives an activity may cite: the confirmed ones, numbered as the objectives step numbers them.
  const objectiveOptions = objectives.map((o, i) => ({ id: o.id, label: `Objective ${i + 1}`, title: o.statement }));
  const shape = (edit: PlanEdit, text: string) => async () => {
    if (!onEdit) return;
    setRemoving(null);
    await onEdit([edit], text);
  };
  const shapeFree = canEdit && editing === null && !editBusy;
  const citedIds = plan.activities.flatMap((a) => a.objectiveIds);
  const cited = objectives.filter((o) => citedIds.includes(o.id));
  const citeNumber = new Map(cited.map((o, i) => [o.id, i + 1]));
  const totalMinutes = plan.activities.reduce((n, a) => n + a.minutes, 0);
  // Plan schema v2 (learning design). Every piece is optional; a v1 plan draws none of it.
  const policy = aiPolicyPlain(plan.aiPolicy);
  const aiTags = showActivityAiTags(plan);
  const evidenceLine = sessionEvidenceLine(plan.sessions);
  const reviews = plan.spacedReviews ?? [];
  const adjusted = adjustedNotes(plan.notes);

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
              : plan.editedByTeacher ? "Draft · edited by you" : "Draft"}
        </p>
      </header>

      {canEdit ? (
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{plan.title}</h1>
          {editButton("plan", "the plan title")}
        </div>
      ) : (
        <h1 className={styles.title}>{plan.title}</h1>
      )}
      {editing === "plan" ? (
        <EditForm what="the plan title" disabled={editBusy} onCancel={() => closeEdit("plan")} onSave={save("plan", "the plan")}
          fields={[
            { path: "title", label: "Plan title", kind: "text", value: plan.title, max: 160, required: true },
            ...(plan.sessions?.[0]?.evidence ? [{ path: "sessions.0.evidence.whatLearnerProduces", label: "Evidence for this session", kind: "long" as const, value: plan.sessions[0].evidence.whatLearnerProduces, max: 400, required: true }] : []),
          ]} />
      ) : null}

      <p className={styles.meta}>
        {plan.audience?.ageRangeStart !== undefined ? (
          <span>
            {AUDIENCE_BAND_LABEL} {plan.audience.ageRangeStart}
            {plan.audience.ageRangeEnd !== undefined ? `–${plan.audience.ageRangeEnd}` : "+"}
          </span>
        ) : null}
        <span className={styles.metaDot}> · </span>
        {lessonMinutes !== undefined
          ? <span data-lesson-length>{lessonMinutes} min lesson · activities {totalMinutes} min</span>
          : <span>{plural(totalMinutes, "minute")}</span>}
        <span className={styles.metaDot}> · </span>
        <span>
          {plan.activities.length} {plan.activities.length === 1 ? "activity" : "activities"}
        </span>
        <span className={styles.metaDot}> · </span>
        <span>Course version {plan.courseVersion}</span>
      </p>

      {evidenceLine ? (
        <p className={styles.sessionEvidence} data-session-evidence>
          <span className={styles.designLabel}>Evidence for this session</span>{" "}
          <span className={styles.designText}>{evidenceLine}</span>
        </p>
      ) : null}
      {policy ? (
        <p className={styles.aiPolicy} data-ai-policy>
          <span className={styles.designLabel}>AI</span>{" "}
          <span className={styles.designText}>{policy}</span>
        </p>
      ) : null}
      {adjusted.shown.length > 0 ? (
        <section className={styles.adjusted} aria-label="Silicus adjusted" data-adjusted>
          <p className={styles.designLabel}>Silicus adjusted</p>
          <ul className={styles.adjustedList}>
            {adjusted.shown.map((n, i) => <li key={i}>{n}</li>)}
            {adjusted.more > 0 ? <li>and {plural(adjusted.more, "more change")}.</li> : null}
          </ul>
        </section>
      ) : null}

      <ol className={styles.activities}>
        {plan.activities.map((activity, index) => {
          const citedInActivity = activity.objectiveIds.filter((id) => citeNumber.has(id));
          return (
          <li key={activity.id} className={styles.activity}>
            <p className={styles.activityNumber} aria-hidden="true">
              {index + 1}
            </p>
            <div className={styles.activityBody}>
              <div className={styles.activityHead}>
                <h2 className={styles.activityTitle}>{activity.title}</h2>
                <p className={styles.minutes}>{activity.minutes} min</p>
                {editButton(`a:${activity.id}`, `activity ${index + 1}`)}
              </div>
              {editing === `a:${activity.id}` ? (
                <EditForm what={`activity ${index + 1}`} disabled={editBusy}
                  onCancel={() => closeEdit(`a:${activity.id}`)} onSave={save(`a:${activity.id}`, `activity ${index + 1}`)}
                  fields={activityFields(activity, index, aiEditable, objectiveOptions)} />
              ) : null}
              {canEdit && editing === null ? (
                <div className={styles.shapeRow} data-plan-shape={index + 1}>
                  {removing === activity.id ? (
                    <>
                      <span className={styles.editLabel}>Remove activity {index + 1}?</span>
                      <button type="button" className={styles.editButton} disabled={!shapeFree}
                        onClick={shape({ path: `activities.${index}.remove`, value: true }, `Remove activity ${index + 1}.`)}>Remove</button>
                      <button type="button" className={styles.editButton} onClick={() => setRemoving(null)}>Keep</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={styles.editButton} disabled={!shapeFree || index === 0} aria-label={`Move activity ${index + 1} up`}
                        onClick={shape({ path: `activities.${index}.moveTo`, value: index - 1 }, `Move activity ${index + 1} up.`)}>Move up</button>
                      <button type="button" className={styles.editButton} disabled={!shapeFree || index === plan.activities.length - 1} aria-label={`Move activity ${index + 1} down`}
                        onClick={shape({ path: `activities.${index}.moveTo`, value: index + 1 }, `Move activity ${index + 1} down.`)}>Move down</button>
                      <button type="button" className={styles.editButton} disabled={!shapeFree || plan.activities.length === 1} aria-label={`Remove activity ${index + 1}`}
                        onClick={() => setRemoving(activity.id)}>Remove</button>
                    </>
                  )}
                </div>
              ) : null}
              {activity.teacherOverride ? (
                <p className={styles.override} data-teacher-override>{overrideLine(activity.teacherOverride)}</p>
              ) : null}
              {(() => {
                const phase = activity.phase ? PHASE_LABEL[activity.phase] : null;
                const support = activity.supportingPhase && activity.supportingPhase !== activity.phase ? PHASE_LABEL[activity.supportingPhase] : null;
                const channels = (activity.channels ?? []).map((c) => CHANNEL_LABEL[c]).filter(Boolean);
                const ai = aiTags && activity.aiStatus ? activity.aiStatus : null;
                if (!phase && channels.length === 0 && !ai) return null;
                const tip = `plan-${plan.id}-${activity.id}-noai`;
                return (
                  <p className={styles.designRow} data-design-row>
                    {phase ? (
                      <span className={styles.phase} data-phase={activity.phase}>
                        <span className={styles.phaseNumber}>{activity.phase}</span> {phase}
                        {support ? <span className={styles.phaseSupport}> · also {activity.supportingPhase} {support}</span> : null}
                      </span>
                    ) : null}
                    {channels.length > 0 ? (
                      <span className={styles.channels} data-channels>
                        {channels.join(" · ")}
                      </span>
                    ) : null}
                    {ai ? (
                      <span
                        className={styles.aiTag}
                        data-ai-status={ai}
                        tabIndex={activity.noAiAlternative ? 0 : undefined}
                        aria-describedby={activity.noAiAlternative ? tip : undefined}
                      >
                        {AI_STATUS_LABEL[ai]}
                        {activity.noAiAlternative ? (
                          <span id={tip} role="tooltip" className={styles.chipTip}>
                            Without AI: {activity.noAiAlternative}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </p>
                );
              })()}

              {activity.clamped ? (
                <p className={styles.clamped} data-clamped>
                  AI removed by Silicus: reword this step
                </p>
              ) : null}

              {activity.learnerFirst ? (
                <p className={styles.designLine} data-learner-first>
                  <span className={styles.designLabel}>Learners first:</span>{" "}
                  <span className={styles.designText}>{activity.learnerFirst}</span>
                </p>
              ) : null}
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
                </span>
              </p>
              {citedInActivity.length > 0 ? (
                <p className={styles.line}>
                  <span className={styles.lineLabel}>Objectives</span>
                  <span className={styles.lineText}>
                    {citedInActivity.map((id, i) => {
                      const n = citeNumber.get(id)!;
                      const statement = cited.find((o) => o.id === id)?.statement;
                      const tip = `plan-${plan.id}-${activity.id}-obj-${n}`;
                      return (
                        <Fragment key={id}>
                          {i > 0 ? <span className={styles.chipSep}> · </span> : null}
                          <span
                            className={styles.chip}
                            tabIndex={0}
                            role={statement ? "img" : undefined}
                            aria-label={statement ? `Obj ${n} ${statement}` : undefined}
                            aria-describedby={statement ? tip : undefined}
                          >
                            {`Obj ${n}`}
                            {statement ? (
                              <span id={tip} role="tooltip" className={styles.chipTip}>
                                {statement}
                              </span>
                            ) : null}
                          </span>
                        </Fragment>
                      );
                    })}
                    {citedInActivity.map((id) => {
                      const statement = cited.find((o) => o.id === id)?.statement;
                      return statement ? (
                        <span key={id} className={styles.chipStatement}>{statement}</span>
                      ) : null;
                    })}
                  </span>
                </p>
              ) : null}

              {activity.decisionAfterHelp ? (
                <p className={styles.designLine} data-then-decide>
                  <span className={styles.designLabel}>Then they decide:</span>{" "}
                  <span className={styles.designText}>{activity.decisionAfterHelp}</span>
                </p>
              ) : null}
              {aiTags && activity.aiStatus && activity.aiStatus !== "forbidden" && activity.noAiAlternative ? (
                <p className={`${styles.designLine} ${styles.printOnlyBlock}`} data-no-ai-print>
                  <span className={styles.designLabel}>Without AI:</span>{" "}
                  <span className={styles.designText}>{activity.noAiAlternative}</span>
                </p>
              ) : null}

              {activity.notEvidence ? (
                <p className={styles.line}>
                  <span className={styles.lineLabel}>Not evidence</span>
                  <span className={styles.lineText}>{activity.notEvidence}</span>
                </p>
              ) : null}
            </div>
          </li>
          );
        })}
      </ol>
      {canEdit && objectiveOptions.length > 0 ? (
        <div className={styles.addActivity} data-plan-add>
          {editing === "add" ? (
            <EditForm what="a new activity" whole saveLabel="Add activity" disabled={editBusy} onCancel={() => closeEdit("add")}
              onSave={async (edits) => {
                const value: Record<string, unknown> = {};
                for (const e of edits) if (e.value !== null && e.value !== "") value[e.path.slice("new.".length)] = e.value;
                return save("add", "the plan")([{ path: "activities.add", value }], [`add activity ${plan.activities.length + 1}`]);
              }}
              fields={newActivityFields(objectiveOptions)} />
          ) : editing === null ? (
            <button type="button" className={styles.editButton} data-print="hide" disabled={editBusy}
              ref={(el) => { editButtons.current.set("add", el); }} onClick={() => setEditing("add")}>Add an activity</button>
          ) : null}
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <section className={styles.key} aria-label="Later" data-later>
          <h2 className={styles.keyHeading}>Later</h2>
          <ol className={styles.laterList}>
            {reviews.map((r, i) => (
              <li key={i} className={styles.laterItem}>
                <span className={styles.laterWhen}>{reviewOffset(r.afterDays)}</span>
                <span className={styles.laterBody}>
                  {r.form ? <span className={styles.laterForm}>{REVIEW_FORM_LABEL[r.form]}. </span> : null}
                  <span className={styles.laterChange}>What changes: {r.whatChanges}</span>
                  <span className={styles.laterPrompt}>“{r.prompt}”</span>
                </span>
                {editButton(`r:${i}`, `later review ${i + 1}`)}
                {editing === `r:${i}` ? (
                  <EditForm what={`later review ${i + 1}`} disabled={editBusy} onCancel={() => closeEdit(`r:${i}`)} onSave={save(`r:${i}`, `later review ${i + 1}`)}
                    fields={[
                      { path: `spacedReviews.${i}.afterDays`, label: "After (days)", kind: "days", value: r.afterDays },
                      ...(r.form ? [{ path: `spacedReviews.${i}.form`, label: "Form", kind: "reviewForm" as const, value: r.form }] : []),
                      { path: `spacedReviews.${i}.whatChanges`, label: "What changes", kind: "long", value: r.whatChanges, max: 300, required: true },
                      { path: `spacedReviews.${i}.prompt`, label: "Prompt", kind: "long", value: r.prompt, max: 400, required: true },
                    ]} />
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
        <section className={styles.key} aria-label="Suggested alignment" data-print="hide">
          {/* Collapsed by default: a long list of references the plan does not depend on. */}
          <details className={styles.alignment}>
            <summary className={styles.alignmentSummary}>
              <span className={styles.keyHeading}>Suggested alignment</span>
              <span className={styles.alignmentCount}>{plural(plan.citations.length, "reference")}</span>
            </summary>
            <p className={styles.alignmentNote}>
              References the drafting assistant suggested. They are not requirements, not objectives, and
              not part of the published version; you decide whether any of them fits.
            </p>
            <ul className={styles.keyList}>
              {plan.citations.map((c) => (
                <li key={c.ref} className={styles.keyItem}>
                  <span className={styles.keyNumber} aria-hidden="true">·</span>
                  <span className={styles.keyStatement}>
                    {c.label || c.ref}
                    <span className={styles.garnish}>
                      {` · from ${SOURCE_LABEL[c.source] ?? c.source}`}
                      {c.verified ? ` · checked against ${SOURCE_LABEL[c.source] ?? c.source}` : " · not independently checked"}
                      {` · activit${c.activityIndexes.length === 1 ? "y" : "ies"} ${c.activityIndexes.map((i) => i + 1).join(", ")}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {plan.citations.some((c) => c.source === "marble") ? <MarbleCredit className={styles.alignmentCredit} /> : null}
          </details>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <p className={styles.honesty}>Asking the assistant a question is not evidence.</p>
        <p className={styles.colophon}>
          <span className={ids === "record" ? styles.printOnly : undefined}>
            Silicus TA · plan <span className={styles.monoId}>{plan.id}</span>
            {plan.courseId ? (
              <>
                {" · course "}
                <span className={styles.monoId}>{plan.courseId}</span>
              </>
            ) : null}
          </span>
          {teacher?.confirmedAt
            ? `${ids === "record" ? "" : " · "}confirmed ${teacher.confirmedAt.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}`
            : ""}
        </p>
        {onPrint && ids === "inline" ? (
          <p className={styles.printHint} data-print="hide">
            This page is set to print cleanly — use your browser’s print command.
          </p>
        ) : null}
      </footer>
    </article>
  );
}

/** N3: the fields of one activity the teacher may edit, in the order the page reads them. */
/** N5 (C5): the fields of a teacher's new activity; the host bounds each like an edit of that field. */
function newActivityFields(options: EditField["options"]): EditField[] {
  return [
    { path: "new.title", label: "Title", kind: "text", value: "", max: 120, required: true },
    { path: "new.minutes", label: "Minutes", kind: "minutes", value: 10 },
    { path: "new.learnerDoes", label: "Learners", kind: "long", value: "", max: 600, required: true },
    { path: "new.teacherDoes", label: "Teacher", kind: "long", value: "", max: 600, required: true },
    { path: "new.evidenceIfAny", label: "Evidence", kind: "evidence", value: "none" },
    { path: "new.objectiveIds", label: "Cites", kind: "objectives", value: options?.[0] ? [options[0].id] : [], options },
  ];
}

function activityFields(a: LessonPlanView["activities"][number], index: number, aiEditable: boolean, options: EditField["options"] = []): EditField[] {
  const p = (f: string) => `activities.${index}.${f}`;
  return [
    { path: p("title"), label: "Title", kind: "text", value: a.title, max: 120, required: true },
    { path: p("minutes"), label: "Minutes", kind: "minutes", value: a.minutes },
    { path: p("phase"), label: "Phase", kind: "phase", value: a.phase ?? null },
    { path: p("learnerFirst"), label: "Learners first", kind: "long", value: a.learnerFirst ?? null, max: 300 },
    { path: p("learnerDoes"), label: "Learners", kind: "long", value: a.learnerDoes, max: 600, required: true },
    { path: p("teacherDoes"), label: "Teacher", kind: "long", value: a.teacherDoes, max: 600, required: true },
    { path: p("decisionAfterHelp"), label: "Then they decide", kind: "long", value: a.decisionAfterHelp ?? null, max: 300 },
    ...(aiEditable ? [
      { path: p("aiStatus"), label: "AI status", kind: "aiStatus" as const, value: a.aiStatus ?? null,
        hint: "Your choice stands. If it goes against the age rule, the plan says so." },
      { path: p("noAiAlternative"), label: "Without AI", kind: "long" as const, value: a.noAiAlternative ?? null, max: 300 },
    ] : []),
    { path: p("evidenceIfAny"), label: "Evidence", kind: "evidence", value: a.evidenceIfAny },
    ...(options && options.length > 0 ? [{ path: p("objectiveIds"), label: "Cites", kind: "objectives" as const, value: a.objectiveIds, options }] : []),
    { path: p("notEvidence"), label: "Not evidence", kind: "long", value: a.notEvidence ?? null, max: 300 },
  ];
}

export default PlanCard;
