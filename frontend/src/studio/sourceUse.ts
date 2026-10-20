/**
 * sourceUse.ts — what the Sources panel says about each source (R6), as pure functions.
 *
 * Nothing here decides anything. "Used for" is read off the host's own proposal labels ("from material: A, B";
 * "(several)" names none), and "Skipped" is the list the host returned for the last round. The UI only counts.
 */
import { plural } from "../lib/plural";
import { REFUSALS } from "../lib/refusals";

const PREFIX = "from material: ";
const SEVERAL = "(several)";

/** The names one proposal label credits. "(several)" and labels that are not material labels credit none. */
export function namesInLabel(source: string | null | undefined): string[] {
  if (!source || !source.startsWith(PREFIX)) return [];
  const rest = source.slice(PREFIX.length).trim();
  if (!rest || rest === SEVERAL) return [];
  return [rest, ...rest.split(", ").map((x) => x.trim()).filter(Boolean)];
}

/** How many proposals name this source exactly (a name with a comma still matches as the whole label). */
export function usedFor(name: string, proposals: readonly { source: string | null }[]): number {
  return proposals.filter((p) => namesInLabel(p.source).includes(name)).length;
}

export const usedLine = (n: number): string => `Used for ${plural(n, "proposal")}`;

/** Plain words for why the host skipped a source. The host's own sentence never reaches the screen. */
const SKIP_WORDS: Readonly<Record<string, string>> = {
  BAD_MATERIAL: "Silicus could not read it",
  EMPTY: "it has no text Silicus can read",
  NAME_REQUIRED: "it has no name",
  NO_TRANSCRIPT: "the video has no transcript",
  TOO_LARGE: "it is too large to read",
  TOO_MANY: "there were more sources than Silicus reads at once",
  UNSUPPORTED_TYPE: "Silicus cannot read this kind of file",
  URL_REFUSED: "Silicus does not open this kind of address",
  URL_UNREACHABLE: "the page could not be opened",
};

export function skipReason(code: string | undefined): string {
  const words = (code && SKIP_WORDS[code]) || null;
  if (words) return words;
  const table = code ? REFUSALS[code]?.what : undefined;
  return table ? table.replace(/\.$/, "") : "Silicus could not read it";
}

export interface Skipped { name: string; code?: string; reason?: string }

export function skippedLine(name: string, skipped: readonly Skipped[]): string | null {
  const hit = skipped.find((x) => x.name === name);
  return hit ? `Skipped: ${skipReason(hit.code)}` : null;
}

/** A name compared without case or extension: "Lesson Notes.PDF" and "lesson notes.docx" are the same source. */
export function sourceKey(name: string): string {
  const t = name.trim().toLowerCase();
  const dot = t.lastIndexOf(".");
  return dot > 0 && /^[a-z0-9]{1,5}$/.test(t.slice(dot + 1)) ? t.slice(0, dot) : t;
}

/** Record names this tab holds no text for. An attached file covers a legacy name ignoring case and extension. */
export function legacyNames(names: readonly string[], held: readonly { name: string }[]): string[] {
  const have = new Set(held.map((h) => sourceKey(h.name)));
  return names.filter((n) => !have.has(sourceKey(n)));
}

/**
 * The name the host recorded for each source of a round, keyed by the tab's own key (a file's name, a link's
 * address). The host returns the read materials in input order minus the skipped ones (host/materials-core.mjs),
 * so a web page's own title maps back to its link. If the counts disagree, nothing is mapped rather than guessed.
 */
export function recordedNames(
  inputs: readonly { name?: string; url?: string }[],
  skipped: readonly Skipped[],
  read: readonly { name: string }[],
): Record<string, string> {
  const keyOf = (m: { name?: string; url?: string }) => m.name ?? m.url ?? "";
  const gone = new Set(skipped.map((x) => x.name));
  const kept = inputs.filter((m) => !gone.has(keyOf(m)) && !gone.has(keyOf(m).slice(0, 120)));
  if (kept.length !== read.length) return {};
  return Object.fromEntries(kept.map((m, i) => [keyOf(m), read[i].name]));
}
