/**
 * Elapsed — N1 (L1 finding 3c): every wait shows its seconds once it passes ten. The L1 walk sat ~100 s on the map
 * step with no clock and nearly skipped it. A real clock from mount, quiet (no live announcement every second), and
 * nothing at all for a short wait.
 */
import { useEffect, useState } from "react";

export const ELAPSED_AFTER_S = 10;

export function Elapsed({ after = ELAPSED_AFTER_S, className }: { after?: number; className?: string }) {
  const [start] = useState(() => Date.now());
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [start]);
  if (secs < after) return null;
  return <span className={className} data-elapsed aria-hidden="true">{secs} s</span>;
}
