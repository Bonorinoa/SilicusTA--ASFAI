/**
 * PasscodeNote — B3: on the online build, when the worker status says this site's AI drafting needs the
 * demo passcode and this tab does not hold one yet, the Brief step says so calmly, with a quiet button
 * that opens the SAME dialog through the keeper. The button sends nothing by itself: the network is only
 * touched when a draft is actually requested, and "Not now" sends nothing at all. Local (host) mode
 * renders nothing.
 */
import { useEffect, useState } from "react";
import { onPasscodeAsking, passcodeKeeper } from "../browser/passcode";
import { BROWSER_MODE } from "../gate/mode";
import { Button } from "./ui";
import type { WorkerInfo } from "./useCourse";
import s from "./StepStatus.module.css";

export function PasscodeNote({ worker }: { worker: WorkerInfo | null }) {
  const keeper = passcodeKeeper();
  const [held, setHeld] = useState(() => !BROWSER_MODE || keeper.get() !== null);
  // The dialog closes (a code entered, or "Not now"): re-read the tab's storage for the passcode.
  // Only the boolean travels; the value stays in passcode.ts's one sessionStorage key.
  useEffect(() => {
    if (!BROWSER_MODE) return;
    return onPasscodeAsking((open) => { if (!open) setHeld(keeper.get() !== null); });
  }, []);
  if (!BROWSER_MODE || worker?.passcodeRequired !== true || held) return null;
  return (
    <p className={s.passcodeNote}>
      AI drafting on this site needs the demo passcode.{" "}
      <Button variant="quiet" size="small" onClick={() => void keeper.ask("needed")}>Enter the passcode now</Button>
    </p>
  );
}