/**
 * aiStatus.ts — one plain diagnosis of whether AI drafting can run right now (F5).
 *
 * Read from three things the tab already knows: the worker status the host reports (host.workerStatus),
 * whether that call failed, and — online only — whether this tab holds the demo passcode (a boolean; the
 * value never leaves browser/passcode.ts). The wizard's AI check and the studio's "AI status" both render
 * this, so a stalled teacher sees the same sentence in both places. It decides nothing: the host still
 * refuses or accepts every draft.
 */
import { useCallback, useEffect, useState } from "react";
import { onPasscodeAsking, passcodeKeeper } from "../browser/passcode";
import { BROWSER_MODE } from "../gate/mode";
import { host } from "../gate/transport";
import type { WorkerInfo } from "./useCourse";

export type AiTone = "checking" | "ok" | "warn" | "off";
export type AiAction = "passcode" | "recheck" | null;

export interface AiDiagnosis {
  tone: AiTone;
  /** A few words for the header button. */
  label: string;
  /** One plain sentence: what is true now. */
  sentence: string;
  /** What to do about it, when anything is off. */
  fix: string | null;
  action: AiAction;
}

export interface AiInputs {
  worker: WorkerInfo | null;
  /** The status call itself failed (the host or the site did not answer). */
  unreachable: boolean;
  browserMode: boolean;
  /** Online build only: this tab holds the demo passcode. */
  passcodeHeld: boolean;
}

export function diagnose({ worker, unreachable, browserMode, passcodeHeld }: AiInputs): AiDiagnosis {
  if (unreachable) {
    return browserMode
      ? { tone: "off", label: "AI unreachable", sentence: "This site’s drafting service didn’t answer.", fix: "Check your internet connection, then check again. Writing your own objectives still works.", action: "recheck" }
      : { tone: "off", label: "AI unreachable", sentence: "Silicus can’t reach its host on this computer.", fix: "Start the Silicus host again, then check again.", action: "recheck" };
  }
  if (!worker) return { tone: "checking", label: "Checking AI", sentence: "Checking whether AI drafting is ready…", fix: null, action: null };
  if (!worker.configured) {
    return browserMode
      ? { tone: "off", label: "AI off", sentence: "AI drafting isn’t switched on for this site.", fix: "You can still write your own objectives and turn your brief’s answers into proposals.", action: null }
      : { tone: "off", label: "AI off", sentence: "No drafting model is set up on this computer.", fix: "Whoever runs Silicus here adds a model key and restarts it. Until then, write your own objectives.", action: "recheck" };
  }
  if (browserMode && worker.passcodeRequired === true && !passcodeHeld) {
    return { tone: "warn", label: "AI needs passcode", sentence: "AI drafting on this site needs the demo passcode, and this tab doesn’t hold it yet.", fix: "Enter it now, or Silicus asks the first time you draft. It is kept in this tab only.", action: "passcode" };
  }
  return { tone: "ok", label: "AI ready", sentence: "AI drafting is ready.", fix: null, action: null };
}

/** The live inputs for diagnose(), plus a way to check again and to enter the passcode. */
export function useAiStatus() {
  const keeper = passcodeKeeper();
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [passcodeHeld, setHeld] = useState(() => BROWSER_MODE && keeper.get() !== null);

  const recheck = useCallback(() => {
    setWorker(null);
    setUnreachable(false);
    void host.workerStatus().then((w) => setWorker(w as WorkerInfo)).catch(() => setUnreachable(true));
  }, []);
  useEffect(() => { recheck(); }, [recheck]);
  // The passcode dialog closed (a code entered, or "Not now"): read the tab's boolean again.
  useEffect(() => {
    if (!BROWSER_MODE) return;
    return onPasscodeAsking((open) => { if (!open) setHeld(keeper.get() !== null); });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const diagnosis = diagnose({ worker, unreachable, browserMode: BROWSER_MODE, passcodeHeld });
  const enterPasscode = () => void keeper.ask("needed").then(() => setHeld(keeper.get() !== null));
  return { worker, unreachable, passcodeHeld, diagnosis, recheck, enterPasscode };
}

export type AiStatus = ReturnType<typeof useAiStatus>;
