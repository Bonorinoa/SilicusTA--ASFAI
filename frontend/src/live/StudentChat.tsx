/**
 * StudentChat — "try it as a student". Asks the host about the PUBLISHED package and shows what
 * each answer rests on. It is use, never evidence: the host records nothing, and neither does this
 * component (the conversation lives in memory and is gone on reload).
 */
import { useId, useRef, useState } from "react";
import { AiWaiting, type WaitingPhase, type WaitingStep } from "../components/AiWaiting";
import { host, type StudentAnswer } from "../gate/transport";
import styles from "./OnboardingChat.module.css";

interface Turn { role: "student" | "assistant"; text: string; answer?: StudentAnswer }

/** The sealed package a student is answered from, as the page already holds it (counts only: used to say what the model sees). */
export interface SealedSummary { version: number; title: string; objectives: number; activities: number }

export function StudentChat({ courseId, courseTitle, sealed, typicalSeconds, zdr = null, paused = false, inputId, onWorking }: {
  /** Lets the page put the cursor in the question box ("Try it as a student"). */
  inputId?: string;
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
  const asks = useRef(0);
  const id = useId();

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setError(null); setQ("");
    onWorking?.({ label: "Answering a question from your sealed version", startedAt: Date.now() });
    const history = turns.map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: "student", text: question }]);
    const n = (asks.current += 1);
    if (sealed) setWait({ n, step: { kind: "answer", question, earlierTurns: history.length, ...sealed }, phase: "running" });
    const end = (phase: WaitingPhase) => setWait((w) => (w && w.n === n ? { ...w, phase } : w));
    try {
      const a = await host.askStudent(courseId, { question, history });
      setTurns((t) => [...t, { role: "assistant", text: a.answer, answer: a }]);
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
    <section className={styles.thread} aria-label="Try it as a student">
      <p className={styles.status}>Try it as a student</p>
      <p className={styles.kept}>
        Ask about “{courseTitle}”. Answers come only from the version you published, and say what they rest on.
        Asking here is not evidence of learning, and nothing you ask is saved.
      </p>
      <ol className={styles.turns}>
        {turns.map((t, i) => (
          <li key={i} className={styles.pair}>
            <p className={styles.you}>{t.role === "student" ? "You" : "Silicus"}</p>
            <p className={styles.said}>{t.text}</p>
            {t.answer ? (
              <p className={styles.kept}>
                {t.answer.grounded ? `From ${t.answer.cites.map((c) => c.label).join(", ")}.` : "Not covered by this course."}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {wait ? <AiWaiting key={wait.n} variant="compact" step={wait.step} phase={wait.phase} typicalSeconds={typicalSeconds} zdr={zdr} paused={paused} /> : null}
      <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <label className={styles.prompt} htmlFor={inputId ?? id}>Your question</label>
        <input id={inputId ?? id} className={styles.box} type="text" value={q} maxLength={800} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className={styles.quiet} disabled={busy || !q.trim()}>Ask</button>
      </form>
      {error ? <p className={styles.refusal} role="status">{error}</p> : null}
    </section>
  );
}
