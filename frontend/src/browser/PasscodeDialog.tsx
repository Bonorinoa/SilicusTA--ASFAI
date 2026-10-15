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

export function PasscodeDialog() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), input: useId(), note: useId() };

  useEffect(() => setPasscodePrompt((reason) => new Promise<string | null>((resolve) => { setCode(""); setAsk({ reason, resolve }); })), []);
  useEffect(() => { if (ask) input.current?.focus(); }, [ask]);

  if (!ask) return null;
  const finish = (value: string | null) => { ask.resolve(value); setAsk(null); setCode(""); };

  return (
    <div className={styles.scrim}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={ids.title} aria-describedby={ids.note}
        onKeyDown={(e) => { if (e.key === "Escape") finish(null); }}>
        <h2 id={ids.title} className={styles.title}>Demo passcode</h2>
        <p id={ids.note} className={styles.note}>
          {ask.reason === "rejected"
            ? "That passcode was not accepted, so nothing was sent. Check it and try again."
            : "AI drafting on this site is open to people with the demo passcode. It is kept in this tab only and forgotten when you close it."}
        </p>
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); if (code.trim()) finish(code.trim()); }}>
          <label className={styles.label} htmlFor={ids.input}>Passcode</label>
          <input id={ids.input} ref={input} className={styles.box} type="password" autoComplete="off" spellCheck={false}
            value={code} onChange={(e) => setCode(e.target.value)} />
          <div className={styles.verbs}>
            <button type="submit" className={styles.primary} disabled={!code.trim()}>Continue</button>
            <button type="button" className={styles.quiet} onClick={() => finish(null)}>Not now</button>
          </div>
        </form>
      </section>
    </div>
  );
}
