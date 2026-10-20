/**
 * sourceIntake.ts — the small rules behind the one source drop zone (wizard and studio alike).
 *
 * No source-name field anywhere (R6): a file is named by its file name, a web page by its address, and
 * pasted text by its own first words. The name is what goes on the record when Silicus reads the text;
 * the text itself stays in the tab (materials/session.ts).
 */

/** A web page address the site can fetch: https only, one token, with a dot in the host. */
export function isWebAddress(raw: string): boolean {
  const t = raw.trim();
  return /^https:\/\/[^\s/]+\.[^\s]+$/.test(t);
}

/** YouTube needs the local app (the online build cannot read captions). */
export function isYouTube(raw: string): boolean {
  return /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(raw.trim());
}

const NAME_MAX = 60;

/**
 * Pasted text is named by its first line, cut at a word near 60 characters, and made unique against the
 * names already held ("Lesson notes", "Lesson notes (2)"). An empty first line falls back to "Pasted text".
 */
export function nameForPaste(text: string, taken: readonly string[] = []): string {
  const first = (text.split("\n").map((l) => l.trim()).find(Boolean) ?? "").replace(/\s+/g, " ");
  let base = first || "Pasted text";
  if (base.length > NAME_MAX) {
    const cut = base.slice(0, NAME_MAX);
    const space = cut.lastIndexOf(" ");
    base = `${(space > 24 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
  }
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.includes(`${base} (${n})`)) return `${base} (${n})`;
}

/** How a web page is shown in a list: the address without its scheme. */
export const shortAddress = (url: string): string => url.replace(/^https?:\/\//, "");
