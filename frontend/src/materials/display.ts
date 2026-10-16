/** display.ts — how a file is named on screen, in one place, so every list says it the same way. */
import type { ExtractedKind } from "./extract.types";
import { plural } from "../lib/plural";

const KIND_LABEL: Record<ExtractedKind, string> = { pdf: "PDF", docx: "Word", pptx: "PowerPoint", text: "Text" };

/** The host reads at most this many characters of one material (host/materials-core.mjs LIMITS.maxChars). */
export const READ_LIMIT_CHARS = 60_000;

/** "Lesson notes.pdf · PDF · 1,234 characters", plus a plain note when the host will read only the start. */
export function describeFile(f: { name: string; kind: ExtractedKind; chars: number }): string {
  const base = `${f.name} · ${KIND_LABEL[f.kind]} · ${plural(f.chars, "character")}`;
  return f.chars > READ_LIMIT_CHARS ? `${base} · the first ${READ_LIMIT_CHARS.toLocaleString("en-US")} characters are read` : base;
}
