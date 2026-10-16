/**
 * PublishedMoment — the page at the end of the course: the sealed version, who sealed it and when, then the three
 * things a teacher does next, in order: try it as a student, hand out the handout, export the package.
 * Revising is the quiet option (it is the RevisionPanel, passed in), never the loudest.
 */
import type { ReactNode } from "react";
import type { PackageVersionView } from "../gate/types";
import styles from "./Stage.module.css";

const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

export function PublishedMoment({ version, teacher, busy, onTry, onHandout, onExport, children }: {
  version: PackageVersionView;
  teacher: string;
  busy: boolean;
  onTry: () => void;
  onHandout: () => void;
  onExport: () => void;
  /** The revision panel, bare: it brings its own "Revise this course". */
  children?: ReactNode;
}) {
  return (
    <section className={styles.moment} aria-label="Published">
      <p className={styles.momentKicker}>Published</p>
      <h2 className={styles.momentTitle}>Version {version.version} is published</h2>
      <p className={styles.momentLine}>
        Sealed {new Date(version.publishedAt).toLocaleDateString("en-GB", DATE)} by {teacher}. Students read this version.
      </p>
      <div className={styles.momentActions}>
        <button type="button" className={styles.primary} data-primary="true" onClick={onTry}>Try it as a student</button>
        <button type="button" className={styles.ghost} onClick={onHandout} disabled={busy}>Download the student handout</button>
        <button type="button" className={styles.ghost} onClick={onExport} disabled={busy}>Export the package</button>
      </div>
      {children}
    </section>
  );
}
