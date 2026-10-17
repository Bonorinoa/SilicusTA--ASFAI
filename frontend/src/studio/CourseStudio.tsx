/** The course studio: sources on the left, the lesson in the middle, proposals on the right, one action bar. */
import { useEffect, useState } from "react";
import { ActivityRail } from "../components/ActivityRail";
import { materialNamesOf } from "../components/AiWaiting";
import { BROWSER_MODE } from "../gate/mode";
import { host } from "../gate/transport";
import { plural } from "../lib/plural";
import { SourcesPanel } from "./SourcesPanel";
import { TopBar, href } from "./StudioApp";
import { BriefStep } from "./steps/BriefStep";
import { ObjectivesStep } from "./steps/ObjectivesStep";
import { PlanStep } from "./steps/PlanStep";
import { PublishStep } from "./steps/PublishStep";
import { Button, Dialog, Notice, Skeleton } from "./ui";
import { STEP_LIST, currentStep, stepDone, useCourse, useWorker, type StepId } from "./useCourse";
import s from "./Studio.module.css";

export function CourseStudio({ courseId }: { courseId: string }) {
  const c = useCourse(courseId);
  const worker = useWorker();
  const [looking, setLooking] = useState<StepId | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [links, setLinks] = useState<string[]>([]);
  const [verified, setVerified] = useState<string | null>(null);
  const { view } = c;

  // When the work moves to a new step, stop looking at an old one.
  const step = view ? currentStep(view) : null;
  useEffect(() => { setLooking(null); }, [step]);

  if (c.missing) {
    return (
      <>
        <TopBar crumbs={[{ label: "Courses", href: href.home }]} />
        <main className={s.page}><div className={s.empty}><h1>Course not found</h1><p className={s.lede}>It isn’t in this browser. It may have been deleted, or made in another browser.</p><a href={href.home}>Back to your courses</a></div></main>
      </>
    );
  }

  if (!view || !step) {
    return (
      <>
        <TopBar crumbs={[{ label: "Courses", href: href.home }, { label: "Loading…" }]} />
        <div className={s.studioBody} aria-busy="true">
          <aside className={s.sources}><Skeleton width="50%" height={10} /><Skeleton height={36} /><Skeleton height={36} /></aside>
          <div className={s.doc}><div className={s.docInner}><Skeleton width="45%" height={32} /><Skeleton width="80%" /><Skeleton height={88} /><Skeleton height={88} /></div></div>
        </div>
      </>
    );
  }

  const shown: StepId = looking ?? step;
  const stepIndex = STEP_LIST.findIndex((x) => x.id === step);
  const decisions = (view.activity ?? []).filter((a) => a.actor === "teacher").length;
  const published = view.versions.at(-1) ?? null;
  const names = materialNamesOf(view.course.materials);

  const verify = async () => {
    try { const r = await host.verify(courseId); setVerified(r.ok ? `The record checks out: ${plural(r.events, "event")}, chain intact.` : "The record does not check out."); }
    catch (e) { setVerified(e instanceof Error ? e.message : String(e)); }
  };

  const stepper = (
    <nav className={s.stepper} aria-label="Steps">
      {STEP_LIST.map((x, i) => {
        const done = stepDone(view, x.id);
        const reachable = i <= stepIndex || done;
        return (
          <button
            key={x.id}
            type="button"
            className={s.step}
            aria-current={x.id === shown ? "step" : undefined}
            data-done={done ? "true" : undefined}
            disabled={!reachable}
            onClick={() => setLooking(x.id === step ? null : x.id)}
          >
            <span className={s.stepNum}>{done ? "✓" : i + 1}</span> {x.label}
          </button>
        );
      })}
    </nav>
  );

  const common = { c, worker, view, looking: looking !== null && looking !== step, onLook: setLooking };

  return (
    <>
      <TopBar
        crumbs={[{ label: "Courses", href: href.home }, { label: view.course.title }]}
        center={stepper}
        right={(
          <>
            <button type="button" className={s.pill} onClick={() => setHistoryOpen(true)}>
              <span className={s.pillDot} aria-hidden="true" />{plural(decisions, "decision")} recorded
            </button>
            {published ? <Button size="small" onClick={() => { window.location.hash = href.rehearse(courseId); }}>Rehearse</Button> : null}
          </>
        )}
      />
      <div className={s.studioBody}>
        <SourcesPanel
          names={names}
          held={c.sources}
          links={links}
          onHeld={c.setSources}
          onLinks={setLinks}
          confirmed={view.checkpoints.files?.status === "confirmed"}
        />
        <div className={s.work}>
          {c.notice ? <div style={{ flexBasis: "100%", padding: "16px 48px 0" }}><Notice onClose={() => c.setNotice(null)}>{c.notice}</Notice></div> : null}
          {shown === "brief" ? <BriefStep {...common} /> : null}
          {shown === "objectives" ? <ObjectivesStep {...common} links={links} /> : null}
          {shown === "plan" ? <PlanStep {...common} /> : null}
          {shown === "publish" ? <PublishStep {...common} /> : null}
        </div>
      </div>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} label="History" drawer>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, height: "100%", boxSizing: "border-box", overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1.5rem" }}>History</h2>
            <Button variant="quiet" size="small" onClick={() => setHistoryOpen(false)}>Close</Button>
          </div>
          <p className={s.trustText}>Every decision is recorded with who made it. {BROWSER_MODE ? "The record lives in this browser." : "The record lives on this computer."}</p>
          <ActivityRail items={view.activity ?? []} now={c.waiting ? { actor: "worker", label: "Drafting", startedAt: c.waiting.startedAt } : null} worker={worker} asfaiAvailable={!BROWSER_MODE} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
            <Button size="small" onClick={() => void verify()}>Check the record</Button>
            {verified ? <p className={s.trustText} role="status">{verified}</p> : null}
          </div>
        </div>
      </Dialog>
    </>
  );
}

export type StepProps = {
  c: ReturnType<typeof useCourse>;
  worker: ReturnType<typeof useWorker>;
  view: NonNullable<ReturnType<typeof useCourse>["view"]>;
  /** The teacher is looking back at a finished step rather than working in the current one. */
  looking: boolean;
  onLook: (id: StepId | null) => void;
};
