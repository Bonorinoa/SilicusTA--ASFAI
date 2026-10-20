/**
 * Sources: the names on the course record, plus the text this tab holds for them. Text never leaves the tab until
 * the teacher asks for objectives from it, and a reload forgets it (materials/session.ts).
 */
import { useId, useRef, useState } from "react";
import { BROWSER_MODE } from "../gate/mode";
import { plural } from "../lib/plural";
import { describeFile } from "../materials/display";
import { extractText } from "../materials/extract";
import { ACCEPTED_FILE_TYPES } from "../materials/extract.types";
import type { HeldFile } from "../materials/session";
import { Button, Dialog, Notice, Soon, ui } from "./ui";
import s from "./Studio.module.css";

const KIND_LABEL: Record<string, string> = { pdf: "PDF", docx: "DOC", pptx: "PPT", text: "TXT", link: "URL" };
const MAX_ITEMS = 8;

export function SourcesPanel({ names, held, links, onHeld, onLinks, confirmed }: {
  names: string[];
  held: HeldFile[];
  links: string[];
  onHeld: (next: HeldFile[]) => void;
  onLinks: (next: string[]) => void;
  confirmed: boolean;
}) {
  const [adding, setAdding] = useState(false);
  // On a phone the panel folds into one bar above the step (R8); on wider screens it is always open.
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const loaded = new Set(held.map((h) => h.name));
  // Names on the record that this tab has no text for yet.
  const waiting = names.filter((n) => !loaded.has(n));
  const count = held.length + links.length + waiting.length;

  return (
    <aside className={s.sources} aria-label="Sources" data-open={open ? "true" : undefined}>
      <button type="button" className={s.sourcesToggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span><strong>Sources</strong> · {count === 0 ? "none yet" : plural(count, "source")}</span>
        <span aria-hidden="true">{open ? "Hide" : "Show"}</span>
      </button>
      <div className={s.sourcesBody} id={bodyId}>
      <div className={s.sectionLabel}>
        <span>Sources</span>
        {confirmed ? <span style={{ color: "var(--fn-done)", letterSpacing: 0, textTransform: "none" }}>✓ listed</span> : null}
      </div>
      <ul className={s.sourceList}>
        {held.map((h) => (
          <li key={`h-${h.name}`} className={s.sourceItem}>
            <span className={s.sourceIcon} aria-hidden="true">{KIND_LABEL[h.kind] ?? "TXT"}</span>
            <span style={{ minWidth: 0 }}>
              <span className={s.sourceName}>{h.name}</span><br />
              <span className={s.sourceMeta}>{describeFile(h).replace(`${h.name} · `, "")}</span>
            </span>
            <button type="button" className={s.sourceRemove} aria-label={`Remove ${h.name} from this tab`} onClick={() => onHeld(held.filter((x) => x !== h))}>×</button>
          </li>
        ))}
        {links.map((u) => (
          <li key={`l-${u}`} className={s.sourceItem}>
            <span className={s.sourceIcon} aria-hidden="true">URL</span>
            <span style={{ minWidth: 0 }}><span className={s.sourceName}>{u.replace(/^https?:\/\//, "")}</span><br /><span className={s.sourceMeta}>Fetched when you ask</span></span>
            <button type="button" className={s.sourceRemove} aria-label={`Remove ${u}`} onClick={() => onLinks(links.filter((x) => x !== u))}>×</button>
          </li>
        ))}
        {waiting.map((n) => (
          <li key={`n-${n}`} className={s.sourceItem}>
            <span className={s.sourceIcon} aria-hidden="true" style={{ background: "transparent", border: "1px dashed var(--fn-line-dash)" }}>…</span>
            <span style={{ minWidth: 0 }}><span className={s.sourceName}>{n}</span><br /><span className={s.sourceMeta}>Named only. Add the file to use its text.</span></span>
          </li>
        ))}
      </ul>
      {held.length + links.length + waiting.length === 0 ? <p className={s.sourceMeta}>No sources yet. You can plan from your own answers instead.</p> : null}
      <button type="button" className={s.addSource} onClick={() => setAdding(true)} disabled={held.length + links.length >= MAX_ITEMS}>+ Add a source</button>
      {BROWSER_MODE ? <div className={s.soonRow} style={{ justifyContent: "space-between" }}><span>YouTube</span><Soon>Local app only</Soon></div> : null}
      <p className={s.sourceFoot}>Text is read in this tab, sent once when you ask for a draft, and forgotten on reload.</p>
      </div>
      <AddSourceDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(file, link) => {
          if (file) onHeld([...held.filter((h) => h.name !== file.name), file].slice(0, MAX_ITEMS));
          if (link) onLinks([...links.filter((u) => u !== link), link]);
          setAdding(false);
        }}
      />
    </aside>
  );
}

function AddSourceDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (file: HeldFile | null, link: string | null) => void }) {
  const [mode, setMode] = useState<"file" | "paste" | "link">("file");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), text: useId(), url: useId(), file: useId() };
  const reset = () => { setName(""); setText(""); setUrl(""); setError(null); };

  const readFile = async (f: File) => {
    setReading(true); setError(null);
    const r = await extractText(f);
    setReading(false);
    if (!r.ok) { setError(r.message); return; }
    onAdd({ name: r.name, kind: r.kind, text: r.text, chars: r.chars }, null);
    reset();
  };

  const tab = (id: typeof mode, label: string) => (
    <button type="button" role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setError(null); }}
      style={{ minHeight: 36, padding: "0 14px", borderRadius: 999, border: 0, cursor: "pointer", background: mode === id ? "var(--fn-accent)" : "transparent", color: mode === id ? "#fbf8f1" : "var(--fn-ink-soft)", fontWeight: 500 }}>
      {label}
    </button>
  );

  return (
    <Dialog open={open} onClose={() => { reset(); onClose(); }} label="Add a source">
      <div className={ui.dialogBody}>
        <h2 style={{ fontSize: "1.5rem" }}>Add a source</h2>
        <div role="tablist" aria-label="Kind of source" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 999, background: "#ece5d6", alignSelf: "flex-start" }}>
          {tab("file", "File")}{tab("paste", "Paste text")}{tab("link", "Web page")}
        </div>
        {mode === "file" ? (
          <div className={ui.field}>
            <label className={ui.label} htmlFor={ids.file}>PDF, Word, PowerPoint or text</label>
            <input ref={fileRef} id={ids.file} type="file" accept={ACCEPTED_FILE_TYPES} onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
            <span className={ui.hint}>{reading ? "Reading the file in this tab…" : "Read here in the tab. The file itself isn’t uploaded or kept."}</span>
          </div>
        ) : null}
        {mode === "paste" ? (
          <>
            <div className={ui.field}>
              <label className={ui.label} htmlFor={ids.name}>Name</label>
              <input id={ids.name} className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lesson notes" />
            </div>
            <div className={ui.field}>
              <label className={ui.label} htmlFor={ids.text}>Text</label>
              <textarea id={ids.text} className={ui.textarea} rows={6} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          </>
        ) : null}
        {mode === "link" ? (
          <div className={ui.field}>
            <label className={ui.label} htmlFor={ids.url}>A public web page</label>
            <input id={ids.url} className={ui.input} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            <span className={ui.hint}>Fetched once when you ask for objectives. YouTube needs the local app; paste a transcript instead.</span>
          </div>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        <div className={ui.dialogFoot}>
          <Button variant="quiet" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          {mode === "paste" ? (
            <Button variant="primary" disabled={!name.trim() || !text.trim()} onClick={() => { onAdd({ name: name.trim(), kind: "text", text, chars: text.length }, null); reset(); }}>Add text</Button>
          ) : null}
          {mode === "link" ? (
            <Button variant="primary" disabled={!/^https:\/\/\S+\.\S+/.test(url.trim())} onClick={() => { onAdd(null, url.trim()); reset(); }}>Add page</Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
