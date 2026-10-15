/**
 * PasscodeDialog — asks for the site's demo passcode, only when an AI action needs it.
 *
 * Registers itself as the browser host's passcode prompt (passcode.ts). The code typed here goes to
 * sessionStorage and into one request header; it is never written anywhere else and never logged. A refusal
 * (the site answered 401) brings this back with a plain "not accepted" line. "Not now" sends nothing.
 */
import { useEffect, useId, useRef, useState } from "react";
import { setPasscodePrompt, type PasscodeReason } from "./passcode";
import styles from "./PasscodeDialog.module.css";

interface Ask { reason: PasscodeReason; resolve: (code: string | null) => void }

export function PasscodeDialog({ onAsking }: { onAsking?: (asking: boolean) => void } = {}) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const ids = { title: useId(), input: useId(), note: useId() };

  useEffect(() => setPasscodePrompt((reason) => new Promise<string | null>((resolve) => { setCode(""); setAsk({ reason, resolve }); })), []);
  // Focus goes into the dialog, stays in it, and returns to where it was when the dialog closes.
  useEffect(() => {
    if (ask) { opener.current = document.activeElement; input.current?.focus(); }
    else if (opener.current) { (opener.current as HTMLElement).focus?.(); opener.current = null; }
  }, [ask]);
  // The waiting card holds its clock while the teacher, not the model, is the one being waited for.
  useEffect(() => { onAsking?.(ask !== null); }, [ask, onAsking]);

  if (!ask) return null;
  const finish = (value: string | null) => { ask.resolve(value); setAsk(null); setCode(""); };

  return (
    <div className={styles.scrim}>
      <section ref={sheet} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={ids.title} aria-describedby={ids.note}
        onKeyDown={(e) => {
          if (e.key === "Escape") { finish(null); return; }
          if (e.key !== "Tab") return;
          const stops = Array.from(sheet.current?.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])") ?? []);
          if (stops.length === 0) return;
          const [first, last] = [stops[0], stops[stops.length - 1]];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}>
        <p className={styles.eyebrow}>Before the AI drafts</p>
        <h2 id={ids.title} className={styles.title}>Demo passcode</h2>
        <p id={ids.note} className={styles.note}>
          {ask.reason === "rejected"
            ? "That passcode was not accepted, so nothing was sent. Check it and try again."
            : "AI drafting on this site is open to people with the demo passcode. It is kept in this tab only and forgotten when you close it."}
        </p>
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); if (code.trim()) finish(code.trim()); }}>
          <label className={styles.label} htmlFor={ids.input}>Passcode</label>
          <input id={ids.input} ref={input} className={styles.box} type="password" name="demo-passcode" autoComplete="off" spellCheck={false}
            value={code} onChange={(e) => setCode(e.target.value)} />
          <div className={styles.verbs}>
            <button type="submit" className={styles.primary} disabled={!code.trim()}>Continue</button>
            <button type="button" className={styles.quiet} onClick={() => finish(null)}>Not now</button>
          </div>
        </form>
        <p className={styles.fine}>
          {ask.reason === "rejected" ? "Nothing was sent. " : ""}Choosing Not now sends nothing, and everything you have recorded stays as it is.
        </p>
      </section>
    </div>
  );
}
