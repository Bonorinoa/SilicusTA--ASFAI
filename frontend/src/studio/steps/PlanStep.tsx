/** Plan: draft from the confirmed objectives, read it, confirm it. The draft stays a draft until you do. */
import { PlanCard } from "../../components/PlanCard";
import { BROWSER_MODE } from "../../gate/mode";
import { plural } from "../../lib/plural";
import type { StepProps } from "../CourseStudio";
import { Button, Skeleton } from "../ui";
import { ActionBar } from "./ActionBar";
import { NeighbourhoodView, PrereqStrip, useNeighbourhood } from "../graph/SkillMap";
import { WaitLines } from "../../components/WaitLines/WaitLines";
import { PLAN_LATE, PLAN_SUB, planLines } from "../mapLines";
import s from "../Studio.module.css";

export function PlanStep({ c, view, worker, looking, onLook }: StepProps) {
  const plan = view.plan;
  const published = view.versions.at(-1) ?? null;
  const shownPlan = plan ?? (looking ? published?.lessonPlan ?? null : null);
  const drafting = c.waiting?.kind === "plan";
  const noWorker = worker?.configured === false;
  const { data: map } = useNeighbourhood(view.course.marbleAnchor);
  const { data: connected } = useNeighbourhood(view.course.marbleConnected);
  const minutes = shownPlan ? shownPlan.activities.reduce((n, a) => n + a.minutes, 0) : 0;
  // N3: the plan is the teacher's to edit in place (not while looking back, drafting, or on an invalidated plan).
  const editable = !looking && !drafting && !!plan && plan.status !== "invalidated" && shownPlan === plan;
  const planEdits = (view.timeline ?? []).filter((e) => e.kind === "plan-edit");

  let bar: React.ReactNode = null;
  if (looking) {
    bar = <ActionBar text={plan?.status === "confirmed" ? <><strong>Plan confirmed.</strong> Nothing here changes.</> : "A look at the plan."}><Button variant="primary" data-primary="true" onClick={() => onLook(null)}>Back to the current step</Button></ActionBar>;
  } else if (drafting) {
    // Drafting is spoken once, by the one status line; the skeleton card holds the place here.
    bar = null;
  } else if (!plan) {
    bar = (
      <ActionBar text={noWorker ? `AI drafting isn’t set up ${BROWSER_MODE ? "on this site" : "on this host"}, so the plan can’t be drafted here.` : "Silicus drafts activities that point to them; you confirm the plan."}>
        <Button onClick={() => onLook("objectives")}>Review objectives</Button>
        <Button variant="primary" data-primary="true" disabled={c.busy || noWorker} onClick={() => void c.actions.draftPlan()}>Draft the lesson plan</Button>
      </ActionBar>
    );
  } else if (plan.status === "invalidated") {
    bar = (
      <ActionBar text={<><strong>This plan cites an objective you removed,</strong> so it can’t be published as it is.</>}>
        <Button variant="primary" data-primary="true" disabled={c.busy || noWorker} onClick={() => void c.actions.draftPlan()}>Draft a new plan</Button>
      </ActionBar>
    );
  } else if (plan.status === "draft") {
    bar = (
      <ActionBar text={<><strong>Draft</strong> · {plural(plan.activities.length, "activity", "activities")}, {minutes} min{view.course.lessonMinutes !== undefined ? ` of a ${view.course.lessonMinutes} min lesson` : ""}. It’s a draft until you confirm it.</>}>
        <Button onClick={() => onLook("objectives")}>Edit objectives</Button>
        <Button disabled={c.busy || noWorker} onClick={() => void c.actions.draftPlan()}>Draft again</Button>
        <Button variant="primary" data-primary="true" disabled={c.busy} onClick={() => void c.actions.confirmPlan()}>Confirm the lesson plan</Button>
      </ActionBar>
    );
  }

  return (
    <div className={s.doc}>
      <div className={s.docInner}>
        <header className={s.docHead}>
          <p className={s.kicker}>Step 3 of 4</p>
          <h1 className={s.docTitle}>Lesson plan</h1>
          <p className={s.docLede}>Activities with minutes, each pointing to an objective you confirmed. One lesson per course for now.</p>
        </header>

        {map ? <PrereqStrip data={map} /> : null}

        {drafting ? (
          <section className={s.card} aria-busy="true" aria-label="Drafting the plan">
            {/* M1 (Q6): the plan wait lives here, on the course's plan page. Lines follow DECISIONS §5. */}
            <WaitLines live={false} label="Drafting the plan" every={4500} lateAfter={45000} late={PLAN_LATE} sub={PLAN_SUB}
              lines={planLines({
                anchor: map?.anchor.name ?? null, before: map?.prerequisites[0]?.name ?? null, connected: connected?.anchor.name ?? null,
                sources: [...c.sources.map((h) => h.name), ...(view.course.marbleAnchor ? ["the skill-map text"] : [])],
                minutes: view.course.lessonMinutes ?? null, ages: view.course.ages ?? null, stage: view.course.stage ?? null,
                objectives: view.objectives.length,
              })} />
            <Skeleton width="55%" height={26} />
            <Skeleton width="35%" height={10} />
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", gap: 14, paddingTop: 14, borderTop: "1px solid var(--fn-line-soft)" }}>
                <Skeleton width={22} height={22} radius={999} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <Skeleton width={`${50 + i * 8}%`} height={14} /><Skeleton width="85%" height={10} /><Skeleton width="70%" height={10} />
                </div>
                <Skeleton width={44} height={12} />
              </div>
            ))}
          </section>
        ) : shownPlan ? (
          <div data-rise>
            <PlanCard
              plan={shownPlan}
              lessonMinutes={view.course.lessonMinutes}
              courseAges={view.course.ages ?? null}
              objectives={view.objectives}
              teacher={{ name: view.course.owner, confirmedAt: shownPlan.status === "confirmed" && published ? new Date(published.publishedAt) : undefined }}
              onPrint={() => window.print()}
              invalidation={view.invalidation}
              rewordedSince={view.planWording?.objectives}
              ids="record"
              onEdit={editable && plan ? (edits, text) => c.actions.editPlan(plan.id, edits, text) : undefined}
              editBusy={c.busy}
              aiEditable={!!view.course.ages}
            />
          </div>
        ) : (
          <section className={s.card} aria-label="Confirmed objectives">
            <h2 className={s.cardTitle}>The plan will cite these</h2>
            <ol className={s.objList}>
              {view.objectives.map((o, i) => <li key={o.id} className={s.checkRow}><span className={s.check} aria-hidden="true">{i + 1}</span><span className={s.statement}>{o.statement}</span></li>)}
            </ol>
          </section>
        )}
        {planEdits.length > 0 && !drafting ? (
          <section className={s.card} aria-label="Your edits to the plan" data-plan-edits>
            <h2 className={s.cardTitle}>Your edits</h2>
            <ul className={s.editTrace}>
              {planEdits.map((e) => (
                <li key={e.id} data-plan-edit-line>
                  {e.label}
                  {e.detail ? <span className={s.editTraceNow}> · now “{e.detail}”</span> : null}
                </li>
              ))}
            </ul>
            <p className={s.provenance}>Silicus drafted the plan. Each change you saved is on the course record; a published version never changes.</p>
          </section>
        ) : null}
        {map ? <NeighbourhoodView data={map} /> : null}
        {bar}
      </div>
    </div>
  );
}
