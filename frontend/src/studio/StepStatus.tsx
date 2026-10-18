/**
 * StepStatus — the ONE status line for the current step (B2).
 *
 * One line, exactly one polite live region, and every value rendered here comes from the host view plus
 * the waiting state: never a spinner that promises progress, never a stop time that would promise an
 * answer. The line is either the teacher's turn, "Silicus is <doing what>" with the real clock and that
 * step's usual range, or "Waiting for your passcode" — no clock while the teacher is the one being waited
 * for. The ticking clock sits OUTSIDE the live region: a live region containing it would announce every
 * second. A step transition (B4) is spoken once through the same region, ahead of the new step's turn.
 */
import { typicalRange } from "../components/AiWaiting/model";
import type { HostView } from "../gate/transport";
import { turnPhrase, type Waiting, type WorkerInfo } from "./useCourse";
import { WaitClock } from "./ui";
import s from "./StepStatus.module.css";

export function StepStatus({ view, waiting, worker, transition }: {
  view: HostView;
  waiting: Waiting | null;
  worker: WorkerInfo | null;
  /** One sentence for a step transition (B4), said once, e.g. "Objectives confirmed. On to the plan." */
  transition: string | null;
}) {
  const pending = waiting?.phase === "passcode";
  const working = waiting?.phase === "working";
  const words = pending
    ? "Waiting for your passcode"
    : working
      ? `Silicus is ${waiting.what}`
      : `${transition ? `${transition} ` : ""}${turnPhrase(view)}`;
  return (
    <p className={s.line}>
      <span role="status" aria-atomic="true">{words}</span>
      {working ? <span aria-hidden="true"> · <WaitClock startedAt={waiting.startedAt} range={typicalRange(waiting.kind, worker?.typicalSeconds)} /></span> : null}
    </p>
  );
}