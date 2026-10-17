/**
 * BriefCard — the Brief stage: the teacher's own answers, on screen, as the thing they confirm.
 *
 * The gate calls this checkpoint `outline`; the teacher's word for it is the glossary's: Brief. What is confirmed
 * here is exactly what is shown here (topic, who it is for, what learners should be able to do), each with Edit.
 * There is never a confirm with nothing on screen: with no outcome on record the primary is disabled and the
 * reason is said in a plain sentence next to it.
 *
 * Display and intent only. Edit re-answers through the host's intake answer route (the page passes `onEdit`);
 * Edit is offered only for a question the host still accepts an answer to, so the button never records nothing.
 */
import { useId, useState, type ReactNode } from "react";
import { answerText } from "../components/AiWaiting";
import { StageBar } from "./StageBar";
import styles from "./BriefCard.module.css";

export type BriefAnswers = Record<string, string | string[] | undefined>;

interface Row { id: "topic" | "course" | "learning_outcomes"; label: string; empty: string; multiline: boolean }
const ROWS: readonly Row[] = [
  { id: "topic", label: "Topic", empty: "Not answered", multiline: false },
  { id: "course", label: "Who it is for", empty: "Not answered", multiline: false },
  { id: "learning_outcomes", label: "Learners should be able to", empty: "Nothing on record", multiline: true },
];

const outcomeLines = (v: BriefAnswers[string]): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+/) : []).map((s) => s.trim()).filter(Boolean);

/** True when the teacher has put at least one outcome on record, or asked Silicus to propose them from their material. */
export function hasOutcome(answers: BriefAnswers): boolean {
  return outcomeLines(answers.learning_outcomes).length > 0 || answers.outcomes_from === "materials";
}

export function BriefCard({ answers, editable, source, busy, onEdit, onConfirm }: {
  answers: BriefAnswers;
  /** Question ids the host will still take an answer to. Anything else is shown without an Edit button. */
  editable: readonly string[];
  /** One secondary line on where ASFAI stands, or null. */
  source: ReactNode;
  busy: boolean;
  onEdit: (id: Row["id"], text: string) => void;
  onConfirm: () => void;
}) {
  const [editing, setEditing] = useState<Row["id"] | null>(null);
  const [draft, setDraft] = useState("");
  const formId = useId();
  const outcome = hasOutcome(answers);
  const fromMaterials = answers.outcomes_from === "materials" && outcomeLines(answers.learning_outcomes).length === 0;

  const valueOf = (r: Row): string => {
    if (r.id === "learning_outcomes") {
      const lines = outcomeLines(answers.learning_outcomes);
      return lines.length > 0 ? lines.join("\n") : fromMaterials ? "You asked Silicus to propose them from your materials." : "";
    }
    return answerText(answers[r.id]);
  };
  const open = (r: Row) => { setDraft(r.id === "learning_outcomes" && !fromMaterials ? outcomeLines(answers.learning_outcomes).join("\n") : valueOf(r)); setEditing(r.id); };
  const save = (r: Row) => { const t = draft.trim(); if (!t) return; onEdit(r.id, t); setEditing(null); };

  const anyLocked = ROWS.some((r) => !editable.includes(r.id));
  return (
    <section className={styles.card} aria-label="Your brief">
      <header>
        <h2 className={styles.heading}>Your brief</h2>
        <p className={styles.lede}>Your own answers. The objectives are drawn from them, so read them once more before you go on.</p>
      </header>
      <dl className={styles.rows}>
        {ROWS.map((r) => {
          const value = valueOf(r);
          const canEdit = editable.includes(r.id);
          return (
            <div key={r.id} className={styles.row}>
              <dt className={styles.label}>{r.label}</dt>
              <dd className={styles.value}>
                {editing === r.id ? (
                  <form className={styles.form} onSubmit={(e) => { e.preventDefault(); save(r); }}>
                    <label className={styles.srOnly} htmlFor={`${formId}-${r.id}`}>{r.label}</label>
                    <textarea
                      id={`${formId}-${r.id}`}
                      className={styles.box}
                      rows={r.multiline ? 4 : 2}
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    {r.multiline ? <p className={styles.hint}>One outcome per line. Each line becomes an objective you confirm.</p> : null}
                    <span className={styles.verbs}>
                      <button type="submit" className={styles.quiet} disabled={busy || !draft.trim()}>Save</button>
                      <button type="button" className={styles.quiet} onClick={() => setEditing(null)}>Cancel</button>
                    </span>
                  </form>
                ) : (
                  <>
                    <span className={value ? styles.said : styles.none}>{value || r.empty}</span>
                    {canEdit ? (
                      <button type="button" className={styles.edit} disabled={busy} onClick={() => open(r)} aria-label={`${value ? "Edit" : "Add"}: ${r.label}`}>
                        {value ? "Edit" : "Add"}
                      </button>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {anyLocked ? <p className={styles.note}>An answer without an Edit button has already been sent to ASFAI, so it cannot be changed from here.</p> : null}
      {source ? <p className={styles.note}>{source}</p> : null}
      <StageBar status={outcome
        ? "These are your answers. Confirm them to go on to the objectives."
        : "Nothing to confirm yet: no outcome is on record. Say what learners should be able to do first."}>
        <button type="button" className={styles.primary} data-primary="true" onClick={onConfirm} disabled={busy || !outcome}>
          Confirm the brief
        </button>
      </StageBar>
    </section>
  );
}
