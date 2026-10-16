/**
 * Contract 2026-10-16 (sprint weekend-share): turning a teacher's FILE into material text, in the browser.
 *
 * Both builds (local host and online browser-host) extract in the page, then hand `{ name, text }` to the
 * existing material input (`MaterialInput` in gate/transport.ts). No new host route, and the rule that
 * material text never persists is unchanged: the text lives in the tab and in the one request that uses it.
 *
 * The implementation lives in `./extract.ts` (engineer lane E-b). Heavy parsers (PDF, DOCX, PPTX) are
 * imported lazily inside `extractText`, so the main bundle does not grow for teachers who never upload.
 */

/** What the file picker accepts. Text-like types keep working exactly as before. */
export const ACCEPTED_FILE_TYPES =
  ".pdf,.docx,.pptx,.txt,.md,.markdown,.vtt,.srt,.html,.htm,.csv," +
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Larger files are refused before any parsing (a plain sentence, never a crash). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type ExtractedKind = "pdf" | "docx" | "pptx" | "text";

export type ExtractFailure =
  /** A PDF with no text layer (a scan or photos). OCR is not supported: say so plainly. */
  | "NO_TEXT_LAYER"
  /** A type outside ACCEPTED_FILE_TYPES (including legacy .doc / .ppt). */
  | "UNSUPPORTED_TYPE"
  /** Over MAX_FILE_BYTES. */
  | "TOO_LARGE"
  /** Corrupt, encrypted, or the parser threw. */
  | "UNREADABLE";

export type ExtractResult =
  | { ok: true; name: string; kind: ExtractedKind; text: string; chars: number; pages?: number }
  | { ok: false; name: string; code: ExtractFailure; message: string };

/** Signature the implementation must export from `./extract.ts`. */
export type ExtractText = (file: File) => Promise<ExtractResult>;
