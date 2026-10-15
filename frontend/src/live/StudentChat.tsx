/**
 * StudentChat — "try it as a student". Asks the host about the PUBLISHED package and shows what
 * each answer rests on. It is use, never evidence: the host records nothing, and neither does this
 * component (the conversation lives in memory and is gone on reload).
 */
import { useId, useState } from "react";
import { host, type StudentAnswer } from "../gate/transport";
import styles from "./OnboardingChat.module.css";

interface Turn { role: "student" | "assistant"; text: string; answer?: StudentAnswer }

export function StudentChat({ courseId, courseTitle }: { courseId: string; courseTitle: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setError(null); setQ("");
    const history = turns.map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: "student", text: question }]);
    try {
      const a = await host.askStudent(courseId, { question, history });
      setTurns((t) => [...t, { role: "assistant", text: a.answer, answer: a }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
      <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <label className={styles.prompt} htmlFor={id}>Your question</label>
        <input id={id} className={styles.box} type="text" value={q} maxLength={800} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className={styles.send} disabled={busy || !q.trim()}>Ask</button>
      </form>
      {error ? <p className={styles.refusal} role="status">{error}</p> : null}
    </section>
  );
}
