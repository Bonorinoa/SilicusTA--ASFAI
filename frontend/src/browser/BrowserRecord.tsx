/**
 * BrowserRecord — the online app's one standing notice: this browser keeps the record.
 *
 * Quiet and persistent, because it is the single most important fact about the online app: there is no
 * server copy. Three acts sit beside it: export every course to a file (the archive envelope with each
 * course's full, hash-chained log), import such a file (verified first; a file that does not verify is
 * refused whole and nothing is written), and delete everything this browser holds for Silicus (confirmed
 * first). A renderer plus three calls into the browser host; it decides nothing about a course.
 */
import { useId, useRef, useState } from "react";
import styles from "./BrowserRecord.module.css";

type Phase = "idle" | "confirmDelete" | "working";

/** The last thing the notice said. Held by the parent: an import or delete changes which page is shown. */
export type RecordStatus = { tone: "ok" | "refused"; text: string } | null;

async function host() {
  const { browserHost } = await import("./browserHost");
  return browserHost();
}

export function BrowserRecord({ hasCourses, onChanged, status, onStatus: setStatus }: {
  hasCourses: boolean;
  onChanged: () => void;
  status: RecordStatus;
  onStatus: (s: RecordStatus) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const file = useRef<HTMLInputElement>(null);
  const fileId = useId();

  const exportAll = async () => {
    setPhase("working");
    try {
      const out = await (await host()).exportAll();
      const url = URL.createObjectURL(new Blob([out.text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = out.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const n = out.included.length;
      setStatus({
        tone: out.skipped.length ? "refused" : "ok",
        text: `Exported ${n} course${n === 1 ? "" : "s"} to ${out.filename}.`
          + (out.skipped.length ? ` Left out, because ${out.skipped.length === 1 ? "its record does" : "their records do"} not verify: ${out.skipped.map((s) => `“${s.title}”`).join(", ")}.` : ""),
      });
    } catch (e) {
      setStatus({ tone: "refused", text: `Nothing was exported: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setPhase("idle");
    }
  };

  const importFile = async (list: FileList | null) => {
    const f = list?.[0];
    if (file.current) file.current.value = "";
    if (!f) return;
    setPhase("working");
    try {
      const r = await (await host()).importAll(await f.text());
      const n = r.imported.length;
      setStatus({
        tone: "ok",
        text: n
          ? `Imported ${n} course${n === 1 ? "" : "s"}. Every record was checked against its own fingerprints before it was kept.`
          : "Those courses are already in this browser, unchanged. Nothing new was imported.",
      });
      onChanged();
    } catch (e) {
      setStatus({ tone: "refused", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPhase("idle");
    }
  };

  const deleteAll = async () => {
    setPhase("working");
    try {
      await (await host()).deleteAll();
      setStatus({ tone: "ok", text: "Every course, pinned copy and passcode this browser held for Silicus is gone." });
      onChanged();
    } catch (e) {
      setStatus({ tone: "refused", text: `Nothing was deleted: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setPhase("idle");
    }
  };

  const busy = phase === "working";
  return (
    <section className={styles.record} aria-label="Where your courses are kept">
      <p className={styles.label}>This browser keeps the record</p>
      <p className={styles.text}>
        Your courses are stored in this browser only, not on a server. Export to keep a copy: clearing this
        browser’s data, or using another browser, starts empty.
      </p>
      {phase === "confirmDelete" ? (
        <div className={styles.confirm} role="group" aria-label="Confirm deleting everything">
          <p className={styles.text}>
            Delete every course, pinned copy and passcode this browser holds for Silicus? This cannot be undone.
            {hasCourses ? " Export first if you may need them." : ""}
          </p>
          <div className={styles.verbs}>
            <button type="button" className={styles.danger} onClick={() => void deleteAll()}>Delete everything</button>
            <button type="button" className={styles.quiet} onClick={() => setPhase("idle")}>Keep them</button>
          </div>
        </div>
      ) : (
        <div className={styles.verbs}>
          <button type="button" className={styles.quiet} onClick={() => void exportAll()} disabled={busy || !hasCourses}>Export all courses</button>
          <input id={fileId} ref={file} className={styles.file} type="file" accept=".json,application/json" disabled={busy}
            aria-label="Import courses from an exported file" onChange={(e) => void importFile(e.target.files)} />
          <label className={styles.quiet} htmlFor={fileId} aria-hidden="true" aria-disabled={busy || undefined}>Import</label>
          <button type="button" className={styles.link} onClick={() => { setStatus(null); setPhase("confirmDelete"); }} disabled={busy}>
            Delete all data from this browser
          </button>
        </div>
      )}
      {status ? <p className={styles.status} data-tone={status.tone} role="status">{status.text}</p> : null}
    </section>
  );
}
