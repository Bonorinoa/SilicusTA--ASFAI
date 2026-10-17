/** New course: one short sheet instead of a three-question conversation. Nothing is written until Create. */
import { useId, useState } from "react";
import { host } from "../gate/transport";
import { Button, Dialog, Notice, ui } from "./ui";

export function NewCourseDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { title: useId(), owner: useId(), names: useId() };
  const ready = title.trim() !== "" && owner.trim() !== "";

  const create = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const materials = names.split("\n").map((n) => n.trim()).filter(Boolean).slice(0, 24).map((name) => ({ name: name.slice(0, 200) }));
      const r = await host.createCourse({ title: title.trim(), owner: owner.trim(), materials });
      setTitle(""); setOwner(""); setNames("");
      onCreated(r.courseId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} label="New course">
      <form className={ui.dialogBody} onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <h2 style={{ fontSize: "1.5rem" }}>New course</h2>
        <div className={ui.field}>
          <label className={ui.label} htmlFor={ids.title}>Course title</label>
          <input id={ids.title} className={ui.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How plants eat" autoFocus />
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor={ids.owner}>Your name</label>
          <input id={ids.owner} className={ui.input} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Ms. Lovelace" />
          <span className={ui.hint}>Shown on the plan and the published version.</span>
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor={ids.names}>Sources <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea id={ids.names} className={ui.textarea} rows={3} value={names} onChange={(e) => setNames(e.target.value)} placeholder={"Photosynthesis worksheet\nChapter 4 slides"} />
          <span className={ui.hint}>One name per line. You add the files themselves in the studio.</span>
        </div>
        {error ? <Notice>{error}</Notice> : null}
        <div className={ui.dialogFoot}>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!ready || busy}>{busy ? "Creating…" : "Create course"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
