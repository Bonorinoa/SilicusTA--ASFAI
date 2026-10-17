/**
 * extract.ts — a teacher's file becomes `{ name, text }` material, in the browser (contract: ./extract.types.ts).
 *
 * Nothing here talks to a server and nothing is stored: the file is read in this tab, the text is handed back, and
 * what happens to it next (tab memory, one request) is the caller's. The heavy parsers are imported lazily, inside
 * the branch that needs them, so the main bundle does not carry pdf.js, mammoth or jszip for teachers who only paste.
 *
 * Order of checks: size, then type, then parse. A failure is a result with a plain sentence, never a throw.
 * There is no OCR: a PDF made of pictures has no text layer, and the sentence says so.
 */
import {
  MAX_FILE_BYTES,
  type ExtractFailure, type ExtractResult, type ExtractedKind, type ExtractText,
} from "./extract.types";

export { ACCEPTED_FILE_TYPES, MAX_FILE_BYTES } from "./extract.types";
export type { ExtractFailure, ExtractResult, ExtractedKind, ExtractText } from "./extract.types";

/** The plain sentence for each failure. One per cause, so the teacher can tell them apart. */
const SENTENCE: Record<ExtractFailure, string> = {
  NO_TEXT_LAYER: "This PDF has no text layer: it looks like a scan or photos. Silicus does not read text from pictures. Paste the text instead, or use a PDF whose text you can select.",
  UNSUPPORTED_TYPE: "Silicus reads PDF, Word (.docx), PowerPoint (.pptx) and text files. Save an older .doc or .ppt as .docx or .pptx, or paste the text.",
  TOO_LARGE: "This file is over 20 MB. Paste the part you want used, or split the file.",
  UNREADABLE: "Silicus could not read this file. It may be damaged or password-protected. Paste the text instead.",
};
const NO_TEXT_AT_ALL = "There is no text in this file. Paste the text instead.";

const TEXTLIKE = /\.(txt|md|markdown|vtt|srt|html?|csv)$/i;
const MIME: Record<string, ExtractedKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** The kind from the extension first (a browser's MIME for a .md or .vtt is unreliable), then the MIME for the three formats. */
function kindOf(file: File): ExtractedKind | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".pptx")) return "pptx";
  if (TEXTLIKE.test(n)) return "text";
  return MIME[file.type] ?? null;
}

const fail = (name: string, code: ExtractFailure, message = SENTENCE[code]): ExtractResult => ({ ok: false, name, code, message });

async function bytesOf(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

/** Control characters out, line ends unified, trailing spaces trimmed, runs of blank lines collapsed. */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n").map((l) => l.replace(/[ \t\u00a0]+$/g, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------------ PDF

async function readPdf(buf: ArrayBuffer): Promise<{ text: string; pages: number }> {
  // The "legacy" build carries its own polyfills (Promise.try and friends), so a teacher on a browser a year or two old
  // still gets text out; the modern build needs the very newest. It is a lazy chunk either way.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // The worker is a file in this build's own assets (Vite's `?url`), so `script-src 'self'` holds: no CDN.
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
      page.cleanup();
    }
    return { text: tidy(pages.join("\n\n")), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

// ------------------------------------------------------------------ DOCX

async function readDocx(buf: ArrayBuffer): Promise<string> {
  // The prebuilt browser bundle, by name: the package's "main" is the Node build, which wants a file path or a Buffer,
  // while this one takes the ArrayBuffer we have, identically in the page and under test.
  const mod = await import("mammoth/mammoth.browser.min.js");
  const api = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const { value } = await api.extractRawText({ arrayBuffer: buf });
  return tidy(value);
}

// ------------------------------------------------------------------ PPTX

const FOOTER_PLACEHOLDERS = new Set(["sldNum", "dt", "ftr", "hdr"]);

/** The words of one slide (or notes) part, one paragraph per line. Slide numbers, dates and footers are not the teacher's words. */
function paragraphsOf(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("bad xml");
  const out: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS("*", "p"))) {
    if (p.namespaceURI !== "http://schemas.openxmlformats.org/drawingml/2006/main") continue;
    let skip = false;
    for (let n: Element | null = p.parentElement; n; n = n.parentElement) {
      if (n.localName !== "sp") continue;
      const ph = Array.from(n.getElementsByTagNameNS("*", "ph"))[0];
      if (ph && FOOTER_PLACEHOLDERS.has(ph.getAttribute("type") ?? "")) skip = true;
      break;
    }
    if (skip) continue;
    const line = Array.from(p.getElementsByTagNameNS("*", "t")).map((t) => t.textContent ?? "").join("");
    if (line.trim()) out.push(line);
  }
  return out;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
/** A relationship Target, relative to the part that holds it, as a path inside the zip. */
function resolveTarget(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirOf(from) + target).split("/");
  const out: string[] = [];
  for (const part of parts) { if (part === "..") out.pop(); else if (part && part !== ".") out.push(part); }
  return out.join("/");
}

