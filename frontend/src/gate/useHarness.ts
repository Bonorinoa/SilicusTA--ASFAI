import { useCallback, useSyncExternalStore } from "react";
import type { ConfirmGateHarness } from "./harness";

/** Re-render on harness (gate) changes: state transitions drive the visuals. */
export function useHarnessRevision(harness: ConfirmGateHarness): number {
  const subscribe = useCallback((cb: () => void) => harness.subscribe(cb), [harness]);
  const getSnapshot = useCallback(() => harness.revision(), [harness]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
