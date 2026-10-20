/**
 * AiCheck — the diagnosis, shown the same way in the wizard's AI check and in the studio's AI status:
 * one sentence of what is true, the fix when something is off, and a few plain facts. Not a live region:
 * the studio keeps ONE polite live region, its status line.
 */
import type { ReactNode } from "react";
import { BROWSER_MODE } from "../gate/mode";
import type { AiStatus } from "./aiStatus";
import { Button } from "./ui";
import w from "./Wizard.module.css";

const range = (r?: readonly [number, number]) => (r ? `${r[0]}–${r[1]} s` : null);

export function AiCheck({ ai, lastProblem }: { ai: AiStatus; lastProblem?: ReactNode }) {
  const d = ai.diagnosis;
  const t = ai.worker?.typicalSeconds;
  const waits = [t?.objectives ? `objectives ${range(t.objectives)}` : null, t?.plan ? `a plan ${range(t.plan)}` : null].filter(Boolean).join(" · ");
  return (
    <div className={w.check}>
      <div className={w.diagnosis}>
        <span className={w.dot} data-tone={d.tone} aria-hidden="true" />
        <p className={w.diagnosisText}>{d.sentence}</p>
        {d.fix ? <p className={w.diagnosisFix}>{d.fix}</p> : null}
      </div>
      {d.action ? (
        <div className={w.checkActions}>
          {d.action === "passcode" ? <Button variant="primary" onClick={ai.enterPasscode}>Enter the passcode</Button> : null}
          {d.action === "recheck" ? <Button onClick={ai.recheck}>Check again</Button> : null}
        </div>
      ) : null}
      <dl className={w.facts}>
        <dt>Drafting runs</dt>
        <dd>{BROWSER_MODE ? "On this site’s drafting service" : "Through the Silicus host on this computer"}</dd>
        {BROWSER_MODE && ai.worker?.passcodeRequired ? <><dt>Passcode</dt><dd>{ai.passcodeHeld ? "Held in this tab" : "Not entered in this tab"}</dd></> : null}
        {waits ? <><dt>Usual wait</dt><dd>{waits}</dd></> : null}
        {ai.worker?.zdr ? <><dt>Your text</dt><dd>Not kept by the model provider</dd></> : null}
        {lastProblem ? <><dt>Last attempt</dt><dd>{lastProblem}</dd></> : null}
      </dl>
    </div>
  );
}
