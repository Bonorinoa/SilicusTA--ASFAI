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

/**
 * The observable "asking" seam (B1). While a prompt is pending the teacher is typing and the model is NOT
 * working, so the studio holds its wait clock: the step reads this as its own phase ("Waiting for your
 * passcode", no clock) and starts the clock when the prompt resolves. Prompts can overlap (two AI actions
 * each asking), so the seam counts open prompts internally and only ever exposes the BOOLEAN "is any prompt
 * open": the value never travels with it, is never logged, and is never stored anywhere but the one
 * sessionStorage key. Any keeper drives the same module-level state, so the transport, the studio and the
 * dialog agree.
 */
let askCount = 0;
let asking = false;
const askingListeners = new Set<(asking: boolean) => void>();

/** Current asking state: at least one passcode prompt is pending. */
export function passcodeAsking(): boolean {
  return askCount > 0;
}

/** Subscribe to asking-state changes (true while any prompt is pending). Returns an unsubscribe function. */
export function onPasscodeAsking(cb: (asking: boolean) => void): () => void {
  askingListeners.add(cb);
  return () => { askingListeners.delete(cb); };
}

/** Emit the derived boolean when it crosses 0 ↔ non-zero; the strong first-to-finish bug was the reverse. */
function reportAsking() {
  const v = askCount > 0;
  if (asking === v) return;
  asking = v;
  for (const cb of [...askingListeners]) cb(v);
}

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
      askCount += 1;
      reportAsking();
      try {
        const code = (await prompt(reason))?.trim() || null;
        if (code) keeper.set(code);
        return code;
      } finally {
        askCount -= 1;
        reportAsking();
      }
    },
  };
  return keeper;
}
