/** Publish: preview and publish (PublishCard keeps its two-step confirm), then the published moment and where it goes. */
import { useState } from "react";
import { PlanCard } from "../../components/PlanCard";
import { plural } from "../../lib/plural";
import { buildHandoutHtml, handoutFilename } from "../../live/handout";
import { reasonsFor } from "../../live/reasonText";
import { ActionBar } from "./ActionBar";
import type { StepProps } from "../CourseStudio";
import { href } from "../StudioApp";
import { Button, LinkButton, Soon } from "../ui";
import { download } from "../useCourse";
import s from "../Studio.module.css";

export function PublishStep({ c, view, onLook }: StepProps) {
  const plan = view.plan;
  const published = view.versions.at(-1) ?? null;
  const drafting = published !== null && (view.revision?.drafting === true || view.checkpoints.publish?.status === "pending");
  const id = view.course.courseId;
  // Publishing is two clicks: arm, then confirm, with "Keep editing" as the focused, safe choice.
  const [armed, setArmed] = useState(false);

  if (published && !drafting) {
    const handout = () => download(new Blob([buildHandoutHtml(published)], { type: "text/html" }), handoutFilename(published));
    return (
      <div className={s.doc}>
        <div className={s.docInner}>
          <section className={s.published} data-rise aria-label="Published">
            <p className={s.kicker} style={{ color: "#b9c4cf" }}>Step 4 of 4 · Published</p>
            <h1>Version {published.version} is published</h1>
            <p className={s.publishedMeta}>Published {new Date(published.publishedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} by {published.owner}. It can’t change; your next edits become version {published.version + 1}.</p>
            <div className={s.publishedActions}>
              <LinkButton variant="secondary" href={href.learn(id)}>Open the student space</LinkButton>
              <LinkButton variant="secondary" href={href.rehearse(id)}>Rehearse student questions</LinkButton>
            </div>
            <div className={s.soonRow} style={{ color: "#c9d2db" }}><Soon>Class code · soon</Soon><span>Students can’t reach this browser yet; the student space is a preview on this device.</span></div>
          </section>

          <section className={s.card} aria-label="Take it with you">
            <h2 className={s.cardTitle}>Take it with you</h2>
            <div className={s.rowActions}>
              <Button onClick={handout}>Download the student handout</Button>
              <Button onClick={() => void c.actions.exportVersion()} disabled={c.busy}>Export the published version</Button>
              <Button variant="quiet" onClick={() => onLook("plan")}>Read the plan</Button>
            </div>
          </section>

          <section className={s.card} aria-label="Make changes">
            <h2 className={s.cardTitle}>Make changes</h2>
            <p className={s.docLede} style={{ fontSize: "0.9375rem" }}>Edit, add or remove objectives, then re-draft or re-confirm the plan and publish version {published.version + 1}. Students keep seeing version {published.version} until then.</p>
            <div><Button onClick={() => onLook("objectives")}>Revise objectives</Button></div>
          </section>
        </div>
      </div>
    );
  }

  const next = (published?.version ?? 0) + 1;
  const reasons = reasonsFor(view.publish);
  const minutes = (plan?.activities ?? []).reduce((n, a) => n + a.minutes, 0);
  const changes = view.revision?.changes ?? null;
  const changeLines = changes ? [
    ...changes.objectivesAdded.map((o) => `Added: ${o.statement}`),
    ...changes.objectivesRemoved.map((o) => `Removed: ${o.statement}`),
    ...(changes.objectivesReworded ?? []).map((o) => `Reworded: “${o.before}” → “${o.after}”`),
    ...(changes.plan === "replaced" ? ["A new lesson plan"] : []),
  ] : [];

  return (
    <div className={s.doc}>
      <div className={s.docInner}>
        <header className={s.docHead}>
          <p className={s.kicker}>Step 4 of 4</p>
          <h1 className={s.docTitle}>{published ? `Publish version ${next}` : "Review and publish"}</h1>
          <p className={s.docLede}>This is exactly what students will get: the objectives and the plan you confirmed. A published version can’t change; later edits become version {next + 1}.</p>
        </header>

        {published && changeLines.length > 0 ? (
          <section className={s.card} aria-label="What changed">
            <h2 className={s.cardTitle}>Since version {published.version}</h2>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>{changeLines.map((l) => <li key={l}>{l}</li>)}</ul>
          </section>
        ) : null}

        {!view.publish.canPublish && reasons.length > 0 ? (
          <section className={s.card} aria-label="Before you can publish">
            <h2 className={s.cardTitle}>Before you can publish</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>
        ) : null}

        {plan ? (
          <PlanCard
            plan={plan}
            objectives={view.objectives}
            teacher={{ name: view.course.owner }}
            onPrint={() => window.print()}
            invalidation={view.invalidation}
            rewordedSince={view.planWording?.objectives}
            ids="record"
          />
        ) : null}

        {armed ? (
          <ActionBar text={<><strong>Publish version {next}?</strong> Students get it as it reads above, and it can’t be changed afterwards.</>}>
            <Button autoFocus onClick={() => setArmed(false)}>Keep editing</Button>
            <Button variant="primary" data-primary="true" disabled={c.busy || !view.publish.canPublish} onClick={() => { setArmed(false); void c.actions.publish(); }}>Publish version {next}</Button>
          </ActionBar>
        ) : (
          <ActionBar text={view.publish.canPublish
            ? <><strong>Ready.</strong> {plural(view.objectives.length, "objective")}, {plural(plan?.activities.length ?? 0, "activity", "activities")}, {minutes} min.</>
            : "Resolve the points above to publish."}>
            {view.planWording?.stale ? (
              <>
                <Button disabled={c.busy} onClick={() => void c.actions.draftPlan()}>Draft a new plan</Button>
                <Button disabled={c.busy} onClick={() => void c.actions.confirmPlan()}>Confirm the plan as it reads</Button>
              </>
            ) : null}
            <Button variant="primary" data-primary="true" disabled={c.busy || !view.publish.canPublish} onClick={() => setArmed(true)}>Publish version {next}…</Button>
          </ActionBar>
        )}
      </div>
    </div>
  );
}
