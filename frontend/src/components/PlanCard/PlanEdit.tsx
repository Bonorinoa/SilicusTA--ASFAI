/**
 * PlanEdit — N3 (owner decision, 18 Nov): everything generated is editable.
 *
 * One small inline form: the fields of one activity or one plan section, Save / Cancel, keyboard first
 * (the first field takes focus, Escape cancels, Enter in a one-line field saves). It sends only the fields
 * the teacher changed, as {path, value} intents; the host bounds and records them. Minutes stay a whole
 * number. The form never decides anything itself: a refusal comes back as the studio's usual notice.
 *
 * N5 (C5): a later review's timing (whole days) and form; the objectives an activity cites (checkboxes over the
 * CONFIRMED objectives only; the host refuses any other id). `whole` sends every field, for a new activity.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./PlanCard.module.css";
import { AI_STATUS_LABEL, PHASE_LABEL } from "./design";

export type EditKind = "text" | "long" | "minutes" | "phase" | "aiStatus" | "evidence" | "days" | "reviewForm" | "objectives";
export interface EditField {
  path: string;
  label: string;
  kind: EditKind;
  value: string | number | readonly string[] | null | undefined;
  /** N5: the choices for "objectives" (the confirmed objectives, labelled "Objective N"). */
  options?: readonly { id: string; label: string; title?: string }[];
  max?: number;
  required?: boolean;
  hint?: string;
}
export interface PlanEdit { path: string; value: unknown }


const asText = (v: EditField["value"]) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(",") : String(v));

/** N5: the forms a later review takes, in the host's words (plan-edit.mjs REVIEW_FORMS). */
export const REVIEW_FORM_CHOICES = [
  ["recall-without-support", "Recall without support"],
  ["near-transfer", "Near transfer"],
  ["far-transfer", "Far transfer"],
  ["explain-to-absent", "Explain to someone absent"],
] as const;

export function EditButton({ what, onClick, disabled, buttonRef }: { what: string; onClick: () => void; disabled?: boolean; buttonRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button ref={buttonRef} type="button" className={styles.editButton} data-print="hide" data-plan-edit={what}
      aria-label={`Edit ${what}`} disabled={disabled} onClick={onClick}>
      Edit
    </button>
  );
}

