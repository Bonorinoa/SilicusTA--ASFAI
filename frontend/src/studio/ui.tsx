/** Studio primitives: one button system, badges, skeletons, an honest clock, dialogs on the native <dialog>. */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import s from "./ui.module.css";

type Variant = "primary" | "secondary" | "quiet" | "danger";

export function Button({ variant = "secondary", size, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "small" }) {
  return <button type="button" {...rest} className={[s.button, s[variant], size ? s.small : "", className ?? ""].join(" ")} />;
}

export function LinkButton({ variant = "secondary", size, href, children }: { variant?: Variant; size?: "small"; href: string; children: ReactNode }) {
  return <a href={href} className={[s.button, s[variant], size ? s.small : ""].join(" ")}>{children}</a>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "done" | "info" | "soon"; children: ReactNode }) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}

/** A feature that isn't built yet. Says so in a few words; opens nothing. */
export function Soon({ children = "Soon", title }: { children?: ReactNode; title?: string }) {
  return <span className={`${s.badge} ${s.soon}`} title={title}>{children}</span>;
}

export function Skeleton({ width = "100%", height = 14, radius }: { width?: number | string; height?: number; radius?: number }) {
  return <span aria-hidden="true" className={s.skeleton} style={{ width, height, borderRadius: radius }} />;
}

const fmt = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

/** A real clock since `startedAt`, and the usual range when the host reports one. Never a percentage. */
export function WaitClock({ startedAt, range }: { startedAt: number; range?: readonly [number, number] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  return (
    <span>
      <span className={s.clock}>{fmt(now - startedAt)}</span>
      {range ? <> · usually {range[0]}–{range[1]} s</> : null}
    </span>
  );
}

export function Notice({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className={s.notice} role="status">
      <span>{children}</span>
      {onClose ? <button type="button" className={s.noticeClose} onClick={onClose} aria-label="Dismiss">×</button> : null}
    </div>
  );
}

/** A modal on the native <dialog>: focus trap, Escape and the backdrop come with the element. */
export function Dialog({ open, onClose, label, children, drawer }: { open: boolean; onClose: () => void; label: string; children: ReactNode; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
      // React's autoFocus runs before showModal, which then moves focus; put it on the first field again.
      d.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=file]), textarea")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={drawer ? s.drawer : s.dialog}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open ? children : null}
    </dialog>
  );
}

export const ui = s;
