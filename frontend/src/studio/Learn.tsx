/**
 * Learn — the student space for a published version. Built for ages 5–14: what we're learning, what we'll do,
 * and a helper that answers only from the published version. Nothing typed here is saved or graded.
 * Today it reads this browser's copy, so it's labelled as a preview until versions can be reached elsewhere.
 */
import { useEffect, useRef, useState } from "react";
import { host, type HostView, type StudentAnswer } from "../gate/transport";
import { href } from "./StudioApp";
import { Skeleton } from "./ui";
import s from "./Studio.module.css";

const kid = (statement: string) => statement.replace(/^(students|learners)\s+(can|will)\s+/i, "").replace(/^./, (c) => c.toUpperCase()).replace(/\.$/, "");

export function Learn({ courseId }: { courseId: string }) {
  const [view, setView] = useState<HostView | null | "missing">(null);
  const [turns, setTurns] = useState<{ q: string; a?: StudentAnswer; error?: string }[]>([]);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { void host.getCourse(courseId).then(setView).catch(() => setView("missing")); }, [courseId]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [turns.length, asking]);

  const v = view && view !== "missing" ? view : null;
  const version = v?.versions.at(-1) ?? null;

  const ask = async () => {
    const question = q.trim();
    if (!question || asking) return;
    setQ("");
    const i = turns.length;
    setTurns((t) => [...t, { q: question }]);
    setAsking(true);
    try {
      const history = turns.flatMap((t) => (t.a ? [{ role: "student" as const, text: t.q }, { role: "assistant" as const, text: t.a.answer }] : [])).slice(-6);
      const a = await host.askStudent(courseId, { question: question.slice(0, 800), history });
      setTurns((t) => t.map((x, k) => (k === i ? { ...x, a } : x)));
    } catch {
      setTurns((t) => t.map((x, k) => (k === i ? { ...x, error: "Silicus couldn’t answer just now. Try again in a moment." } : x)));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className={s.learn}>
      <div className={s.learnRibbon}>
        <span>Preview on this device. Students can’t open this link yet.</span>
        <a href={href.course(courseId)} style={{ color: "inherit" }}>Back to the studio</a>
      </div>

      {view === "missing" || (v && !version) ? (
        <main className={s.learnMain}><h1 style={{ fontFamily: "var(--fn-serif)" }}>Nothing to learn here yet</h1><p>Your teacher hasn’t published this lesson.</p></main>
      ) : (
        <>
          <header className={s.learnHero}>
            <div className={s.learnHeroInner}>
              {version ? (
                <>
                  <span style={{ opacity: 0.85, fontSize: "0.875rem" }}>{version.owner}</span>
                  <h1>{version.title}</h1>
                  <span style={{ opacity: 0.85, fontSize: "0.875rem" }}>
                    {version.lessonPlan ? `${version.lessonPlan.activities.reduce((n, a) => n + a.minutes, 0)} minutes · ${version.lessonPlan.activities.length} activities` : null}
                  </span>
                </>
              ) : <><Skeleton width="30%" height={12} /><Skeleton width="70%" height={34} /></>}
            </div>
          </header>
          <main className={s.learnMain}>
            <section style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="goals">
              <h2 id="goals" className={s.learnLabel}>Today we’re learning to…</h2>
              {(version?.objectiveRefs ?? []).map((o, i) => (
                <div key={o.id} className={s.goal} data-rise style={{ animationDelay: `${i * 60}ms` }}><span className={s.goalNum}>{i + 1}</span><span>{kid(o.statement ?? "")}</span></div>
              ))}
            </section>
            {version?.lessonPlan ? (
              <section style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="doing">
                <h2 id="doing" className={s.learnLabel}>What we’ll do</h2>
                {version.lessonPlan.activities.map((a) => (
                  <div key={a.id} className={s.activity}>
                    <span className={s.activityTitle}><span>{a.title}</span><span style={{ fontWeight: 400, color: "#8a7b68" }}>{a.minutes} min</span></span>
                    <span>{a.learnerDoes}</span>
                  </div>
                ))}
              </section>
            ) : null}
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-labelledby="ask" aria-live="polite">
              <h2 id="ask" className={s.learnLabel}>Ask Silicus</h2>
              {turns.length === 0 ? <p style={{ color: "#6a5a46" }}>Stuck on a word or an idea from today’s lesson? Ask here.</p> : null}
              {turns.map((t, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <div className={s.learnQ}>{t.q}</div>
                  {t.a ? (
                  <div className={s.learnA}>
                    {t.a.answer}
                    {t.a.grounded && t.a.cites.length > 0 ? (
                      <span className={s.learnSource}>
                        <span>From the lesson: {t.a.cites.map((c) => c.label).join(" · ")}</span>
                        {t.a.basis === "explanation" ? <span>Silicus is explaining an idea your lesson names.</span> : null}
                      </span>
                    ) : null}
                  </div>
                ) : t.error ? <div className={s.learnA}>{t.error}</div> : null}
                </div>
              ))}
              {asking ? <div className={s.typing} aria-label="Silicus is thinking"><span /><span /><span /></div> : null}
              {/* Room for the fixed composer, so the newest answer scrolls clear of it. */}
              <div ref={end} style={{ scrollMarginBottom: 140 }} />
            </section>
          </main>
          <div className={s.learnAsk}>
            <div className={s.learnAskInner}>
              <form className={s.learnForm} onSubmit={(e) => { e.preventDefault(); void ask(); }}>
                <label style={{ display: "contents" }}>
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Your question</span>
                  <input className={s.learnInput} value={q} maxLength={800} onChange={(e) => setQ(e.target.value)} placeholder="Ask about today’s lesson" disabled={!version} />
                </label>
                <button type="submit" className={s.learnSend} disabled={!q.trim() || asking || !version}>Ask</button>
              </form>
              <p className={s.learnNote}>Your questions aren’t saved, and they aren’t a test.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
