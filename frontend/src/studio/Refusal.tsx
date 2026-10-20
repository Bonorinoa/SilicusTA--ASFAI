/**
 * Refusal — one refusal, in the three parts of lib/refusals.ts (R5): what happened, whether anything was saved
 * or sent, and the one next action. The host's own words wait in a closed "Details". It sits in the studio's
 * notice row (the same polite status region the plain notice uses), so the page still has one notice at a time.
 */
import type { Explained } from "../lib/refusals";
import { Notice, ui } from "./ui";

export function Refusal({ problem, onClose }: { problem: Explained; onClose?: () => void }) {
  return (
    <Notice onClose={onClose}>
      <span className={ui.refusal}>
        <strong className={ui.refusalWhat}>{problem.what}</strong>
        <span>{problem.saved}</span>
        <span className={ui.refusalNext}>{problem.next}</span>
        {problem.details ? (
          <details className={ui.refusalDetails}>
            <summary>Details</summary>
            <span>{problem.details}</span>
          </details>
        ) : null}
      </span>
    </Notice>
  );
}