async function readPptx(buf: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  const read = async (path: string): Promise<string | null> => (await zip.file(path)?.async("string")) ?? null;

  // Slide order is the deck's own list (presentation.xml), not the file names: PowerPoint renames nothing when slides move.
  let slides: string[] = [];
  try {
    const pres = await read("ppt/presentation.xml");
    const rels = await read("ppt/_rels/presentation.xml.rels");
    if (pres && rels) {
      const relDoc = new DOMParser().parseFromString(rels, "application/xml");
      const target = new Map(Array.from(relDoc.getElementsByTagNameNS("*", "Relationship")).map((r) => [r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? ""]));
      const presDoc = new DOMParser().parseFromString(pres, "application/xml");
      slides = Array.from(presDoc.getElementsByTagNameNS("*", "sldId"))
        .map((s) => target.get(s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "") ?? "")
        .filter(Boolean).map((t) => resolveTarget("ppt/presentation.xml", t)).filter((p) => zip.file(p));
    }
  } catch { slides = []; }
  if (slides.length === 0) {
    slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  }
  if (slides.length === 0) throw new Error("no slides");

  const blocks: string[] = [];
  for (const path of slides) {
    const lines = paragraphsOf((await read(path)) ?? "");
    const relsPath = `${dirOf(path)}_rels/${path.slice(path.lastIndexOf("/") + 1)}.rels`;
    const slideRels = await read(relsPath);
    if (slideRels) {
      const relDoc = new DOMParser().parseFromString(slideRels, "application/xml");
      const notes = Array.from(relDoc.getElementsByTagNameNS("*", "Relationship")).find((r) => /\/notesSlide$/.test(r.getAttribute("Type") ?? ""));
      const notesXml = notes ? await read(resolveTarget(path, notes.getAttribute("Target") ?? "")) : null;
      const noteLines = notesXml ? paragraphsOf(notesXml) : [];
      if (noteLines.length) lines.push("Notes: " + noteLines.join(" "));
    }
    if (lines.length) blocks.push(lines.join("\n"));
  }
  return { text: tidy(blocks.join("\n\n")), pages: slides.length };
}

// ------------------------------------------------------------------ the one entry point

export const extractText: ExtractText = async (file) => {
  const name = file.name;
  if (file.size > MAX_FILE_BYTES) return fail(name, "TOO_LARGE");
  const kind = kindOf(file);
  if (!kind) return fail(name, "UNSUPPORTED_TYPE");

  try {
    if (kind === "text") {
      // Bytes through TextDecoder, not file.text(): the same result in every browser, and a UTF-8 byte-order mark is dropped.
      const text = tidy(new TextDecoder("utf-8").decode(await bytesOf(file)));
      return text ? { ok: true, name, kind, text, chars: text.length } : fail(name, "UNREADABLE", NO_TEXT_AT_ALL);
    }
    const buf = await bytesOf(file);
    if (kind === "pdf") {
      const { text, pages } = await readPdf(buf);
      return text ? { ok: true, name, kind, text, chars: text.length, pages } : fail(name, "NO_TEXT_LAYER");
    }
    if (kind === "docx") {
      const text = await readDocx(buf);
      return text ? { ok: true, name, kind, text, chars: text.length } : fail(name, "UNREADABLE", NO_TEXT_AT_ALL);
    }
    const { text, pages } = await readPptx(buf);
    return text ? { ok: true, name, kind, text, chars: text.length, pages } : fail(name, "UNREADABLE", NO_TEXT_AT_ALL);
  } catch {
    // A corrupt, encrypted or unparseable file, or a parser that could not load: one plain sentence, not a stack.
    return fail(name, "UNREADABLE");
  }
};
