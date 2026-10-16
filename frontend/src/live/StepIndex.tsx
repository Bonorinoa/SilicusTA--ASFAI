/**
 * StepIndex — the five steps of a course as a line of type: 1 Material · 2 Outline · 3 Objectives · 4 Plan · 5 Publish.
 * The current step is marked, finished steps are ticked. Display only: it reads the host's checkpoints and the
 * stage the page is showing, and decides nothing.
 */
import type { HostView } from "../gate/transport";
import type { Stage } from "./stage";
import styles from "./Stage.module.css";

const STEPS = [
  { id: "files", label: "Material" },
  { id: "outline", label: "Outline" },
  { id: "objectives", label: "Objectives" },
  { id: "plan", label: "Plan" },
  { id: "publish", label: "Publish" },
] as const;

/** Which step the stage belongs to. "published" is past the last step, so nothing is current. */
function currentStep(stage: Stage, v: HostView): string | null {
  switch (stage) {
    case "intake": return v.checkpoints.files?.status === "confirmed" ? "outline" : "files";
    case "material":
    case "objectives": return "objectives";
    case "plan": return "plan";
    case "publish": return "publish";
    case "published": return null;
  }
}

export function StepIndex({ view, stage }: { view: HostView; stage: Stage }) {
  const current = currentStep(stage, view);
  return (
    <ol className={styles.steps} aria-label="Steps">
      {STEPS.map((s, i) => {
        const done = s.id !== current && view.checkpoints[s.id]?.status === "confirmed";
        const state = s.id === current ? "current" : done ? "done" : "todo";
        return (
          <li key={s.id} className={styles.step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className={styles.stepMark} aria-hidden="true">{done ? "\u2713" : i + 1}</span>
            <span className={styles.stepLabel}>{s.label}</span>
            {done ? <span className={styles.srOnly}>, done</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
