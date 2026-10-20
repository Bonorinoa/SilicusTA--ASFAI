/**
 * Sources: the names on the course record, plus the text this tab holds for them. Text never leaves the tab until
 * the teacher asks for objectives from it, and a reload forgets it (materials/session.ts).
 */
import { useId, useState } from "react";
import { BROWSER_MODE } from "../gate/mode";
import { plural } from "../lib/plural";
import { describeFile } from "../materials/display";
import type { HeldFile } from "../materials/session";
import { SourceDrop } from "./SourceDrop";
import { shortAddress } from "./sourceIntake";
import { legacyNames, skippedLine, usedFor, usedLine, type Skipped } from "./sourceUse";
import { Button, Dialog, Soon, ui } from "./ui";
import s from "./Studio.module.css";

const KIND_LABEL: Record<string, string> = { pdf: "PDF", docx: "DOC", pptx: "PPT", text: "TXT", link: "URL" };
const MAX_ITEMS = 8;

export function SourcesPanel({ names, held, links, onHeld, onLinks, confirmed, proposals = [], skipped = [] }: {
  names: string[];
  held: HeldFile[];
  links: string[];
  onHeld: (next: HeldFile[]) => void;
  onLinks: (next: string[]) => void;
  confirmed: boolean;
  /** The host's proposals; "Used for N proposals" is counted off their own "from material:" labels (R6). */
  proposals?: readonly { source: string | null }[];
  /** What the host skipped in this tab's last round from sources. */
  skipped?: readonly Skipped[];
}) {
  const [adding, setAdding] = useState(false);
  // On a phone the panel folds into one bar above the step (R8); on wider screens it is always open.
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  // Names on the record that this tab has no text for yet; an attached file covers one ignoring case and extension.
  const waiting = legacyNames(names, held);
  /** What happened to a source in the host's rounds: skipped in the last one, or used for N proposals. */
  const use = (name: string): string | null => {
    const skip = skippedLine(name, skipped);
    if (skip) return skip;
    const n = usedFor(name, proposals);
    return n > 0 ? usedLine(n) : null;
  };
  const useRow = (name: string) => {
    const line = use(name);
    return line ? <><br /><span className={s.sourceMeta} data-source-use={line.startsWith("Skipped") ? "skipped" : "used"}>{line}</span></> : null;
  };
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
              <span className={s.sourceMeta}>Read in this tab · {describeFile(h).replace(`${h.name} · `, "")}</span>
              {useRow(h.name)}
            </span>
            <button type="button" className={s.sourceRemove} aria-label={`Remove ${h.name} from this tab`} onClick={() => onHeld(held.filter((x) => x !== h))}>×</button>
          </li>
        ))}
        {links.map((u) => (
          <li key={`l-${u}`} className={s.sourceItem}>
            <span className={s.sourceIcon} aria-hidden="true">URL</span>
            <span style={{ minWidth: 0 }}><span className={s.sourceName}>{shortAddress(u)}</span><br /><span className={s.sourceMeta}>Fetched when Silicus reads it</span>{useRow(u)}</span>
            <button type="button" className={s.sourceRemove} aria-label={`Remove ${u}`} onClick={() => onLinks(links.filter((x) => x !== u))}>×</button>
          </li>
        ))}
        {waiting.map((n) => (
          <li key={`n-${n}`} className={s.sourceItem}>
            <span className={s.sourceIcon} aria-hidden="true" style={{ background: "transparent", border: "1px dashed var(--fn-line-dash)" }}>…</span>
            <span style={{ minWidth: 0 }}>
              <span className={s.sourceName}>{n}</span><br />
              <span className={s.sourceMeta}>Named only, so Silicus has no text for it. </span>
              <button type="button" className={s.sourceAttach} onClick={() => setAdding(true)} aria-label={`Attach the file for ${n}`}>Attach the file</button>
              {useRow(n)}
            </span>
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
        taken={held.map((h) => h.name)}
        full={held.length + links.length >= MAX_ITEMS}
        onFile={(file) => onHeld([...held.filter((h) => h.name !== file.name), file].slice(0, MAX_ITEMS))}
        onLink={(link) => onLinks([...links.filter((u) => u !== link), link])}
      />
    </aside>
  );
}

function AddSourceDialog({ open, onClose, taken, full, onFile, onLink }: {
  open: boolean; onClose: () => void; taken: readonly string[]; full: boolean;
  onFile: (file: HeldFile) => void; onLink: (url: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} label="Add a source">
      <div className={ui.dialogBody}>
        <h2 style={{ fontSize: "1.5rem" }}>Add a source</h2>
        <SourceDrop taken={taken} full={full} onFile={onFile} onLink={onLink} />
        <div className={ui.dialogFoot}>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}
