/**
 * idb.ts — the few IndexedDB operations the browser host needs, with no wrapper library.
 *
 * Two object stores, holding exactly the bytes the disk host writes:
 *   courses  {courseId, text}        text = the meta.json document
 *   events   {courseId, seq, line}   line = one NDJSON record of the hash-chained log, keyed [courseId, seq]
 *
 * Events are written with `add`, never `put`: an existing [courseId, seq] is never overwritten. A second tab
 * that appends to a course this tab already extended therefore fails its whole transaction instead of
 * silently replacing a record (the chain would then not verify).
 */
export const DB_NAME = "silicus-host";
const DB_VERSION = 1;

export interface MetaRow { courseId: string; text: string }
export interface EventRow { courseId: string; seq: number; line: string }
export type Write = ({ type: "meta" } & MetaRow) | ({ type: "event" } & EventRow);

const done = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const committed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
});

export function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("courses")) db.createObjectStore("courses", { keyPath: "courseId" });
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: ["courseId", "seq"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("this browser's storage is blocked by another Silicus tab"));
  });
}

/** Everything, in one read-only transaction (a consistent snapshot). */
export async function readAll(db: IDBDatabase): Promise<{ metas: MetaRow[]; events: EventRow[] }> {
  const tx = db.transaction(["courses", "events"], "readonly");
  const [metas, events] = await Promise.all([
    done(tx.objectStore("courses").getAll() as IDBRequest<MetaRow[]>),
    done(tx.objectStore("events").getAll() as IDBRequest<EventRow[]>),
  ]);
  return { metas, events };
}

/** One transaction for a batch of writes: all land, or none do. */
export async function writeBatch(db: IDBDatabase, writes: Write[]): Promise<void> {
  if (writes.length === 0) return;
  const tx = db.transaction(["courses", "events"], "readwrite");
  const ok = committed(tx);
  // The transaction's own error can be empty by the time it aborts; the failing request's is the reason
  // (a ConstraintError means the key already exists: another tab wrote first).
  let first: DOMException | null = null;
  for (const w of writes) {
    const req = w.type === "meta"
      ? tx.objectStore("courses").add({ courseId: w.courseId, text: w.text })
      : tx.objectStore("events").add({ courseId: w.courseId, seq: w.seq, line: w.line });
    req.onerror = () => { first ??= req.error; };
  }
  try {
    await ok;
  } catch (e) {
    throw first ?? e;
  }
}

/** Remove every course and every event. */
export async function clearAll(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(["courses", "events"], "readwrite");
  const ok = committed(tx);
  tx.objectStore("courses").clear();
  tx.objectStore("events").clear();
  await ok;
}
