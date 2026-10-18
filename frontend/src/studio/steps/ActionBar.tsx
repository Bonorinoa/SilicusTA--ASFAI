import type { ReactNode } from "react";
import s from "../Studio.module.css";

/** The one place a step's next act lives: a sentence on the left, the act on the right. */
export function ActionBar({ text, children }: { text: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.actionBar}>
      <div className={s.actionInner}>
        <p className={s.actionText}>{text}</p>
        {children ? <div className={s.actionButtons}>{children}</div> : null}
      </div>
    </div>
  );
}
