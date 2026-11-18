/**
 * fetchFailure.ts — plain words for a web page Silicus could not read (K1 item 5, owner walk 17 Nov).
 *
 * Both hosts say why a link failed in their own sentence, and both carry the HTTP status in it:
 *   Node host     host/materials.mjs   "that link answered 403", "reading that link took too long"
 *   browser host  browser/site.ts      the same sentence, passed through from /api/fetch, or "… (403)"
 * This reads the status (or the timeout) out of that sentence and gives the teacher one plain line. The raw
 * sentence stays for a collapsed "Details". Unknown failures return null and keep the generic words.
 */
export interface PlainFailure { what: string; next: string; line: string }

const BLOCKED: PlainFailure = {
  what: "This site blocks automatic reading.",
  next: "Paste the text, or save the page as a PDF and add that.",
  line: "This site blocks automatic reading. Paste the text, or save the page as a PDF and add that.",
};
const NOT_FOUND: PlainFailure = {
  what: "That page was not found.",
  next: "Check the address, or paste the text.",
  line: "That page was not found.",
};
const TIMEOUT: PlainFailure = {
  what: "The site took too long.",
  next: "Try again or paste the text.",
  line: "The site took too long. Try again or paste the text.",
};

/** The HTTP status a host sentence names ("answered 403", "(404)"), or null. */
export function statusIn(message: string): number | null {
  const m = /(?:answered|\()\s*(\d{3})\b/.exec(message);
  return m ? Number(m[1]) : null;
}

export function plainFetchFailure(message: string | null | undefined): PlainFailure | null {
  const text = (message ?? "").toLowerCase();
  if (!text) return null;
  const status = statusIn(text);
  if (status === 401 || status === 403 || status === 451 || /\bblocked\b|\bforbidden\b/.test(text)) return BLOCKED;
  if (status === 404 || status === 410) return NOT_FOUND;
  if (status === 408 || status === 504 || /took too long|timed? ?out/.test(text)) return TIMEOUT;
  return null;
}
