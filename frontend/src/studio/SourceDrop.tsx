/**
 * SourceDrop — the one way a source comes in, in the wizard and in the studio: drop or choose files, or
 * paste into one box (text, or a web page address). No name field: the name comes from the thing itself.
 * A file is read here, in the tab; a web page is only noted, and fetched when Silicus reads the sources.
 */
import { useId, useRef, useState } from "react";
import { BROWSER_MODE } from "../gate/mode";
import { extractText } from "../materials/extract";
import { ACCEPTED_FILE_TYPES } from "../materials/extract.types";
import type { HeldFile } from "../materials/session";
import { plural } from "../lib/plural";
import { isWebAddress, isYouTube, nameForPaste } from "./sourceIntake";
import { Button, ui } from "./ui";
import w from "./Wizard.module.css";

export function SourceDrop({ taken, full, onFile, onLink }: {
  /** Names already held, so pasted text gets a unique one. */
  taken: readonly string[];
  /** No room for another source. */
  full: boolean;
  onFile: (file: HeldFile) => void;
  onLink: (url: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { file: useId(), paste: useId(), hint: useId() };

  const readFiles = async (files: File[]) => {
    if (full || files.length === 0) return;
    setErrors([]);
    setReading(files.length);
    const failed: string[] = [];
    for (const f of files) {
      const r = await extractText(f);
      setReading((n) => n - 1);
      if (r.ok) onFile({ name: r.name, kind: r.kind, text: r.text, chars: r.chars });
      else failed.push(r.message);
    }
    setErrors(failed);
    if (fileRef.current) fileRef.current.value = "";
  };

  const t = paste.trim();
  const url = isWebAddress(t);
  const tube = url && isYouTube(t) && BROWSER_MODE;
  const looksLikeLink = /^https?:\/\//i.test(t) && !/\s/.test(t);
  const hint = !t
    ? "Text stays in this tab. A web page is fetched once, when Silicus reads your sources."
    : tube ? "YouTube needs the local app. Paste the transcript here instead."
      : url ? "A web page. Silicus fetches it when it reads your sources."
        : looksLikeLink ? "Web pages need an address starting with https://."
          : `Text · ${plural(paste.length, "character")}. It's named by its first line.`;
  const canAdd = !full && t !== "" && !tube && (url || !looksLikeLink);

  const add = () => {
    if (!canAdd) return;
    if (url) onLink(t);
    else onFile({ name: nameForPaste(paste, taken), kind: "text", text: paste, chars: paste.length });
    setPaste("");
  };

  return (
    <div className={w.dropArea}>
      <div
        className={w.drop}
        data-over={over ? "true" : undefined}
        onDragOver={(e) => { e.preventDefault(); if (!full) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void readFiles([...e.dataTransfer.files]); }}
      >
        <p className={w.dropTitle}>{reading > 0 ? `Reading ${plural(reading, "file")} in this tab…` : "Drop files here"}</p>
        <p className={w.dropHint}>PDF, Word, PowerPoint or text. Read here in the tab; the file itself isn’t uploaded or kept.</p>
        <label className={w.fileButton} htmlFor={ids.file} aria-disabled={full ? "true" : undefined}>
          Choose files
          <input ref={fileRef} id={ids.file} className={w.visuallyHidden} type="file" multiple accept={ACCEPTED_FILE_TYPES} disabled={full}
            onChange={(e) => void readFiles([...(e.target.files ?? [])])} />
        </label>
      </div>
      {errors.map((m) => <p key={m} className={w.problem}>{m}</p>)}
      <div className={ui.field}>
        <label className={ui.label} htmlFor={ids.paste}>Or paste text, or a web page address</label>
        <textarea id={ids.paste} className={ui.textarea} rows={3} value={paste} disabled={full} aria-describedby={ids.hint}
          placeholder="Paste lesson notes, or https://…" onChange={(e) => setPaste(e.target.value)} />
        <div className={w.pasteFoot}>
          <span id={ids.hint} className={ui.hint}>{hint}</span>
          <Button size="small" disabled={!canAdd} onClick={add}>{url ? "Add web page" : "Add text"}</Button>
        </div>
      </div>
      {full ? <p className={ui.hint}>That’s the most sources one course holds for now.</p> : null}
    </div>
  );
}
