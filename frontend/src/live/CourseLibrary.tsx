/**
 * CourseLibrary — your courses, and a way to start another. A renderer: it holds no policy and
 * decides nothing. It says honestly where each course stands, including a course whose record
 * does not verify (that one is flagged, never hidden).
 */
import type { CourseSummary } from "../gate/transport";
import styles from "./CourseLibrary.module.css";

function standing(c: CourseSummary): string {
  const p = c.progress;
  if (!p) return "";
  if ("error" in p) return p.error === "LOG_INTEGRITY" ? "needs attention: its record does not verify" : "needs attention: it could not be read";
  if (p.versions > 0) return `published, version ${p.versions}`;
  return `${p.confirmed} of ${p.total} checkpoints confirmed`;
}

export function CourseLibrary({
  courses, currentId, busy, onOpen, onNew, open = false,
}: {
  courses: CourseSummary[];
  currentId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Start expanded (used when no course is open yet). */
  open?: boolean;
}) {
  if (courses.length === 0) return null;
  return (
    <details className={styles.library} open={open}>
      <summary className={styles.summary}>Your courses ({courses.length})</summary>
      <ul className={styles.list} aria-label="Your courses">
        {courses.map((c) => {
          const isCurrent = c.courseId === currentId;
          const trouble = !!c.progress && "error" in c.progress;
          return (
            <li key={c.courseId} className={styles.row} data-current={isCurrent || undefined} data-trouble={trouble || undefined}>
              <div>
                <p className={styles.name}>{c.title}</p>
                <p className={styles.meta}>{c.owner}{standing(c) ? ` · ${standing(c)}` : ""}</p>
              </div>
              <button type="button" className={styles.open} disabled={busy || isCurrent} onClick={() => onOpen(c.courseId)}
                aria-label={isCurrent ? `${c.title} is open` : `Open ${c.title}`}>
                {isCurrent ? "Open now" : "Open"}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className={styles.newCourse} disabled={busy} onClick={onNew}>Start a new course</button>
    </details>
  );
}
