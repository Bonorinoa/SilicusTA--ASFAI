import { useEffect, useRef, useState } from "react";
import { BROWSER_MODE } from "../../gate/mode";
import type { DecisionIntent, ProposalView } from "../../gate/types";
import { plural } from "../../lib/plural";
import { PlusIcon, StateIcon } from "../icons";
import styles from "./DecisionCard.module.css";

/**
 * DecisionCard — the teacher's decision surface for checkpoint 3 (objectives).
 *
 * Renders objective PROPOSALS as a quiet ledger of rows and exposes the four
 * teacher decision verbs — accept / rename / drop / add — as explicit actions, plus
 * "Edit wording" (verb `reword`) on an already CONFIRMED objective: same id, so the lesson
 * plan's citations survive, and the original wording stays visible.
 * The card holds no policy: every action dispatches a {@link DecisionIntent}
 * upward, and the parent turns it into a real teacher turn + `confirmObjectives`
 * call on the confirm-gate core. Nothing is ever pre-confirmed; the resting
 * state is honest: nothing is decided until the teacher decides it.
 *
 * Safety rules this surface must keep (design review, A1):
 *  - Dropping is terminal, so it is never one tap: a confirm step quotes the
 *    statement and defaults focus to "Keep it".
 *  - A decision never strands keyboard focus on <body>: focus moves to the
 *    row's action group after a verb lands.
 *  - Exactly ONE live region (sr-only) announces decisions and progress.
 *  - The CONFIRM bar keeps its reason reachable: aria-disabled (still focusable)
 *    with a state-bearing label, never a hidden `disabled` control.
 */
export interface DecisionCardProps {
  /** Proposal + added-objective rows, derived from real gate state by the parent. */
  rows: readonly ProposalView[];
  /** The only output channel: teacher verbs leave as intents, never as decisions. */
  onDispatch: (intent: DecisionIntent) => void;
  /** Optional advance hook for the CONFIRM bar (the gate auto-confirms checkpoint 3). */
  onConfirm?: () => void;
  /** Live objectives-checkpoint status from the gate, driving the CONFIRM bar. */
  checkpointStatus?: "pending" | "open" | "confirmed";
  /** Small caps kicker above the heading, e.g. "Lesson 3 · AI literacy". */
  courseLabel?: string;
  /**
   * Can a new lesson plan be drafted on this host? Only used to be honest about the cost of revoking an
   * objective the current plan cites. Omitted means "yes"; `false` is a host with no drafting worker.
   */
  canRedraftPlan?: boolean;
  /**
   * Show the decisions and nothing else: no verbs, no Add, no confirm bar. Used for objectives the teacher has
   * already decided, until they choose to revise (the verbs and their meaning are unchanged; they are only not
   * offered). Display only: the gate still decides what a verb does.
   */
  readOnly?: boolean;
  /** Leave the CONFIRM bar out (the verbs stay). Used where the page's own primary action is elsewhere. */
  hideBar?: boolean;
}

const STATUS_LABEL: Record<ProposalView["status"], string> = {
  proposed: "Awaiting your decision",
  accepted: "Accepted",
  renamed: "Renamed",
  dropped: "Dropped",
  added: "Added by you",
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  closeMatch: "close match",
  relatedTo: "related to",
  exactMatch: "exact match",
};

