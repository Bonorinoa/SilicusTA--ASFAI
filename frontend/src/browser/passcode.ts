/**
 * passcode.ts — the site's demo passcode, held for this tab only.
 *
 * The passcode gates the two site functions (the model proxy and the link reader). It lives in
 * sessionStorage under one key and nowhere else: never localStorage, never IndexedDB, never a log line,
 * never a course record. Closing the tab forgets it. A refusal (401) clears it so the teacher is asked again.
 *
 * Asking is the UI's job: it registers a prompt (PasscodeDialog). With no prompt registered the answer is
 * "no passcode", and the AI action is refused with a plain message — nothing is sent.
 */
export const PASSCODE_KEY = "silicus.demoPasscode";

export type PasscodeReason = "needed" | "rejected";
export type PasscodePrompt = (reason: PasscodeReason) => Promise<string | null>;

let prompt: PasscodePrompt | null = null;

/** The UI registers how to ask. Returns an unregister function. */
export function setPasscodePrompt(fn: PasscodePrompt | null): () => void {
  prompt = fn;
  return () => { if (prompt === fn) prompt = null; };
}

export interface PasscodeKeeper {
  get(): string | null;
  set(code: string): void;
  clear(): void;
  ask(reason: PasscodeReason): Promise<string | null>;
}

/** @param storage the tab's sessionStorage (injectable for tests). */
export function passcodeKeeper(storage: () => Storage | null = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } }): PasscodeKeeper {
  const keeper: PasscodeKeeper = {
    get() {
      try { return storage()?.getItem(PASSCODE_KEY) || null; } catch { return null; }
    },
    set(code: string) {
      try { storage()?.setItem(PASSCODE_KEY, code); } catch { /* storage refused: the code is used once and not kept */ }
    },
    clear() {
      try { storage()?.removeItem(PASSCODE_KEY); } catch { /* nothing to clear */ }
    },
    async ask(reason: PasscodeReason) {
      if (!prompt) return null;
      const code = (await prompt(reason))?.trim() || null;
      if (code) keeper.set(code);
      return code;
    },
  };
  return keeper;
}
