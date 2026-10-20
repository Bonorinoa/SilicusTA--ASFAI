/** Your courses: a card per course, one way to start a new one, and the trust promises said once. */
import { useEffect, useState } from "react";
import { BrowserRecord, type RecordStatus } from "../browser/BrowserRecord";
import { BROWSER_MODE } from "../gate/mode";
import { host, type CourseSummary } from "../gate/transport";
import { plural } from "../lib/plural";
import { TopBar, href } from "./StudioApp";
import { Skeleton } from "./ui";
import s from "./Studio.module.css";

/** The four teacher steps, read from the host's count of confirmed checkpoints (files and outline are the Brief). */
function stepsDone(p: CourseSummary["progress"]): number {
  if (!p || "error" in p) return 0;
  const c = p.confirmed;
  return c >= 5 || p.versions > 0 ? 4 : c >= 4 ? 3 : c >= 3 ? 2 : c >= 2 ? 1 : 0;
}
const NEXT = ["Brief", "Objectives", "Plan", "Publish"];

export function Home() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [recordStatus, setRecordStatus] = useState<RecordStatus>(null);

  const load = () => host.listCourses().then((r) => setCourses([...r.courses].sort((a, b) => b.createdAt - a.createdAt))).catch(() => setFailed(true));
  useEffect(() => { void load(); }, []);

  return (
    <>
      <TopBar right={<a className={s.crumb} href="#/live">Classic view</a>} />
      <main className={s.page}>
        <div className={s.pageHead}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className={s.kicker}>For teachers of learners aged 5–14</p>
            <h1 className={s.display}>Your courses</h1>
            <p className={s.lede}>Silicus proposes objectives and drafts a lesson plan. You decide every one, and only you publish.</p>
          </div>
        </div>

        {failed ? (
          <div className={s.empty} role="alert">
            <h2>This window can’t keep a record</h2>
            <p className={s.lede}>
              {BROWSER_MODE
                ? "This browser wouldn’t open its storage for Silicus. Private windows and some privacy settings block it; a regular window usually works."
                : "The Silicus host isn’t reachable. Start it with cd host && npm start, then reload."}
            </p>
          </div>
        ) : (
          <section aria-label="Courses" className={s.cards}>
            <a className={s.newCard} href={href.newCourse}>
              <span className={s.newPlus} aria-hidden="true">+</span>
              <span className={s.courseTitle}>New course</span>
              <span className={s.courseMeta}>Five short steps: the course, your sources, your objectives, an AI check, then you confirm.</span>
            </a>
            {courses === null
              ? [0, 1].map((i) => (
                <div key={i} className={s.courseCard} aria-hidden="true">
                  <Skeleton width="70%" height={20} />
                  <Skeleton width="40%" height={12} />
                  <div style={{ marginTop: "auto" }}><Skeleton height={4} /></div>
                </div>
              ))
              : courses.map((c, i) => {
                const broken = c.progress && "error" in c.progress;
                const done = stepsDone(c.progress);
                const versions = c.progress && !("error" in c.progress) ? c.progress.versions : 0;
                return (
                  <a key={c.courseId} className={s.courseCard} href={href.course(c.courseId)} data-rise style={{ animationDelay: `${i * 40}ms` }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className={s.courseTitle}>{c.title}</span>
                      <span className={s.courseMeta}>{c.owner} · started {new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className={s.progress} aria-hidden="true">
                      {NEXT.map((n, k) => <span key={n} className={s.progressSeg} data-done={k < done ? "true" : undefined} />)}
                    </div>
                    <div className={s.cardFoot}>
                      <span>{broken ? "Needs attention: this record doesn’t check out" : versions > 0 ? `Version ${versions} published` : `Next: ${NEXT[done] ?? "Publish"}`}</span>
                      <span aria-hidden="true">→</span>
                    </div>
                  </a>
                );
              })}
          </section>
        )}

        <section className={s.trust} aria-label="How Silicus keeps you in charge">
          <div className={s.trustItem}>
            <h2 className={s.trustTitle}>You decide, every time</h2>
            <p className={s.trustText}>The drafting model proposes. It never accepts an objective, confirms a plan or publishes. Each of your decisions is recorded.</p>
          </div>
          <div className={s.trustItem}>
            <h2 className={s.trustTitle}>Your files stay with you</h2>
            <p className={s.trustText}>Source text is read in this tab, sent once when you ask for a draft, and gone when you reload. Only file names go on the record.</p>
          </div>
          <div className={s.trustItem}>
            <h2 className={s.trustTitle}>Students aren’t graded here</h2>
            <p className={s.trustText}>The student helper answers only from what you published. It doesn’t grade or save questions.</p>
          </div>
          <div className={s.trustItem}>
            <h2 className={s.trustTitle}>{BROWSER_MODE ? "Kept in this browser" : "Kept on this computer"}</h2>
            <p className={s.trustText}>{plural(courses?.length ?? 0, "course")} here. Export a copy to keep it safe; clearing browser data starts empty.</p>
          </div>
        </section>

        {BROWSER_MODE ? <BrowserRecord hasCourses={(courses?.length ?? 0) > 0} onChanged={() => void load()} status={recordStatus} onStatus={setRecordStatus} /> : null}
      </main>
    </>
  );
}
