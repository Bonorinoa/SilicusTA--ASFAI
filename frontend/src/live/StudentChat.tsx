/**
 * StudentChat — "Try the student helper". Asks the host about the PUBLISHED version and shows what each answer
 * rests on. It is use, never evidence: the host records nothing, and neither does this component (the conversation
 * lives in memory and is gone on reload).
 *
 * Words come from docs/design/glossary.md: the scope line sits above the input, the label under an answer follows
 * its `basis`, and a refusal is one of two fixed sentences chosen by `refusal`. Nothing here implies the AI decided
 * anything about a student: the helper explains and points; it never judges.
 */
import { useId, useRef, useState } from "react";
import { AiWaiting, type WaitingPhase, type WaitingStep } from "../components/AiWaiting";
import { plural } from "../lib/plural";
import { host, type StudentAnswer } from "../gate/transport";
import chatStyles from "./OnboardingChat.module.css";
import styles from "./StudentChat.module.css";

interface Turn { role: "student" | "assistant"; text: string; answer?: StudentAnswer }

/** The published version a student is answered from, as the page already holds it (counts only: used to say what the model sees). */
export interface SealedSummary { version: number; title: string; objectives: number; activities: number }

/** Glossary: the two refusal sentences. The host sends the same strings; the page picks by `refusal`, so an old host cannot bring back "yet". */
export const REFUSAL_TEXT = {
  off_topic: "That isn't part of this lesson. Ask your teacher.",
  assessment: "I can't tell you how you're doing. Your teacher decides that.",
} as const;

/** The scope line, always above the input. Counts come from the published version. */
export const scopeLine = (s: SealedSummary): string =>
  `Answers only from version ${s.version} of this lesson: ${plural(s.objectives, "objective")} and ${plural(s.activities, "activity", "activities")}. It has not read your materials, and nothing a student asks is saved.`;

/** What an answer rests on, by basis. An unknown basis is read as the hedged one. */
export function basisLabel(a: StudentAnswer): string {
  const labels = a.cites.map((c) => c.label);
  if (a.basis === undefined || a.basis === "plan") return `From ${labels.join(" \u00b7 ")}`;
  return `Explains an idea in ${labels.join(" and ")}. The explanation is the AI's, not your plan's words.`;
}

export function StudentChat({ courseId, courseTitle, sealed, typicalSeconds, zdr = null, paused = false, inputId, open = false, onOpenChange, onWorking }: {
  /** Lets the page put the cursor in the question box (\"Try the student helper\"). */
  inputId?: string;
  /** The helper is collapsed until the teacher opens it; the page may open it (its primary button does). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Told when an answer is being drafted (and when it is not), so the page's rail can say who is working. */
  onWorking?: (w: { label: string; startedAt: number } | null) => void;
  courseId: string;
  courseTitle: string;
  sealed?: SealedSummary;
  /** The worker status's optional `typicalSeconds` (defaults apply when absent). */
  typicalSeconds?: unknown;
  zdr?: boolean | null;
  /** The passcode dialog is open: the clock holds. */
  paused?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState<{ n: number; step: WaitingStep; phase: WaitingPhase } | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const asks = useRef(0);
  const id = useId();
  const isOpen = onOpenChange ? open : localOpen;
  const toggle = (next: boolean) => (onOpenChange ?? setLocalOpen)(next);

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setError(null); setQ("");
    onWorking?.({ label: sealed ? `Answering from version ${sealed.version} of this lesson` : "Answering a student's question", startedAt: Date.now() });
    const history = turns.map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: "student", text: question }]);
    const n = (asks.current += 1);
    if (sealed) setWait({ n, step: { kind: "answer", question, earlierTurns: history.length, ...sealed }, phase: "running" });
    const end = (phase: WaitingPhase) => setWait((w) => (w && w.n === n ? { ...w, phase } : w));
    try {
      const a = await host.askStudent(courseId, { question, history });
      // A refusal is one of two fixed sentences, chosen by its kind; the host's own text is not trusted to be current.
      const text = a.grounded ? a.answer : a.refusal === "assessment" ? REFUSAL_TEXT.assessment : REFUSAL_TEXT.off_topic;
      setTurns((t) => [...t, { role: "assistant", text, answer: a }]);
      end("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      end("failed");
    } finally {
      setBusy(false);
      onWorking?.(null);
    }
  };

  return (
    <section className={styles.helper} aria-label="Try the student helper">
      <details open={isOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== isOpen) toggle(o); }}>
        <summary className={styles.summary}>Try the student helper</summary>
        <div className={styles.body}>
          <p className={chatStyles.kept}>
            Ask it about “{courseTitle}” as a student would. Asking here is not evidence of learning.
          </p>
          {sealed ? <p className={styles.scope}>{scopeLine(sealed)}</p> : null}
          <ol className={chatStyles.turns}>
            {turns.map((t, i) => (
              <li key={i} className={chatStyles.pair}>
                <p className={chatStyles.you}>{t.role === "student" ? "Student" : "Student helper"}</p>
                <p className={chatStyles.said}>{t.text}</p>
                {t.answer?.grounded ? <p className={styles.basis} data-basis={t.answer.basis ?? "plan"}>{basisLabel(t.answer)}</p> : null}
              </li>
            ))}
          </ol>
          {wait ? <AiWaiting key={wait.n} variant="compact" step={wait.step} phase={wait.phase} typicalSeconds={typicalSeconds} zdr={zdr} paused={paused} /> : null}
          <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <label className={chatStyles.prompt} htmlFor={inputId ?? id}>Your question</label>
            <div className={styles.askRow}>
              <input id={inputId ?? id} className={chatStyles.box} type="text" value={q} maxLength={800} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
              <button type="submit" className={styles.ask} disabled={busy || !q.trim()}>Ask</button>
            </div>
          </form>
          {error ? <p className={chatStyles.refusal} role="status">{error}</p> : null}
        </div>
      </details>
    </section>
  );
}
