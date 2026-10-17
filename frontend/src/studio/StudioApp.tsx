/**
 * StudioApp — the redesigned teacher and student destinations (direction A, "Field notes").
 *
 *   #/studio               your courses
 *   #/studio/<id>          the course studio: Brief → Objectives → Plan → Publish
 *   #/studio/<id>/rehearse the teacher's student simulator
 *   #/learn/<id>           the student space
 *
 * Routes live in ./route.ts. It runs beside the original #/live page until it reaches parity; both are thin clients of the same host.
 */
import { useEffect, useState, type ReactNode } from "react";
import { BROWSER_MODE } from "../gate/mode";
import { PasscodeDialog } from "../browser/PasscodeDialog";
import { Home } from "./Home";
import { CourseStudio } from "./CourseStudio";
import { Rehearse } from "./Rehearse";
import { Learn } from "./Learn";
import "./studio.css";
import { href, routeOf, type Route } from "./route";
import s from "./Studio.module.css";

export { href };

export function StudioApp() {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.hash) ?? { page: "home" });
  useEffect(() => {
    const on = () => { const r = routeOf(window.location.hash); if (r) { setRoute(r); window.scrollTo?.(0, 0); } };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  return (
    <div className="studio">
      {BROWSER_MODE ? <PasscodeDialog /> : null}
      {route.page === "home" ? <Home /> : null}
      {route.page === "course" ? <CourseStudio key={route.id} courseId={route.id} /> : null}
      {route.page === "rehearse" ? <Rehearse key={route.id} courseId={route.id} /> : null}
      {route.page === "learn" ? <Learn key={route.id} courseId={route.id} /> : null}
    </div>
  );
}

export function Wordmark() {
  return (
    <a className={s.wordmark} href={href.home} aria-label="Silicus, your courses">
      <span className={s.mark} aria-hidden="true"><span className={s.markLines}><span /><span style={{ width: "75%" }} /><span style={{ width: "45%" }} /></span></span>
      <span className={s.wordmarkName}>Silicus</span>
    </a>
  );
}

export function TopBar({ crumbs = [], center, right }: { crumbs?: { label: string; href?: string }[]; center?: ReactNode; right?: ReactNode }) {
  return (
    <header className={s.topbar}>
      <nav className={s.brand} aria-label="Breadcrumb">
        <Wordmark />
        {crumbs.map((c) => (
          <span key={c.label} style={{ display: "contents" }}>
            <span className={s.crumbSep} aria-hidden="true">/</span>
            {c.href ? <a className={s.crumb} href={c.href}>{c.label}</a> : <span className={s.crumb} aria-current="page">{c.label}</span>}
          </span>
        ))}
      </nav>
      {center}
      <div className={s.topRight}>{right}</div>
    </header>
  );
}
