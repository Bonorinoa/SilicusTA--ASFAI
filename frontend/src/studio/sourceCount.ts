/**
 * sourceCount.ts — one source count everywhere (N2, L1 "Where I did not know what was going on" 3).
 *
 * The rule: a source is a file, a pasted text or a web page the teacher added, counted once whatever its state
 * (read in the tab, a web page not fetched yet, or skipped with a reason under Sources). The skill-map topics are
 * named beside the count, never counted as a source. A web page is never "ready" before it is fetched.
 */
import { plural } from "../lib/plural";

/** "3 sources", "3 sources and the skill-map topics", "the skill-map topics", or "" when there is nothing. */
export function sourcesPhrase(count: number, map: boolean): string {
  const n = count > 0 ? plural(count, "source") : "";
  return [n, map ? "the skill-map topics" : ""].filter(Boolean).join(" and ");
}

/** The wizard's line under Sources: what is read now and what is fetched later, said apart. */
export function sourcesFootLine(files: number, links: number, map: boolean): string | null {
  const count = files + links;
  if (count === 0 && !map) return null;
  const parts = [
    files > 0 ? `${files} read here` : "",
    links > 0 ? `${plural(links, "web page")}, fetched when Silicus reads ${links === 1 ? "it" : "them"}` : "",
  ].filter(Boolean);
  const lead = count > 0 ? `${plural(count, "source")}${parts.length ? `: ${parts.join(", ")}` : ""}.` : "";
  return [lead, map ? "Plus the skill-map topics." : ""].filter(Boolean).join(" ");
}
