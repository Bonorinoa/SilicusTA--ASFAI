/**
 * StepIndex — the five steps of a course: Material · Brief · Objectives · Plan · Publish.
 *
 * Narrow (and below 1100 px) it is a line of type, a stepper. At 1100 px and up the page lays the very same list out
 * as a sticky stage navigator in the left column, where every step carries a one-line summary of where it stands.
 * One list, two layouts: nothing is drawn twice.
 *
 * Display only. It reads the host's checkpoints and what the page is showing, and decides nothing. A step is a button
 * only where there is something to look at (it is finished, it is where the work is, or its artifact exists); opening
 * one is a look, never an act: nothing is written, and the stage the host says is current stays current.
 */
import { answerText } from "../components/AiWaiting";
import { plural } from "../lib/plural";
import type { HostView } from "../gate/transport";
import type { Stage } from "./stage";
import styles from "./Stage.module.css";

export type StepId = "files" | "outline" | "objectives" | "plan" | "publish";

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: "files", label: "Material" },
  // The gate calls this checkpoint "outline"; the teacher's word for it is the glossary's: Brief.
  { id: "outline", label: "Brief" },
  { id: "objectives", label: "Objectives" },
  { id: "plan", label: "Plan" },
  { id: "publish", label: "Publish" },
];

/** Which step the stage belongs to (where the work is). "published" is past the last step, so none is. */
export function workStep(stage: Stage, v: HostView): StepId | null {
  switch (stage) {
    case "intake": return v.checkpoints.files?.status === "confirmed" ? "outline" : "files";
    case "material":
    case "objectives": return "objectives";
    case "plan": return "plan";
    case "publish": return "publish";
    case "published": return null;
  }
}

/** Is there anything to look at for this step? */
function reachable(id: StepId, v: HostView, work: StepId | null): boolean {
  if (id === work) return true;
  switch (id) {
    case "files":
    case "outline":
    case "objectives": return v.checkpoints[id]?.status === "confirmed";
    case "plan": return !!v.plan;
    case "publish": return v.versions.length > 0 || v.plan?.status === "confirmed";
  }
}

/** One line on where a step stands. Counts come from the host's own view; nothing is guessed. */
export function summaryOf(id: StepId, v: HostView): string {
  const confirmed = v.checkpoints[id]?.status === "confirmed";
  switch (id) {
    case "files": {
      if (!confirmed) return "Not confirmed";
      const n = (v.course.materials ?? []).length;
      return n === 0 ? "No materials" : plural(n, "material");
    }
    case "outline": return confirmed ? answerText(v.intake.answers?.topic) || "Confirmed" : "Not confirmed";
    case "objectives":
      if (confirmed) return `${plural(v.objectives.length, "objective")} confirmed`;
      return v.proposals.length > 0 ? `${plural(v.proposals.length, "proposal")} to decide` : "Not started";
    case "plan": {
      const p = v.plan;
      if (!p) return "Not started";
      if (p.status === "invalidated") return "Needs a new plan";
      const mins = p.activities.reduce((n, a) => n + a.minutes, 0);
      return `${p.status === "confirmed" ? "" : "Draft · "}${plural(p.activities.length, "activity", "activities")} · ${mins} min`;
    }
    case "publish": {
      const n = v.versions.length;
      if (n === 0) return "Not published";
      return v.revision?.drafting ? `Version ${n} · revising` : `Version ${n}`;
    }
  }
}

export function StepIndex({ view, stage, open, onOpen }: {
  view: HostView;
  stage: Stage;
  /** The step the page is showing: the one being looked at, or else where the work is. */
  open: StepId | null;
  onOpen?: (id: StepId) => void;
}) {
  const work = workStep(stage, view);
  return (
    <ol className={styles.steps} aria-label="Steps">
      {STEPS.map((s, i) => {
        const done = s.id !== open && view.checkpoints[s.id]?.status === "confirmed";
        const state = s.id === open ? "current" : done ? "done" : "todo";
        const summary = summaryOf(s.id, view);
        const inner = (
          <>
            <span className={styles.stepMark} aria-hidden="true">{done ? "\u2713" : i + 1}</span>
            <span className={styles.stepText}>
              <span className={styles.stepLabel}>{s.label}</span>
              <span className={styles.stepSummary}>{summary}</span>
            </span>
            {done ? <span className={styles.srOnly}>, done</span> : null}
          </>
        );
        return (
          <li key={s.id} className={styles.step} data-state={state} data-work={s.id === work ? "true" : undefined} aria-current={state === "current" ? "step" : undefined}>
            {onOpen && reachable(s.id, view, work) ? (
              <button type="button" className={styles.stepButton} onClick={() => onOpen(s.id)}>{inner}</button>
            ) : (
              <span className={styles.stepButton} data-static="true">{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
