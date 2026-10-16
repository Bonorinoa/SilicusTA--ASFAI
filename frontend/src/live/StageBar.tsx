/**
 * StageBar — what to do on this stage, in one place that does not scroll away: a status sentence, the one primary,
 * and the quiet secondaries. At 1100 px and up it sticks to the bottom of the window inside the stage column, so the
 * primary is in view the moment the stage opens, however tall the page is. Narrower, it is simply the foot of the stage.
 *
 * It holds no policy: the buttons are the page's own, and the host still decides what each one may do.
 */
import type { ReactNode } from "react";
import styles from "./Stage.module.css";

export function StageBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.bar} role="group" aria-label="This stage" data-stage-bar="true" data-print="hide">
      {status ? <p className={styles.barStatus}>{status}</p> : null}
      <div className={styles.barActions}>{children}</div>
    </div>
  );
}
