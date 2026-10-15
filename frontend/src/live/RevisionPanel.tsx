/**
 * RevisionPanel — revising a PUBLISHED course, honestly.
 *
 * What it shows is the host's reading of the record (`view.revision`), never a local mode. Opening it
 * writes nothing: "Revise this course" only reveals the tools. "You are drafting version N+1" appears
 * only when the record really differs from the sealed version, so a click that changes nothing leaves
 * the status saying so. Students read the last SEALED version until the teacher publishes the next one,
 * and this panel says that every time.
 */
import { useEffect, useRef, useState } from "react";
import { BROWSER_MODE } from "../gate/mode";
import type { RevisionView } from "../gate/transport";
import styles from "./RevisionPanel.module.css";

export interface RevisionPanelProps {
  /** The host's reading; only meaningful once a version is sealed. */
  revision: RevisionView;
  /** Can the drafting worker write a new plan on this host? */
  workerConfigured: boolean;
  /** Cited objectives reworded since the plan was drafted or confirmed (host-derived; empty when none). */
  planReworded?: readonly { id: string; before: string | null; after: string }[];
  busy: boolean;
  onDraftPlan: () => void;
}

export function RevisionPanel({ revision, workerConfigured, planReworded = [], busy, onDraftPlan }: RevisionPanelProps) {
  const sealed = revision.sealedVersion;
  const [choice, setChoice] = useState<boolean | null>(null);
  const [focusAfter, setFocusAfter] = useState<"tools" | "open" | null>(null);
  const toolsRef = useRef<HTMLHeadingElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  // Open on the teacher's request, or by itself once there is a draft to look after (unless they closed it).
  const open = choice ?? revision.drafting;

  // Focus follows the toggle: the button that was pressed disappears, so focus must go somewhere real.
  useEffect(() => {
    if (focusAfter === "tools") toolsRef.current?.focus();
    else if (focusAfter === "open") openRef.current?.focus();
    if (focusAfter) setFocusAfter(null);
  }, [focusAfter, open]);

  if (sealed === null) return null;
  const next = revision.nextVersion;
  const changes = revision.changes;
  const planInvalidated = changes?.planStatus === "invalidated";
  const needsPlan = planInvalidated || revision.notInPlan.length > 0;
  // A reword keeps the plan valid, so it is never "needed": a re-draft is the teacher's option, not a requirement.
  const planOlderThanWording = !planInvalidated && planReworded.length > 0;
  const reworded = changes?.objectivesReworded ?? [];
  const nothingChanged = !revision.drafting;

  const planLine =
    changes === null || changes.plan === "same"
      ? null
      : changes.plan === "replaced"
        ? "A new lesson plan is confirmed."
        : planInvalidated
          ? "The lesson plan is invalid: it cites an objective you revoked."
          : "A new lesson plan is drafted and waiting for your confirmation.";

  return (
    <section className={styles.panel} aria-label="Revise this course" data-drafting={revision.drafting ? "true" : "false"}>
      <h2 className={styles.title}>Published: version {sealed}</h2>
      <p className={styles.status} role="status" aria-live="polite">
        {revision.drafting
          ? `Version ${sealed} is published and unchanged; you are drafting version ${next}.`
          : `Version ${sealed} is published and unchanged.`}
      </p>
      <p className={styles.readers}>
        The student chat and the handout read version {sealed}, and keep reading it until you publish version {next}.
        A draft is never what students see.
      </p>

      {!open ? (
        <div className={styles.row}>
          <button
            type="button"
            className={styles.reviseButton}
            ref={openRef}
            onClick={() => { setChoice(true); setFocusAfter("tools"); }}
          >
            Revise this course
          </button>
          <span className={styles.hint}>Opens the revision tools. Nothing changes until you act.</span>
        </div>
      ) : (
        <div className={styles.tools}>
          <h3 className={styles.toolsTitle} tabIndex={-1} ref={toolsRef}>Revising: what has changed since version {sealed}</h3>

          {nothingChanged ? (
            <p className={styles.line}>Nothing yet. Version {sealed} is still the latest.</p>
          ) : (
            <ul className={styles.changes} aria-label={`Changes since version ${sealed}`}>
              {changes?.objectivesAdded.map((o) => <li key={`a${o.id}`}>Added: “{o.statement}”</li>)}
              {changes?.objectivesRemoved.map((o) => <li key={`r${o.id}`}>Revoked: “{o.statement}”</li>)}
              {reworded.map((o) => <li key={`w${o.id}`}>Reworded: “{o.before}” became “{o.after}”</li>)}
              {planLine ? <li>{planLine}</li> : null}
              {revision.notInPlan.map((o) => <li key={`n${o.id}`}>Not in the lesson plan yet: “{o.statement}”</li>)}
            </ul>
          )}

          {needsPlan ? (
            workerConfigured ? (
              <div className={styles.row}>
                <button type="button" className={styles.actionButton} onClick={onDraftPlan} disabled={busy}>
                  Draft a new lesson plan from your confirmed objectives
                </button>
                <span className={styles.hint}>The AI drafts; you still read and confirm the plan yourself.</span>
              </div>
            ) : (
              <p className={styles.line}>
                {BROWSER_MODE
                  ? "AI drafting is not set up on this site, so a new lesson plan cannot be drafted here."
                  : "No drafting worker is configured on this host, so a new lesson plan cannot be drafted here."}
                {planInvalidated ? " Until one is, version " + next + " cannot be published." : null}
              </p>
            )
          ) : planOlderThanWording ? (
            workerConfigured ? (
              <div className={styles.row}>
                <button type="button" className={styles.actionButton} onClick={onDraftPlan} disabled={busy}>
                  Draft a new lesson plan from your confirmed objectives
                </button>
                <span className={styles.hint}>Optional. The AI drafts; you still read and confirm the plan yourself.</span>
              </div>
            ) : (
              <p className={styles.line}>
                The lesson plan was written from the earlier wording of {planReworded.length === 1 ? "an objective" : "objectives"} you reworded. It is still valid
                and version {next} can be published with it as it reads; no drafting worker is configured, so it cannot be re-drafted here.
              </p>
            )
          ) : null}

          <ol className={styles.steps}>
            <li>Change the objectives below: add one of your own, edit the wording of a confirmed one, or revoke one. A revoked objective cannot be restored.</li>
            <li>If you added or revoked objectives, draft a new lesson plan and confirm it. Rewording one keeps the plan valid.</li>
            <li>Review and publish version {next} at the end of the page. Version {sealed} stays exactly as published.</li>
          </ol>
          <p className={styles.hint}>
            Editing a confirmed objective&rsquo;s wording keeps its id, so the lesson plan still cites it and version {sealed} is not touched.
            The plan was written from the old wording: you will be told, and you choose whether to re-draft it.
          </p>

          <button
            type="button"
            className={styles.closeButton}
            onClick={() => { setChoice(false); setFocusAfter("open"); }}
          >
            Close the revision tools
          </button>
        </div>
      )}
    </section>
  );
}

export default RevisionPanel;
