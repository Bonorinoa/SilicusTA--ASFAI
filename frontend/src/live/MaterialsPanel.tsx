/**
 * MaterialsPanel — hand Silicus the course material, and it PROPOSES objectives from it.
 *
 * A renderer plus a few inputs, holding no policy. The material lives in this component's memory
 * and nowhere else: it is never written to storage, and it leaves once, in one request, to the
 * host. Reloading the page forgets it, and the panel says so. The host returns proposals, which the
 * teacher then accepts, renames, drops or adds like any other.
 */
import { useId, useRef, useState } from "react";
import type { MaterialInput } from "../gate/transport";
import styles from "./OnboardingChat.module.css";

const TEXTLIKE = /\.(txt|md|markdown|vtt|srt|html?|csv)$/i;
const MAX_FILE = 400_000;

/** A YouTube link, by host name. Only used to say, before anything is sent, that it needs the local app. */
const YOUTUBE = /^https?:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be)(\/|$)/i;

export function MaterialsPanel({
  busy, zdr, youtube = true, onPropose,
}: {
  busy: boolean;
  /** Can this host read YouTube captions? The online app cannot (it needs the local app's tools). */
  youtube?: boolean;
  /**
   * Is the worker told to use zero-data-retention endpoints only? Config, from the host. Only an
   * explicit true earns the zero-retention sentence: anything else says the plain truth.
   */
  zdr: boolean | null;
  onPropose: (materials: MaterialInput[]) => void;
}) {
  const [items, setItems] = useState<MaterialInput[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), text: useId(), url: useId(), file: useId() };

  const add = (m: MaterialInput) => { setItems((xs) => [...xs, m].slice(0, 8)); setNote(null); };

  const addPasted = () => {
    if (!text.trim() || !name.trim()) { setNote("Give the pasted text a name, then paste it."); return; }
    add({ name: name.trim().slice(0, 160), text });
    setName(""); setText("");
  };
  const addUrl = () => {
    const u = url.trim();
    if (!u) return;
    if (!youtube && YOUTUBE.test(u)) { setNote("YouTube captions can only be read by the local Silicus app. Paste the transcript as text instead."); return; }
    add({ url: u });
    setUrl("");
  };
  const addFiles = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      if (!TEXTLIKE.test(f.name)) { setNote(`${f.name}: only text-like files (.txt, .md, .vtt, .srt, .html) can be read for now. Paste the text instead.`); continue; }
      if (f.size > MAX_FILE) { setNote(`${f.name} is too large. Paste the part you want used.`); continue; }
      add({ name: f.name, text: await f.text() });
    }
    if (file.current) file.current.value = "";
  };

  return (
    <section className={styles.composer} aria-label="Course material">
      <span className={styles.who}>Silicus</span>
      <p className={styles.prompt}>Give me the material and I will propose the objectives.</p>
      <p className={styles.kept}>
        Paste text, add a text file, or paste a link to a public web page{youtube ? " or a YouTube video" : ""}. You decide every
        objective afterwards. The material stays in this tab only: it is not saved, and it is sent once to the
        drafting worker{zdr === true
          ? ", which is set to zero-data-retention providers only"
          : ", under that provider's normal data-retention terms (not zero-retention), so use public material or material you may share"}. Reload and it is gone.
      </p>

      {items.length > 0 ? (
        <ul className={styles.turns} aria-label="Material added">
          {items.map((m, i) => (
            <li key={i} className={styles.pair}>
              <p className={styles.said}>{"url" in m ? m.url : `${m.name} · ${m.text.length.toLocaleString()} characters`}</p>
              <button type="button" className={styles.edit} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                aria-label={`Remove ${"url" in m ? m.url : m.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className={styles.prompt} htmlFor={ids.url}>A public link</label>
      {youtube ? null : <p className={styles.kept}>YouTube captions need the local Silicus app; paste a transcript instead.</p>}
      <input id={ids.url} className={styles.box} type="url" value={url} autoComplete="off" placeholder="https://…"
        onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }} />
      <div className={styles.verbs}><button type="button" className={styles.quiet} onClick={addUrl} disabled={busy || !url.trim()}>Add this link</button></div>

      <label className={styles.prompt} htmlFor={ids.file}>A text file</label>
      <input id={ids.file} ref={file} type="file" multiple accept=".txt,.md,.markdown,.vtt,.srt,.html,.htm,.csv"
        onChange={(e) => void addFiles(e.target.files)} />

      <label className={styles.prompt} htmlFor={ids.name}>Or paste text — name it first</label>
      <input id={ids.name} className={styles.box} type="text" value={name} maxLength={160} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      <textarea id={ids.text} aria-label="Pasted text" className={`${styles.box} ${styles.boxTall}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <div className={styles.verbs}><button type="button" className={styles.quiet} onClick={addPasted} disabled={busy}>Add this text</button></div>

      {note ? <p className={styles.refusal} role="status">{note}</p> : null}
      <button type="button" className={styles.send} disabled={busy || items.length === 0} onClick={() => onPropose(items)}>
        Propose objectives from my materials
      </button>
    </section>
  );
}