export function EditForm({ what, fields, onSave, onCancel, disabled, whole = false, saveLabel = "Save" }: {
  what: string;
  fields: readonly EditField[];
  onSave: (edits: PlanEdit[], labels: string[]) => Promise<boolean>;
  onCancel: () => void;
  disabled?: boolean;
  /** N5: send every field, changed or not (a new activity). */
  whole?: boolean;
  saveLabel?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.path, asText(f.value)])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLElement | null>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const edits: PlanEdit[] = [];
    const labels: string[] = [];
    for (const f of fields) {
      const raw = draft[f.path] ?? "";
      if (!whole && raw === asText(f.value)) continue;
      let value: unknown = raw;
      if (f.kind === "days") {
        if (!/^\d{1,3}$/.test(raw.trim())) { setError(`${f.label}: a whole number of days.`); return; }
        value = Number(raw.trim());
      } else if (f.kind === "objectives") {
        value = raw.split(",").filter(Boolean);
        if ((value as string[]).length === 0) { setError("Cite at least one objective."); return; }
      } else if (f.kind === "minutes") {
        if (!/^\d{1,3}$/.test(raw.trim())) { setError(`${f.label}: a whole number of minutes.`); return; }
        value = Number(raw.trim());
      } else if (f.kind === "phase") {
        value = raw === "" ? null : Number(raw);
      } else if (f.required && raw.trim() === "") {
        setError(`${f.label} cannot be empty.`); return;
      }
      edits.push({ path: f.path, value });
      labels.push(f.label.toLowerCase());
    }
    if (edits.length === 0) { onCancel(); return; }
    setError(null);
    setSaving(true);
    const ok = await onSave(edits, labels);
    setSaving(false);
    if (ok) onCancel();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };

  return (
    <form className={styles.editForm} aria-label={`Edit ${what}`} data-plan-edit-form={what} data-print="hide" noValidate onSubmit={submit} onKeyDown={onKey}>
      {fields.map((f, i) => {
        const fid = `${id}-${i}`;
        const set = (v: string) => setDraft((d) => ({ ...d, [f.path]: v }));
        const ref = i === 0 ? (el: HTMLElement | null) => { first.current = el; } : undefined;
        return (
          <div key={f.path} className={styles.editField}>
            <label className={styles.editLabel} htmlFor={fid}>{f.label}</label>
            {f.kind === "long" ? (
              <textarea id={fid} ref={ref} className={styles.editInput} rows={2} maxLength={f.max} value={draft[f.path]} onChange={(e) => set(e.target.value)} />
            ) : f.kind === "minutes" ? (
              <input id={fid} ref={ref} className={`${styles.editInput} ${styles.editMinutes}`} type="number" inputMode="numeric" min={0} max={180} step={1}
                value={draft[f.path]} onChange={(e) => set(e.target.value)} />
            ) : f.kind === "phase" ? (
              <select id={fid} ref={ref} className={styles.editInput} value={draft[f.path]} onChange={(e) => set(e.target.value)}>
                <option value="">No phase</option>
                {([1, 2, 3, 4] as const).map((n) => <option key={n} value={String(n)}>{`${n} · ${PHASE_LABEL[n]}`}</option>)}
              </select>
            ) : f.kind === "evidence" ? (
              <select id={fid} ref={ref} className={styles.editInput} value={draft[f.path]} onChange={(e) => set(e.target.value)}>
                <option value="none">None collected in this activity</option>
                <option value="observation">Teacher observation</option>
                <option value="work-product">Learner work product</option>
              </select>
            ) : f.kind === "days" ? (
              <input id={fid} ref={ref} className={`${styles.editInput} ${styles.editMinutes}`} type="number" inputMode="numeric" min={0} max={365} step={1}
                value={draft[f.path]} onChange={(e) => set(e.target.value)} />
            ) : f.kind === "reviewForm" ? (
              <select id={fid} ref={ref} className={styles.editInput} value={draft[f.path]} onChange={(e) => set(e.target.value)}>
                {REVIEW_FORM_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            ) : f.kind === "objectives" ? (
              <span id={fid} className={styles.editChoices} role="group" aria-label={f.label} data-plan-edit-objectives>
                {(f.options ?? []).map((o, k) => {
                  const chosen = (draft[f.path] ?? "").split(",").filter(Boolean);
                  const on = chosen.includes(o.id);
                  const toggle = () => set((on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id]).join(","));
                  return (
                    <label key={o.id} className={styles.editChoice} title={o.title}>
                      <input type="checkbox" ref={k === 0 ? ref : undefined} checked={on} onChange={toggle} /> {o.label}
                    </label>
                  );
                })}
              </span>
            ) : f.kind === "aiStatus" ? (
              <select id={fid} ref={ref} className={styles.editInput} value={draft[f.path]} onChange={(e) => set(e.target.value)}>
                {f.value === null || f.value === undefined ? <option value="">Not set</option> : null}
                {(["forbidden", "permitted", "required"] as const).map((v) => <option key={v} value={v}>{AI_STATUS_LABEL[v]}</option>)}
              </select>
            ) : (
              <input id={fid} ref={ref} className={styles.editInput} type="text" maxLength={f.max} value={draft[f.path]} onChange={(e) => set(e.target.value)} />
            )}
            {f.hint ? <span className={styles.editHint}>{f.hint}</span> : null}
          </div>
        );
      })}
      {error ? <p className={styles.editError} role="alert">{error}</p> : null}
      <div className={styles.editActions}>
        <button type="button" className={styles.editCancel} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.editSave} disabled={disabled || saving}>{saving ? "Saving…" : saveLabel}</button>
      </div>
    </form>
  );
}
