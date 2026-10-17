/**
 * CourseLibrary — your courses, and a way to start another. A renderer: it holds no policy and
 * decides nothing. It says honestly where each course stands, including a course whose record
 * does not verify (that one is flagged, never hidden).
 *
 * With a course open it is a menu button: the open course's name and a chevron, and the other courses one press away.
 * (It used to be a wide bordered box that read as an empty text field.) With no course open it is a plain list.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { CourseSummary } from "../gate/transport";
import styles from "./CourseLibrary.module.css";

function standing(c: CourseSummary): string {
  const p = c.progress;
  if (!p) return "";
  if ("error" in p) return p.error === "LOG_INTEGRITY" ? "needs attention: its record does not verify" : "needs attention: it could not be read";
  if (p.versions > 0) return `published, version ${p.versions}`;
  return `${p.confirmed} of ${p.total} checkpoints confirmed`;
}

type Props = {
  courses: CourseSummary[];
  currentId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
};

function Rows({ courses, currentId, busy, onPick, role }: { courses: CourseSummary[]; currentId: string | null; busy: boolean; onPick: (id: string) => void; role: "menuitem" | "button" }) {
  return (
    <>
      {courses.map((c) => {
        const isCurrent = c.courseId === currentId;
        const trouble = !!c.progress && "error" in c.progress;
        return (
          <li key={c.courseId} className={styles.row} role={role === "menuitem" ? "none" : undefined} data-current={isCurrent || undefined} data-trouble={trouble || undefined}>
            <button type="button" role={role === "menuitem" ? "menuitem" : undefined} className={styles.open} disabled={busy || isCurrent} onClick={() => onPick(c.courseId)}
              aria-label={isCurrent ? `${c.title} is open` : `Open ${c.title}`}>
              <span className={styles.rowBody}>
                <span className={styles.name}>{c.title}</span>
                <span className={styles.meta}>{c.owner}{standing(c) ? ` · ${standing(c)}` : ""}</span>
              </span>
              <span className={styles.state} aria-hidden="true">{isCurrent ? "Open now" : "Open"}</span>
            </button>
          </li>
        );
      })}
    </>
  );
}

export function CourseLibrary({ courses, currentId, busy, onOpen, onNew }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    // The first enabled item takes focus, so the keyboard lands inside the menu.
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (courses.length === 0) return null;

  // No course open: the list is the page's first thing, so it is a list, not a menu.
  if (currentId === null) {
    return (
      <section className={styles.library} aria-labelledby={`${menuId}-h`}>
        <h2 id={`${menuId}-h`} className={styles.summary}>Your courses ({courses.length})</h2>
        <ul className={styles.list} aria-label="Your courses">
          <Rows courses={courses} currentId={null} busy={busy} onPick={onOpen} role="button" />
        </ul>
        <button type="button" className={styles.newCourse} disabled={busy} onClick={onNew}>Start a new course</button>
      </section>
    );
  }

  const current = courses.find((c) => c.courseId === currentId) ?? null;
  const close = (refocus: boolean) => { setMenuOpen(false); if (refocus) trigger.current?.focus(); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length].focus(); };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at <= 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") setMenuOpen(false);
  };

  return (
    <div className={styles.menuWrap} ref={wrap} onKeyDown={menuOpen ? onKey : undefined}>
      <button type="button" ref={trigger} className={styles.trigger} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((o) => !o)}>
        <span className={styles.triggerKicker}>Course</span>
        <span className={styles.triggerName}>{current?.title ?? "Your courses"}</span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>
      {menuOpen ? (
        <div className={styles.menu}>
          <p className={styles.menuHead}>Your courses ({courses.length})</p>
          <ul id={menuId} role="menu" className={styles.list} aria-label="Your courses">
            <Rows courses={courses} currentId={currentId} busy={busy} onPick={(id) => { close(false); onOpen(id); }} role="menuitem" />
            <li role="none">
              <button type="button" role="menuitem" className={styles.newCourse} disabled={busy} onClick={() => { close(false); onNew(); }}>Start a new course</button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
