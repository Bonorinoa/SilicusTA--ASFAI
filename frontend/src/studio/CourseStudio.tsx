/** The course studio: sources on the left, the lesson in the middle, proposals on the right, one action bar. */
import { useEffect, useRef, useState } from "react";
import { ActivityRail } from "../components/ActivityRail";
import { materialNamesOf } from "../components/AiWaiting";
import { BROWSER_MODE } from "../gate/mode";
import { host } from "../gate/transport";
import { plural } from "../lib/plural";
import type { ActivityItem } from "../gate/types";
import { AiCheck } from "./AiCheck";
import { useAiStatus } from "./aiStatus";
import { keepLinksForCourse, linksFor, takeProposeOnArrival } from "./links";
import { SourcesPanel } from "./SourcesPanel";
import { StepStatus } from "./StepStatus";
import { TopBar, href } from "./StudioApp";
import { BriefStep } from "./steps/BriefStep";
import { ObjectivesStep } from "./steps/ObjectivesStep";
import { PlanStep } from "./steps/PlanStep";
import { PublishStep } from "./steps/PublishStep";
import { Button, Dialog, Notice, Skeleton, ui } from "./ui";
import { STEP_LIST, currentStep, stepDone, stepTransition, turnPhrase, useCourse, useWorker, type StepId } from "./useCourse";
import s from "./Studio.module.css";

/**
 * The decisions pill counts a teacher DECISION, never bookkeeping. Confirming a checkpoint, confirming
 * the plan, deciding objectives or publishing are real choices on the record; saving answers
 * (intake.answered) records the teacher's own words, and creating the course opens the record — neither
 * is a decision. One decide act can carry several verbs, so its row counts facts.decisions.
 */
const DECISION_ACTIONS = new Set(["checkpoint.confirmed", "objectives.decided", "plan.confirmed", "package.sealed"]);

export function decisionCount(activity: readonly ActivityItem[]): number {
  let n = 0;
  for (const a of activity ?? []) {
    if (a.actor !== "teacher" || !DECISION_ACTIONS.has(a.action)) continue;
    n += a.action === "objectives.decided" ? Number(a.facts?.decisions ?? 0) : 1;
  }
  return n;
}

export function decisionPillLabel(count: number): string {
  return count > 0 ? `${plural(count, "decision")} recorded` : "No decisions yet";
}

export function CourseStudio({ courseId }: { courseId: string }) {
  const c = useCourse(courseId);
  const worker = useWorker();
  const [looking, setLooking] = useState<StepId | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // F5: the same diagnosis as the wizard's AI check, one click from every step.
  const ai = useAiStatus();
  const [aiOpen, setAiOpen] = useState(false);
  // Web pages live in the tab like file text (links.ts), so the wizard can hand its pages over.
  const [links, setLinksState] = useState<string[]>(() => linksFor(courseId));
  const setLinks = (next: string[]) => { keepLinksForCourse(courseId, next); setLinksState(next); };
  const [verified, setVerified] = useState<string | null>(null);
  // B4: one spoken sentence about the last step transition, shown until the next work begins.
  const [transition, setTransition] = useState<string | null>(null);
  const { view } = c;

  // When the work moves to a new step, stop looking at an old one.
  const step = view ? currentStep(view) : null;
  const phrase = view ? turnPhrase(view) : null;
  useEffect(() => { setLooking(null); }, [step]);

  // B4: the jump (objectives confirmed, brief confirmed, plan confirmed) is announced once through the
  // one status line, and focus lands on the new step's heading for keyboard and screen-reader users.
  // The sentence stays only for the ONE step change it describes: any act that sets busy, any waiting
  // state, or a later change of the turn phrase (a move that is not the step change itself) clears it,
  // so an atomic live region never re-speaks a stale sentence.
  const stepRef = useRef<StepId | null>(null);
  const phraseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!step) return;
    const prevStep = stepRef.current;
    const prevPhrase = phraseRef.current;
    stepRef.current = step;
    phraseRef.current = phrase;
    if (prevStep === null) return; // the first view is not a move
    if (prevStep !== step) {
      setTransition(stepTransition(prevStep, step));
      const heading = document.querySelector<HTMLElement>("h1");
      if (heading) { heading.tabIndex = -1; heading.focus(); }
      return;
    }
    // Same step: a later change of the turn phrase means the teacher did something next; the one-time
    // transition sentence has said its piece.
    if (prevPhrase !== null && phrase !== prevPhrase) setTransition(null);
  }, [step, phrase]);
  // R7: the wizard's confirm asked for proposals from the sources. Start them once, on arrival at an
  // Objectives step with nothing proposed yet: the same intent the "Propose from sources" button sends.
  useEffect(() => {
    if (!view || step !== "objectives" || view.proposals.length > 0 || c.busy) return;
    if (!takeProposeOnArrival(courseId)) return;
    const materials = [...c.sources.map((h) => ({ name: h.name, text: h.text })), ...links.map((url) => ({ url }))];
    if (materials.length > 0) void c.actions.proposeFromSources(materials);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [view, step]);
  // The transition sentence has said its piece; the next work begins from a plain turn line.
  useEffect(() => { if (c.waiting || c.busy) setTransition(null); }, [c.waiting, c.busy]);

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
  const decisions = decisionCount(view.activity ?? []);
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
            <button type="button" className={s.pill} onClick={() => setAiOpen(true)} aria-haspopup="dialog">
              <span className={s.aiDot} data-tone={ai.diagnosis.tone} aria-hidden="true" />{ai.diagnosis.label}
            </button>
            <button type="button" className={s.pill} onClick={() => setHistoryOpen(true)}>
              <span className={s.pillDot} aria-hidden="true" />{decisionPillLabel(decisions)}
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
          <StepStatus view={view} waiting={c.waiting} worker={worker} transition={transition} />
          {c.notice ? <div className={s.noticeRow}><Notice onClose={() => c.setNotice(null)}>{c.notice}</Notice></div> : null}
          {shown === "brief" ? <BriefStep {...common} /> : null}
          {shown === "objectives" ? <ObjectivesStep {...common} links={links} /> : null}
          {shown === "plan" ? <PlanStep {...common} /> : null}
          {shown === "publish" ? <PublishStep {...common} /> : null}
        </div>
      </div>

      <Dialog open={aiOpen} onClose={() => setAiOpen(false)} label="AI status">
        <div className={ui.dialogBody}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h2 style={{ fontSize: "1.5rem" }}>AI status</h2>
            <Button variant="quiet" size="small" onClick={() => setAiOpen(false)}>Close</Button>
          </div>
          <AiCheck ai={ai} lastProblem={c.notice ?? undefined} />
        </div>
      </Dialog>

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
