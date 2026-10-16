/**
 * useMediaQuery — a media query as state. Without matchMedia (a bare test DOM, an old browser) it answers false:
 * for the rail that means the narrow, collapsible layout, and "no reduced-motion preference" (as AiWaiting does).
 */
import { useEffect, useState } from "react";

const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => supported() && window.matchMedia(query).matches);
  useEffect(() => {
    if (!supported()) return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return matches;
}
