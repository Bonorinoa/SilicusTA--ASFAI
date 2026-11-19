/**
 * RevisionNote — revising a PUBLISHED course, said plainly on every step (K5).
 *
 * Restores what only the classic RevisionPanel said (437f053:frontend/src/live/RevisionPanel.tsx): the sealed version
 * is unchanged, students keep reading it, what has changed since, which objectives are not in the plan yet, and
 * one way to draft a new plan when one is needed. It reads only the host's `view.revision`; it shows nothing when the
 * record does not differ from the sealed version, so a click that changed nothing never claims a draft.
 * No role="status": the studio's one status line (StepStatus) stays the only live region of that kind.
 */
import { BROWSER_MODE } from "../gate/mode";
import type { RevisionView } from "../gate/transport";
import { Button } from "./ui";
import s from "./Studio.module.css";

export function revisionLines(revision: RevisionView): string[] {
  const c = revision.changes;
  const lines: string[] = [];
  for (const o of c?.objectivesAdded ?? []) lines.push(`Added: “${o.statement}”`);
  for (const o of c?.objectivesRemoved ?? []) lines.push(`Revoked: “${o.statement}”`);
  for (const o of c?.objectivesReworded ?? []) lines.push(`Reworded: “${o.before}” became “${o.after}”`);
  if (c && c.plan !== "same") {
    lines.push(c.plan === "replaced" ? "A new lesson plan is confirmed."
      : c.planStatus === "invalidated" ? "The lesson plan is invalid: it cites an objective you revoked."
        : "A new lesson plan is drafted and waiting for your confirmation.");
  }
  for (const o of revision.notInPlan) lines.push(`Not in the lesson plan yet: “${o.statement}”`);
  return lines;
}

export function RevisionNote({ revision, workerConfigured, busy, onDraftPlan }: {
  revision: RevisionView; workerConfigured: boolean; busy: boolean; onDraftPlan: () => void;
}) {
  const sealed = revision.sealedVersion;
  if (sealed === null || !revision.drafting) return null;
  const next = revision.nextVersion;
  const planInvalidated = revision.changes?.planStatus === "invalidated";
  const needsPlan = planInvalidated || revision.notInPlan.length > 0;
  const lines = revisionLines(revision);
  return (
    <section className={s.card} aria-label="Revising this course" data-revision="true" style={{ gap: 10 }}>
      <h2 className={s.cardTitle} style={{ fontSize: "1.0625rem" }}>Version {sealed} is published and unchanged; you are drafting version {next}.</h2>
      <p className={s.trustText}>Students and the handout read version {sealed}, and keep reading it until you publish version {next}. A draft is never what students see.</p>
      {lines.length > 0 ? (
        <ul aria-label={`Changes since version ${sealed}`} style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      ) : null}
      {needsPlan ? (
        workerConfigured ? (
          <div className={s.rowActions}>
            <Button className={s.wrapButton} disabled={busy} onClick={onDraftPlan}>Draft a new lesson plan from your confirmed objectives</Button>
            <span className={s.trustText}>The AI drafts; you still read and confirm the plan yourself.</span>
          </div>
        ) : (
          <p className={s.trustText}>
            {BROWSER_MODE ? "AI drafting is not set up on this site, so a new lesson plan cannot be drafted here." : "No drafting worker is configured on this host, so a new lesson plan cannot be drafted here."}
            {planInvalidated ? ` Until one is, version ${next} cannot be published.` : null}
          </p>
        )
      ) : null}
    </section>
  );
}
