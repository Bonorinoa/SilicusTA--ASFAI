/**
 * PublishedMoment — the top of the published page: ONE status sentence, in the glossary's words (replacing the three
 * sentences that used to say "published"). The page then reads in a fixed order: this line, the lesson plan, the
 * student helper, and last the actions (the stage bar). Who published it and when is the plan's own signature.
 */
import type { PackageVersionView } from "../gate/types";
import styles from "./Stage.module.css";

export const publishedStatus = (version: number): string =>
  `Version ${version} is published. Students use this version; changes become version ${version + 1}.`;

export function PublishedMoment({ version }: { version: PackageVersionView }) {
  return (
    <section className={styles.moment} aria-label="Published">
      <p className={styles.momentTitle} role="status">{publishedStatus(version.version)}</p>
    </section>
  );
}
