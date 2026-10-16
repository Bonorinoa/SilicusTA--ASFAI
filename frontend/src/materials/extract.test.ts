/**
 * extract.test.ts — a teacher's file becomes material text in the browser, or a plain sentence says why not.
 *
 * DOCX and PPTX fixtures are built HERE with jszip (the same library the extractor reads PPTX with); the two PDFs are
 * tiny hand-written files under __fixtures__ (a text PDF and an image-only one). The order of checks is part of the
 * contract: size, then type, then parse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { extractText } from "./extract";
import { ACCEPTED_FILE_TYPES, MAX_FILE_BYTES } from "./extract.types";

// pdf.js runs its "worker" in this process under test; the bundler's `?url` import is replaced by the file's own URL.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", async () => {
  const { pathToFileURL } = await import("node:url");
  const { createRequire } = await import("node:module");
  return { default: pathToFileURL(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href };
});

const fixture = (name: string): File => new File([readFileSync(join(process.cwd(), "src/materials/__fixtures__", name))], name, { type: "application/pdf" });

const garbage = (...n: number[]): ArrayBuffer => new Uint8Array(n).buffer as ArrayBuffer;

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

async function docx(paragraphs: string[]): Promise<File> {
  const z = new JSZip();
  z.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${NS_W}"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return new File([await z.generateAsync({ type: "arraybuffer" })], "notes.docx");
}

/** slides are listed in presentation.xml in the order given; each is {file number, runs, optional notes}. */
async function pptx(slides: { n: number; runs: string[]; notes?: string }[], listOrder = slides.map((s) => s.n)): Promise<File> {
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`);
  z.file("ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${NS_P}" xmlns:r="${NS_R}"><p:sldIdLst>${listOrder.map((n) => `<p:sldId id="${255 + n}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>`);
  z.file("ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS_REL}">${slides.map((s) => `<Relationship Id="rId${s.n}" Type="${NS_R}/slide" Target="slides/slide${s.n}.xml"/>`).join("")}</Relationships>`);
  const shape = (runs: string[], ph = "") =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${runs.map((r) => `<a:p><a:r><a:t>${r}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
  for (const s of slides) {
    // A slide-number placeholder carries the slide's number as text: it is not the teacher's words.
    z.file(`ppt/slides/slide${s.n}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="${NS_P}" xmlns:a="${NS_A}"><p:cSld><p:spTree>${shape(s.runs)}${shape([String(s.n)], "sldNum")}</p:spTree></p:cSld></p:sld>`);
    if (s.notes) {
      z.file(`ppt/slides/_rels/slide${s.n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${NS_R}/notesSlide" Target="../notesSlides/notesSlide${s.n}.xml"/></Relationships>`);
      z.file(`ppt/notesSlides/notesSlide${s.n}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:p="${NS_P}" xmlns:a="${NS_A}"><p:cSld><p:spTree>${shape([s.notes], "body")}${shape([String(s.n)], "sldNum")}</p:spTree></p:cSld></p:notes>`);
    }
  }
  return new File([await z.generateAsync({ type: "arraybuffer" })], "deck.pptx");
}

describe("the picker contract", () => {
  it("accepts the three real formats and the old text-like ones", () => {
    for (const t of [".pdf", ".docx", ".pptx", ".txt", ".md", ".vtt", ".srt", ".html", ".csv"]) expect(ACCEPTED_FILE_TYPES).toContain(t);
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("text files keep the existing reader", () => {
  it("reads .txt as it always did, under the file's own name", async () => {
    const r = await extractText(new File(["Plants make food.\nLeaves catch light."], "Lesson notes.txt", { type: "text/plain" }));
    expect(r).toEqual({ ok: true, name: "Lesson notes.txt", kind: "text", text: "Plants make food.\nLeaves catch light.", chars: 37 });
  });
  it("refuses a text file with nothing in it, in a sentence", async () => {
    const r = await extractText(new File(["  \n "], "empty.md"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no text/i);
  });
});

describe("DOCX", () => {
  it("returns the paragraphs of a built .docx", async () => {
    const r = await extractText(await docx(["Plants make their own food.", "Leaves hold the green pigment."]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("docx");
      expect(r.name).toBe("notes.docx");
      expect(r.text).toContain("Plants make their own food.");
      expect(r.text).toContain("Leaves hold the green pigment.");
      expect(r.chars).toBe(r.text.length);
    }
  });
});

describe("PPTX", () => {
  it("reads slide text in the presentation's own order (not file-name order), then the notes, and skips slide numbers", async () => {
    // File slide2.xml is FIRST in the deck; slide1.xml is second.
    const r = await extractText(await pptx([{ n: 1, runs: ["Second slide title", "Second bullet"], notes: "Say this aloud." }, { n: 2, runs: ["First slide title"] }], [2, 1]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("pptx");
      expect(r.pages).toBe(2);
      expect(r.text.indexOf("First slide title")).toBeGreaterThanOrEqual(0);
      expect(r.text.indexOf("First slide title")).toBeLessThan(r.text.indexOf("Second slide title"));
      expect(r.text).toContain("Second bullet");
      expect(r.text).toContain("Say this aloud.");
      // The slide-number placeholders (text "1" and "2") are not material.
      expect(r.text.split("\n").map((l: string) => l.trim())).not.toContain("1");
      expect(r.text.split("\n").map((l: string) => l.trim())).not.toContain("2");
    }
  });
  it("falls back to slide-file order when the deck has no readable slide list", async () => {
    const z = new JSZip();
    z.file("ppt/slides/slide10.xml", `<p:sld xmlns:p="${NS_P}" xmlns:a="${NS_A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    z.file("ppt/slides/slide2.xml", `<p:sld xmlns:p="${NS_P}" xmlns:a="${NS_A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    const r = await extractText(new File([await z.generateAsync({ type: "arraybuffer" })], "bare.pptx"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.indexOf("Second")).toBeLessThan(r.text.indexOf("Tenth"));
  });
});

describe("PDF", () => {
  it("reads the text layer of the hand-written fixture", async () => {
    const r = await extractText(fixture("hello.pdf"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("pdf");
      expect(r.pages).toBe(1);
      expect(r.text).toContain("Hello from the fixture PDF.");
      expect(r.text).toContain("HELLO-PDF-MARKER-7731");
      expect(r.chars).toBe(r.text.length);
    }
  });
  it("says plainly that an image-only PDF has no text layer, and does not claim to read images", async () => {
    const r = await extractText(fixture("scan-only.pdf"));
    expect(r).toMatchObject({ ok: false, name: "scan-only.pdf", code: "NO_TEXT_LAYER" });
    if (!r.ok) {
      expect(r.message).toMatch(/no text layer/i);
      expect(r.message).not.toMatch(/\bOCR\b|recogni[sz]/i);
    }
  });
});

describe("failures, in the contract's order: size, type, parse", () => {
  it("refuses a 21 MB file as TOO_LARGE before looking at its type or content", async () => {
    const big = new File([new Uint8Array(21 * 1024 * 1024)], "huge.doc");   // .doc would be UNSUPPORTED_TYPE: size wins
    const r = await extractText(big);
    expect(r).toMatchObject({ ok: false, name: "huge.doc", code: "TOO_LARGE" });
    if (!r.ok) expect(r.message).toMatch(/20 MB/);
  });
  it("refuses a legacy .doc and .ppt as UNSUPPORTED_TYPE, and says what to do", async () => {
    for (const name of ["old.doc", "old.ppt", "photo.png"]) {
      const r = await extractText(new File(["x"], name));
      expect(r).toMatchObject({ ok: false, name, code: "UNSUPPORTED_TYPE" });
    }
    const r = await extractText(new File(["x"], "old.doc"));
    if (!r.ok) expect(r.message).toMatch(/\.docx/);
  });
  it("calls garbage bytes named .pdf UNREADABLE, never a crash", async () => {
    const r = await extractText(new File([garbage(1, 2, 3, 4, 5, 6, 7, 8)], "broken.pdf"));
    expect(r).toMatchObject({ ok: false, name: "broken.pdf", code: "UNREADABLE" });
  });
  it("calls garbage bytes named .docx or .pptx UNREADABLE", async () => {
    for (const name of ["broken.docx", "broken.pptx"]) {
      expect(await extractText(new File([garbage(9, 9, 9, 9)], name))).toMatchObject({ ok: false, name, code: "UNREADABLE" });
    }
  });
  it("never returns the same sentence for different failures", async () => {
    const msgs = new Set<string>();
    for (const f of [fixture("scan-only.pdf"), new File(["x"], "a.doc"), new File([new Uint8Array(21 * 1024 * 1024)], "b.pdf"), new File([garbage(1, 2)], "c.pdf")]) {
      const r = await extractText(f);
      if (!r.ok) msgs.add(r.message);
    }
    expect(msgs.size).toBe(4);
  });
});
