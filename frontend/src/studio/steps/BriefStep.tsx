/** Brief: the three questions are visible from the start; one primary confirms the source list (when there is one), saves the answers and confirms the brief. */
import { useEffect, useId, useState } from "react";
import { answerText } from "../../components/AiWaiting";
import { materialNamesOf } from "../../components/AiWaiting";
import { Button, ui } from "../ui";
import type { StepProps } from "../CourseStudio";
import { PasscodeNote } from "../PasscodeNote";
import { ActionBar } from "./ActionBar";
import s from "../Studio.module.css";

const LABELS: Record<string, { label: string; hint: string; placeholder: string }> = {
  topic: { label: "Topic", hint: "What this lesson is about.", placeholder: "How plants make food from sunlight" },
  course: { label: "Who it’s for", hint: "The class or course, and the learners’ age.", placeholder: "Grade 4 science, ages 9–10" },
  learning_outcomes: { label: "What learners should be able to do", hint: "One per line. Each can become an objective.", placeholder: "Explain how a plant makes its food" },
};

export function BriefStep({ c, view, worker, looking }: StepProps) {
  const filesOk = view.checkpoints.files?.status === "confirmed";
  const briefOk = view.checkpoints.outline?.status === "confirmed";
  const questions = view.intake.questions ?? [];
  const recorded = view.intake.answers ?? {};
  const names = materialNamesOf(view.course.materials);
  // Text added in this tab under a name the record doesn't list yet.
  const tabOnly = c.sources.filter((h) => !names.includes(h.name));

  const initial = () => {
    const a: Record<string, string> = {};
    for (const q of questions) {
      const v = recorded[q.id];
      a[q.id] = Array.isArray(v) ? v.join("\n") : answerText(v);
    }
    return a;
  };
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [fromSources, setFromSources] = useState(recorded.outcomes_from === "materials");
  const key = JSON.stringify(recorded) + questions.map((q) => q.id).join();
  useEffect(() => { setAnswers(initial()); setFromSources(recorded.outcomes_from === "materials"); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  const ids = useId();

  const needs = (id: string) => !(id === "learning_outcomes" && fromSources);
  const complete = questions.length > 0 && questions.every((q) => !needs(q.id) || (answers[q.id] ?? "").trim() !== "");
  const dirty = questions.some((q) => (answers[q.id] ?? "") !== (initial()[q.id] ?? "")) || fromSources !== (recorded.outcomes_from === "materials");
  // Nothing typed since the last save, and every question has an answer on the record.
  const saved = complete && !dirty;
  const editable = !briefOk && !looking;

  const save = () => void c.actions.answerBrief(out());

  /** The answers to record as one intent: everything complete, trimmed, plus the outcomes choice. */
  const out = (): Record<string, string> => {
    const a: Record<string, string> = {};
    for (const q of questions) if (needs(q.id) && (answers[q.id] ?? "").trim()) a[q.id] = answers[q.id].trim();
    if (fromSources) a.outcomes_from = "materials";
    return a;
  };

  let bar: React.ReactNode = null;
  if (!looking && !briefOk) {
    const listed = names.length + tabOnly.length > 0;
    // The source-list sentence is only ever about a real list; with nothing added it says so.
    const sourceNote = listed
      ? <><strong>Start with your sources.</strong> Is this list right? You can add the files themselves on the left.</>
      : <><strong>No sources yet.</strong> That's fine — your answers alone can brief Silicus. Add files on the left whenever you want.</>;
    const confirm = () => void c.actions.confirmTheBrief(dirty ? out() : null, { sources: !filesOk });
    if (!complete) {
      bar = <ActionBar text="Answer each question to continue.">
        <Button variant="primary" data-primary="true" disabled>Confirm the brief</Button>
      </ActionBar>;
    } else if (dirty) {
      bar = <ActionBar text={filesOk ? <><strong>Your answers aren't saved yet.</strong> Confirming the brief records them first.</> : sourceNote}>
        <Button variant="quiet" disabled={c.busy} onClick={save}>Save answers</Button>
        <Button variant="primary" data-primary="true" disabled={c.busy} onClick={confirm}>Confirm the brief</Button>
      </ActionBar>;
    } else {
      bar = <ActionBar text={filesOk ? <><strong>Your answers are saved.</strong> Confirm the brief to move on to objectives.</> : sourceNote}>
        <Button variant="primary" data-primary="true" disabled={c.busy} onClick={confirm}>Confirm the brief</Button>
      </ActionBar>;
    }
  }

  return (
    <div className={s.doc}>
      <div className={s.docInner}>
        <header className={s.docHead}>
          <p className={s.kicker}>Step 1 of 4</p>
          <h1 className={s.docTitle}>The brief</h1>
          <p className={s.docLede}>Your own words about the lesson. Silicus drafts from these, and only from what you confirm.</p>
        </header>

        <PasscodeNote worker={worker} />

        <section className={s.card} aria-label="Sources">
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Sources</h2>
            {filesOk ? <span className={s.summaryDone}>✓ Confirmed</span> : null}
          </div>
          {names.length + tabOnly.length ? (
            <ul className={s.sourceList}>
              {names.map((n) => <li key={n} className={s.checkRow} style={{ padding: "6px 0" }}><span className={s.check} aria-hidden="true">{filesOk ? "✓" : "·"}</span>{n}</li>)}
              {tabOnly.map((h) => (
                <li key={`t-${h.name}`} className={s.checkRow} style={{ padding: "6px 0" }}>
                  <span className={s.check} aria-hidden="true" style={{ background: "transparent", border: "1px dashed var(--fn-line-dash)" }}>·</span>
                  <span>{h.name}<br /><span className={s.provenance}>Text in this tab. Its name goes on the record when Silicus reads it.</span></span>
                </li>
              ))}
            </ul>
          ) : <p className={s.docLede}>No sources yet. That’s fine: objectives can come from your answers.</p>}
        </section>

        <section className={s.card} aria-label="Questions" data-rise>
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Three questions</h2>
            {briefOk ? <span className={s.summaryDone}>✓ Confirmed</span> : saved ? <span className={s.provenance}>Saved</span> : null}
          </div>
          {questions.map((q) => {
            const l = LABELS[q.id] ?? { label: q.prompt, hint: q.reason ?? "", placeholder: "" };
            const outcomes = q.id === "learning_outcomes";
            return (
              <div key={q.id} className={ui.field}>
                <label className={ui.label} htmlFor={`${ids}-${q.id}`}>{l.label}</label>
                {outcomes ? (
                  <>
                    <textarea id={`${ids}-${q.id}`} className={ui.textarea} rows={3} placeholder={l.placeholder} disabled={!editable || fromSources}
                      value={fromSources ? "" : answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                    <label className={s.checkRow} style={{ fontSize: "0.875rem", color: "var(--fn-ink-soft)" }}>
                      <input type="checkbox" checked={fromSources} disabled={!editable} onChange={(e) => setFromSources(e.target.checked)} />
                      Let Silicus propose these from my sources instead
                    </label>
                  </>
                ) : (
                  <input id={`${ids}-${q.id}`} className={ui.input} placeholder={l.placeholder} disabled={!editable}
                    value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                )}
                <span className={ui.hint}>{l.hint}</span>
              </div>
            );
          })}
          {questions.length === 0 ? <p className={s.docLede}>Waiting for the questions…</p> : null}
        </section>

        {bar}
      </div>
    </div>
  );
}