export function DecisionCard({
  rows,
  onDispatch,
  onConfirm,
  checkpointStatus = "open",
  courseLabel,
  canRedraftPlan = true,
  readOnly = false,
  hideBar = false,
}: DecisionCardProps) {
  const [adding, setAdding] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [hintFlash, setHintFlash] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const proposals = rows.filter((r) => r.by === "ai");
  const decided = proposals.filter((r) => r.status !== "proposed").length;
  const addedCount = rows.filter((r) => r.status === "added").length;
  const awaiting = proposals.length - decided;
  const allDecided = proposals.length > 0 && awaiting === 0;

  const announce = (text: string) => setAnnouncement(text);

  // Focus returns to the Add action when its editor closes — never to <body>.
  useEffect(() => {
    if (wasAdding.current && !adding) addButtonRef.current?.focus();
    wasAdding.current = adding;
  }, [adding]);

  // One live region, one composed message per commit: the decisions that landed
  // (plus the milestone when the last proposal is decided). Two independent
  // effects would race and silently drop the decision announcement.
  const prevStatuses = useRef(new Map<string, ProposalView["status"]>());
  const prevStatements = useRef(new Map<string, string>());
  useEffect(() => {
    const landed: string[] = [];
    rows.forEach((row, i) => {
      const prev = prevStatuses.current.get(row.id);
      if (prev !== undefined && prev !== row.status) {
        landed.push(`Objective ${i + 1}: ${STATUS_LABEL[row.status].toLowerCase()}.`);
      } else if (prev !== undefined && prevStatements.current.get(row.id) !== row.statement) {
        landed.push(`Objective ${i + 1}: wording saved, reworded by you.`);
      }
      prevStatuses.current.set(row.id, row.status);
      prevStatements.current.set(row.id, row.statement);
    });
    if (landed.length === 0) return;
    announce(
      landed.join(" ") +
        (allDecided
          ? ` All ${plural(proposals.length, "proposal")} decided — every objective carries your decision.`
          : ""),
    );
  }, [rows, allDecided, proposals.length]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const restingLine =
    rows.length === 0
      ? "Nothing proposed yet."
      : proposals.length === 0
        ? "Your objectives — the AI proposed none."
        : decided + addedCount === 0
          ? `Nothing decided yet — 0 of ${proposals.length}.`
          : awaiting > 0
            ? `${decided} of ${proposals.length} decided · ${awaiting} awaiting your decision.`
            : `All ${plural(proposals.length, "proposal")} decided — every objective carries your decision.`;

  // Once the teacher has confirmed: one plain sentence of what was decided (not "checkpoint 3 of 5", which is the gate's counting).
  const kept = proposals.filter((r) => r.status === "accepted" || r.status === "renamed").length;
  const statusLine =
    checkpointStatus === "confirmed" && allDecided
      ? proposals.length === 1
        ? `The objective is decided: ${kept === 1 ? "kept" : "dropped"}.`
        : `All ${plural(proposals.length, "objective")} decided: ${kept} kept.`
      : restingLine;

  const confirmLabel =
    proposals.length === 0
      ? "Confirm objectives"
      : allDecided
        ? `Confirm ${plural(proposals.length, "objective")} · build the plan`
        : `Confirm ${plural(proposals.length, "objective")} — ${plural(awaiting, "decision")} left`;

  const flashHint = () => {
    setHintFlash(true);
    // A disarmed activation must not be silent for screen-reader users.
    announce(
      proposals.length === 0
        ? "Nothing to confirm yet."
        : `Every proposal needs a decision first — ${awaiting} still awaiting yours.`,
    );
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHintFlash(false), 1200);
  };

  return (
    <section className={styles.card} aria-label="Objective proposals">
      {/* The card's ONLY live region: decisions and the decided milestone. */}
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <header className={styles.header}>
        {courseLabel ? <p className={styles.eyebrow}>{courseLabel}</p> : null}
        <h2 className={styles.heading}>Learning objectives</h2>
        <p className={styles.subhead}>
          {readOnly
            ? "Your decisions on each objective. Choose Revise this course to change one."
            : "Proposed for your course. Nothing is confirmed until you decide — accept, rename in your own words, drop, or add one of your own. Once confirmed, an objective's wording can still be edited."}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className={styles.empty}>No proposals yet. The AI has not proposed objectives.</p>
      ) : (
        <ol className={styles.rows} role="list">
          {rows.map((row, index) => (
            <ProposalRow key={row.id} row={row} index={index + 1} onDispatch={onDispatch} canRedraftPlan={canRedraftPlan} readOnly={readOnly} />
          ))}
        </ol>
      )}

      {readOnly ? null : <div className={styles.addRow}>
        {adding ? (
          <AddEditor
            onCancel={() => setAdding(false)}
            onCommit={(statement) => {
              onDispatch({ verb: "add", statement });
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.quietButton}
            ref={addButtonRef}
            onClick={() => setAdding(true)}
            aria-label="Add a new local objective, written by you"
          >
            <PlusIcon />
            <span>Add objective</span>
          </button>
        )}
      </div>}

      {readOnly || hideBar ? null : <footer
        className={styles.confirmBar}
        data-armed={allDecided ? "true" : "false"}
        data-print="hide"
      >
        <p className={styles.confirmStatus}>
          {allDecided ? (
            <span className={styles.readyMark} aria-hidden="true">
              ✓ Ready ·{" "}
            </span>
          ) : null}
          {statusLine}
        </p>
        <div className={styles.confirmActions}>
          <span
            className={styles.confirmHint}
            id="confirm-hint"
            data-flash={hintFlash ? "true" : "false"}
          >
            {allDecided
              ? "Every objective carries your decision."
              : "Every proposal needs a decision first."}
          </span>
          <button
            type="button"
            className={styles.confirmButton}
            data-primary="true"
            data-armed={allDecided ? "true" : "false"}
            aria-disabled={!allDecided}
            aria-describedby="confirm-hint"
            onClick={() => {
              if (!allDecided) {
                flashHint();
                return;
              }
              onConfirm?.();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </footer>}

    </section>
  );
}

/* ------------------------------- one row --------------------------------- */

function ProposalRow({
  row,
  index,
  onDispatch,
  canRedraftPlan,
  readOnly,
}: {
  row: ProposalView;
  index: number;
  onDispatch: (intent: DecisionIntent) => void;
  canRedraftPlan: boolean;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Which verb the open editor will send: rename answers a PROPOSAL, reword edits a CONFIRMED objective.
  const [editVerb, setEditVerb] = useState<"rename" | "reword">("rename");
  const [draft, setDraft] = useState(row.statement);
  const [hint, setHint] = useState<string | null>(null);
  const [confirmingDrop, setConfirmingDrop] = useState(false);
  const [focusAfterClose, setFocusAfterClose] = useState<"rename" | "drop" | "actions" | null>(null);
  const [focusActionsAfter, setFocusActionsAfter] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Focus moves with the edit: into the editor when it opens, back to the row's
  // actions (or the verb that opened the confirm) when it closes.
  useEffect(() => {
    if (editing) {
      setDraft(row.statement);
      const el = editorRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      setFocusAfterClose(null);
    } else if (focusAfterClose) {
      const target =
        focusAfterClose === "rename"
          ? renameRef
          : focusAfterClose === "drop"
            ? dropRef
            : actionsRef;
      target.current?.focus();
      setFocusAfterClose(null);
    }
  }, [editing, focusAfterClose, row.statement]);

  // A decision must never strand focus on <body>: after a verb lands, focus the
  // row's action group (which is still mounted, `tabIndex={-1}`).
  useEffect(() => {
    if (focusActionsAfter && !editing && !confirmingDrop) {
      actionsRef.current?.focus();
      setFocusActionsAfter(false);
    }
  }, [focusActionsAfter, editing, confirmingDrop]);

  // The destructive step defaults to the safe choice.
  useEffect(() => {
    if (confirmingDrop) keepRef.current?.focus();
  }, [confirmingDrop]);

  const commit = () => {
    const statement = draft.trim();
    if (!statement) {
      setHint("An objective needs a statement.");
      return;
    }
    if (statement === row.statement) {
      setHint(editVerb === "reword" ? "Unchanged — change the wording, or Cancel." : "Unchanged — use Accept to keep the proposal as written.");
      return;
    }
    onDispatch({ verb: editVerb, proposalId: row.id, statement });
    setHint(null);
    setFocusAfterClose("actions");
    setEditing(false);
  };

  const cancel = () => {
    setDraft(row.statement);
    setHint(null);
    setFocusAfterClose("rename");
    setEditing(false);
  };

  const label = STATUS_LABEL[row.status];
  const decided = row.status !== "proposed";
  const canRename = row.status === "proposed";
  // A confirmed objective is edited in place: reword keeps its id, so the plan's citations survive.
  const canReword = row.status === "accepted" || row.status === "renamed" || row.status === "added";
  const canDrop =
    row.status === "proposed" ||
    row.status === "accepted" ||
    row.status === "renamed" ||
    row.status === "added";
  const canAccept = row.status === "proposed";
  const dropIsRevoke = row.status !== "proposed";
  // Line 1 is for the teacher; line 2 is the raw key, with no prose wrapper to
  // duplicate what line 1 already said.
  const humanAlignment = row.alignment
    ? row.alignment.suggested
      ? "suggested match"
      : (RELATIONSHIP_LABEL[row.alignment.relationship] ?? row.alignment.relationship)
    : null;
  const alignmentKey = row.alignment ? row.alignment.publicId : null;

  // Revoking an objective the lesson plan cites invalidates that plan. Say what that costs BEFORE it is done.
  const planCost =
    dropIsRevoke && row.citedByPlan
      ? canRedraftPlan
        ? "The current lesson plan cites it, so that plan becomes invalid and a new one must be drafted and confirmed before you can publish."
        : BROWSER_MODE
          ? "The current lesson plan cites it, so that plan becomes invalid — and AI drafting is not set up on this site, so you could not publish again until it is."
          : "The current lesson plan cites it, so that plan becomes invalid — and no drafting worker is configured on this host, so you could not publish again until one is."
      : null;

  const actionsArea = () => {
    if (confirmingDrop) {
      return (
        <div
          className={styles.dropConfirm}
          role="group"
          aria-label={`Confirm dropping objective ${index}`}
        >
          <p className={styles.dropConfirmText}>
            <strong className={styles.dropConfirmTitle}>
              {dropIsRevoke ? "Revoke this decision?" : "Drop this objective?"}
            </strong>{" "}
            {dropIsRevoke
              ? "The objective leaves this plan and stops being part of it."
              : "It is removed from this plan and cannot be restored — you would have to write it again."}
            {planCost ? ` ${planCost}` : null}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.verbButton}
              ref={keepRef}
              onClick={() => {
                setConfirmingDrop(false);
                setFocusAfterClose("drop");
              }}
            >
              Keep it
            </button>
            <button
              type="button"
              className={styles.verbButton}
              data-verb="drop"
              data-danger="true"
              aria-label={`${dropIsRevoke ? "Revoke" : "Drop"} objective ${index} for good: “${row.statement}”`}
              onClick={() => {
                setConfirmingDrop(false);
                setFocusActionsAfter(true);
                onDispatch({ verb: "drop", proposalId: row.id });
              }}
            >
              {dropIsRevoke ? "Revoke it" : "Drop it"}
            </button>
          </div>
        </div>
      );
    }

    if (editing) {
      return (
        <div className={styles.editor}>
          <label className={styles.srOnly} htmlFor={`rename-${row.id}`}>
            {editVerb === "reword" ? `Edit the wording of objective ${index}` : `New wording for objective ${index}`}
          </label>
          <textarea
            id={`rename-${row.id}`}
            ref={editorRef}
            className={styles.editorInput}
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            aria-describedby={`rename-hint-${row.id}`}
            aria-invalid={hint ? true : undefined}
          />
          <div className={styles.editorBar}>
            <p
              className={styles.editorHint}
              id={`rename-hint-${row.id}`}
              role="status"
              aria-live="polite"
            >
              {hint ??
                (editVerb === "reword"
                  ? "The objective keeps its id, so the lesson plan still cites it. Enter saves, Esc cancels"
                  : "Save or Cancel — Enter saves, Esc cancels")}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.verbButton}
                data-verb="save"
                onClick={commit}
              >
                Save
              </button>
              <button type="button" className={styles.verbButton} onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={styles.actions}
        ref={actionsRef}
        tabIndex={-1}
        aria-label={`Decisions for objective ${index}`}
      >
        {canAccept ? (
          <button
            type="button"
            className={styles.verbButton}
            data-verb="accept"
            aria-label={`Accept objective: “${row.statement}”`}
            onClick={() => {
              setFocusActionsAfter(true);
              onDispatch({ verb: "accept", proposalId: row.id });
            }}
          >
            Accept
          </button>
        ) : null}
        {canRename ? (
          <button
            type="button"
            className={styles.verbButton}
            data-verb="rename"
            ref={renameRef}
            aria-label={`Rename objective: “${row.statement}”`}
            onClick={() => { setEditVerb("rename"); setEditing(true); }}
          >
            Rename
          </button>
        ) : null}
        {canReword ? (
          <button
            type="button"
            className={styles.verbButton}
            data-verb="rename"
            ref={renameRef}
            aria-label={`Edit the wording of objective ${index}: “${row.statement}”`}
            onClick={() => { setEditVerb("reword"); setEditing(true); }}
          >
            Edit wording
          </button>
        ) : null}
        {canDrop ? (
          <button
            type="button"
            className={styles.verbButton}
            ref={dropRef}
            data-verb="drop"
            data-danger="true"
            aria-label={
              dropIsRevoke
                ? `Revoke your decision on objective ${index}: “${row.statement}”`
                : `Drop objective: “${row.statement}”`
            }
            onClick={() => setConfirmingDrop(true)}
          >
            {dropIsRevoke ? "Revoke" : "Drop"}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <li className={styles.row} data-status={row.status}>
      <div className={styles.rowInner}>
        <p className={styles.index} aria-hidden="true">
          {String(index).padStart(2, "0")}
        </p>

        <div className={styles.content}>
          <p className={styles.statusLabel} data-status={row.status}>
            <StateIcon status={row.status} />
            <span>{label}</span>
            {row.reworded ? <span className={styles.rewordedMark}>Reworded by you</span> : null}
          </p>

          {/* While editing, the editor stands in the statement's place (the wording
              never shrinks and the row keeps its height). Provenance STAYS
              visible — it is part of what the teacher is judging while they
              reword. */}
          {!editing ? (
            <>
              <h3
                className={styles.statement}
                data-renamed={row.status === "renamed" ? "true" : undefined}
                key={row.statement}
              >
                {row.statement}
              </h3>

              {row.originalStatement && row.originalStatement !== row.statement ? (
                <p className={styles.renamedFrom}>
                  {row.reworded
                    ? `${row.by === "teacher" ? "as you first wrote it" : "as proposed"}: “${row.originalStatement}” — you reworded it; the objective id is unchanged.`
                    : `as proposed: “${row.originalStatement}” — wording is versioned; the objective id is stable.`}
                </p>
              ) : null}
            </>
          ) : null}

          <p className={styles.provenance}>
            {row.source ? <span>{row.source}</span> : null}
            {row.source && humanAlignment ? <span className={styles.dot}> · </span> : null}
            {humanAlignment ? <span>{humanAlignment}</span> : null}
          </p>
          {alignmentKey ? <p className={styles.alignmentKey}>{alignmentKey}</p> : null}

          {readOnly ? null : actionsArea()}

          {row.status === "dropped" ? (
            <p className={styles.droppedNote}>
              Dropped. Dropped objectives cannot be revived — add a new objective to replace it.
            </p>
          ) : null}
          {!readOnly && decided && row.status !== "dropped" && !editing && !confirmingDrop ? (
            <p className={styles.decidedNote}>
              {canReword
                ? "Decided. You can edit its wording, or revoke it."
                : "Decided. One decision per proposal; you can still revoke it."}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------ add editor -------------------------------- */

function AddEditor({
  onCommit,
  onCancel,
}: {
  onCommit: (statement: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  const commit = () => {
    const statement = draft.trim();
    if (!statement) {
      setHint("An objective needs a statement.");
      return;
    }
    onCommit(statement);
  };

  return (
    <div className={styles.editor}>
      <label className={styles.srOnly} htmlFor="add-objective">
        New objective, written by you
      </label>
      <textarea
        id="add-objective"
        ref={editorRef}
        className={styles.editorInput}
        value={draft}
        rows={2}
        placeholder="Write an objective in your own words — it joins this course as yours."
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-describedby="add-hint"
        aria-invalid={hint ? true : undefined}
      />
      <div className={styles.editorBar}>
        <p className={styles.editorHint} id="add-hint" role="status" aria-live="polite">
          {hint ?? "Save or Cancel — Enter saves, Esc cancels"}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.verbButton} onClick={commit}>
            Add
          </button>
          <button type="button" className={styles.verbButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default DecisionCard;
