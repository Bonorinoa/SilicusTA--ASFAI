/**
 * browserHost.ts — the Silicus host, running in the teacher's browser.
 *
 * The online build has no server that could keep a course (Vercel has no disk, and one shared server would
 * mix visitors' courses), so the teacher's browser IS the host. This module is an ADAPTER, not a second
 * host: the routes, the intents-only request shapes, the per-course lock, the verified replay per request,
 * the decision whitelist and the error mapping are all host/handler.mjs + host/course.mjs, the same files the
 * Node host runs. What this module supplies is the dependencies:
 *
 *   storage    record-store.mjs written through to IndexedDB (idb.ts). Loaded once at startup, every write
 *              awaited before a request answers. The record is the disk host's exact bytes.
 *   hashing    the shared synchronous SHA-256 (host/lib/sha256.mjs, via the node:crypto alias).
 *   worker     PlanWorker pointed at the site's /api/worker, with the passcode (site.ts).
 *   materials  pasted text and files are read here; a public link goes to the site's /api/fetch;
 *              YouTube is refused with a plain "needs the local app".
 *   knowledge  none. ASFAI is off online: its consent flow and token belong to the local app.
 *
 * Why load-once + write-through rather than reading IndexedDB per request: course code is synchronous and
 * IndexedDB is not. The copy in memory is replaced from IndexedDB at every start (a reload re-verifies every
 * course from what is actually stored) and whenever another tab says it wrote; every request still replays
 * the course through chain verification, and every write is an `add` that cannot overwrite a record, so a
 * divergent copy fails closed on its next write instead of overwriting the record.
 */
import { createHandler, HttpError, MAX_BODY } from "../../../host/handler.mjs";
import { RecordStore } from "../../../host/record-store.mjs";
import { PlanWorker } from "../../../host/worker.mjs";
import { prepareMaterialsWith } from "../../../host/materials-core.mjs";
import { buildBackup, readBackup } from "../../../host/backup.mjs";
import { clearAll, openDb, readAll, writeBatch, type EventRow, type MetaRow, type Write } from "./idb";
import { passcodeKeeper, PASSCODE_KEY, type PasscodeKeeper } from "./passcode";
import { createSite, type Site } from "./site";

export interface HostResponse { status: number; json: unknown }

export interface ImportResult { imported: string[]; alreadyHere: string[] }

export interface BrowserHost {
  /** One API request, answered in-page. Same {status, json} contract as the Node host over HTTP. */
  handle(req: { method: "GET" | "POST"; path: string; body?: unknown }): Promise<HostResponse>;
  /** Every course whose record verifies, as one file Import accepts. */
  exportAll(): Promise<{ text: string; filename: string; included: string[]; skipped: { title: string; reason: string }[] }>;
  /** Verify a file and add its courses. All or nothing; throws BackupError with a plain message. */
  importAll(text: string): Promise<ImportResult>;
  /** Forget every course, pin and passcode this browser holds for Silicus. */
  deleteAll(): Promise<void>;
  /** Every stored value, for tests and the "what does this browser hold" proof. */
  dump(): Promise<{ metas: MetaRow[]; events: EventRow[] }>;
  site: Site;
}

export interface BrowserHostOptions {
  indexedDB?: IDBFactory;
  fetchImpl?: typeof fetch;
  origin?: string;
  passcode?: PasscodeKeeper;
  /** localStorage, where the teacher-device pins live (cleared by deleteAll). */
  localStore?: () => Storage | null;
  /** Another tab wrote: re-read before the next request. null disables (tests). */
  channel?: { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null } | null;
}

const localOnly = () => Object.assign(
  new Error("ASFAI needs the local Silicus app. Online, Silicus asks its own questions and this browser keeps the course."),
  { code: "LOCAL_APP_ONLY" },
);

/** ASFAI is off in the browser: a status that says so, and every action refused in words. */
const NO_ASFAI = {
  status: () => ({ connected: false, expiresAt: null, scope: null, canRefresh: false, available: false }),
  oauth: { beginAuthorization: async () => { throw localOnly(); }, handleCallback: async () => { throw localOnly(); } },
  runIntake: async () => { throw localOnly(); },
  validate: async () => { throw localOnly(); },
};

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

export async function createBrowserHost(opts: BrowserHostOptions = {}): Promise<BrowserHost> {
  const factory = opts.indexedDB ?? globalThis.indexedDB;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const origin = opts.origin ?? globalThis.location.origin;
  const passcode = opts.passcode ?? passcodeKeeper();
  const localStore = opts.localStore ?? (() => { try { return globalThis.localStorage ?? null; } catch { return null; } });
  const channel = opts.channel === undefined
    ? (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("silicus-host"))
    : opts.channel;

  const db = await openDb(factory);

  // Writes leave the synchronous store here and are committed in one transaction per synchronous burst
  // (a course's meta and its first event land together, or not at all).
  let pending: Write[] = [];
  let scheduled = false;
  const outstanding = new Set<Promise<unknown>>();
  let wrote = false;
  const commit = () => {
    scheduled = false;
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;
    const p = writeBatch(db, batch).then(() => null, (e: unknown) => e);
    outstanding.add(p);
    void p.finally(() => outstanding.delete(p));
  };
  const store = new RecordStore({
    onWrite: (w: Write) => {
      pending.push(w);
      wrote = true;
      if (!scheduled) { scheduled = true; queueMicrotask(commit); }
    },
  });
  /** Wait for every write so far; the first failure, if any. */
  const settle = async (): Promise<unknown> => {
    if (pending.length) commit();
    const results = await Promise.all([...outstanding]);
    return results.find((r) => r !== null) ?? null;
  };

  const reload = async () => { store.load(await readAll(db)); };
  await reload();

  let stale = false;
  let inFlight = 0;
  if (channel) channel.onmessage = () => { stale = true; };
  const announce = () => { try { channel?.postMessage("changed"); } catch { /* a closed channel is not an error */ } };

  const site = createSite({ origin, fetchImpl, passcode });
  const worker = new PlanWorker({
    provider: "openai",
    url: `${origin}/api/worker`,
    model: "server",          // a placeholder: the site's function chooses the model
    apiKey: null,             // the key lives in the function, never in the browser
    zdr: false,               // the site decides zero-retention; the UI reads it from the site's status
    fetchImpl: ((url: string, init: RequestInit) => site.workerFetch(url, init)) as typeof fetch,
  });

  const handler = createHandler({
    store,
    asfai: NO_ASFAI,
    worker,
    workerStatus: async () => {
      const st = await site.status();
      return { configured: st.configured, zdr: st.zdr, provider: st.provider, passcodeRequired: st.passcodeRequired };
    },
    sources: [],
    archives: null,
    prepareMaterials: (items: unknown) => prepareMaterialsWith(items, (url: string) => site.resolveUrl(url)),
  });

  async function handle({ method, path, body }: { method: "GET" | "POST"; path: string; body?: unknown }): Promise<HostResponse> {
    if (stale && inFlight === 0) { stale = false; await reload(); }
    inFlight += 1;
    wrote = false;
    try {
      // The same body discipline as the Node transport: JSON in, size-capped, read only by routes that read it.
      const raw = body === undefined ? "" : JSON.stringify(body);
      const readBody = async () => {
        if (utf8Length(raw) > MAX_BODY) throw new HttpError(413, "BODY_TOO_LARGE", "request body too large");
        return raw.trim() ? JSON.parse(raw) : {};
      };
      const out = (await handler.handle({ method, url: path, readBody })) as { status: number; json?: unknown };
      const failure = await settle();
      if (failure) {
        await reload(); // memory goes back to exactly what is stored
        const conflict = (failure as { name?: string })?.name === "ConstraintError";
        return conflict
          ? { status: 409, json: { ok: false, code: "STORAGE_CONFLICT", message: "This course changed in another tab. Reload this page to see its latest record. Nothing was recorded here." } }
          : { status: 503, json: { ok: false, code: "STORAGE_FAILED", message: "This browser did not save that change, so nothing was recorded. Try again." } };
      }
      if (wrote) announce();
      // Exactly what HTTP would deliver: a JSON round trip, so no reference into the store ever leaves.
      return { status: out.status, json: out.json === undefined ? undefined : JSON.parse(JSON.stringify(out.json)) };
    } finally {
      inFlight -= 1;
    }
  }

  async function exportAll() {
    await reload(); // export what is actually stored
    const { file, included, skipped } = buildBackup(store, { at: Date.now() });
    const day = new Date().toISOString().slice(0, 10);
    return {
      text: JSON.stringify(file, null, 2) + "\n",
      filename: `silicus-courses-${day}.json`,
      included: included.map((c: { title: string }) => c.title),
      skipped: skipped.map((s: { title: string; reason: string }) => ({ title: s.title, reason: s.reason })),
    };
  }

  async function importAll(text: string): Promise<ImportResult> {
    const { courses } = readBackup(text); // throws BackupError: nothing is written
    await reload();
    const known = new Map(store.snapshot().map((c: { courseId: string; lines: string[] }) => [c.courseId, c.lines]));
    const alreadyHere: string[] = [];
    const writes: Write[] = [];
    const conflicts: string[] = [];
    for (const c of courses) {
      const mine = known.get(c.courseId);
      if (mine) {
        if (JSON.stringify(mine) === JSON.stringify(c.lines)) alreadyHere.push(c.title);
        else conflicts.push(c.title);
        continue;
      }
      writes.push({ type: "meta", courseId: c.courseId, text: c.metaText });
      c.lines.forEach((line: string, i: number) => writes.push({ type: "event", courseId: c.courseId, seq: i + 1, line }));
    }
    if (conflicts.length) {
      const e = new Error(`${conflicts.map((t) => `“${t}”`).join(", ")} ${conflicts.length === 1 ? "is" : "are"} already in this browser with a different record. Nothing was imported.`);
      throw Object.assign(e, { name: "BackupError", code: "ALREADY_DIFFERENT" });
    }
    await writeBatch(db, writes);
    await reload();
    if (writes.length) announce();
    return { imported: courses.filter((c: { title: string }) => !alreadyHere.includes(c.title)).map((c: { title: string }) => c.title), alreadyHere };
  }

  async function deleteAll() {
    await clearAll(db);
    await reload();
    passcode.clear();
    const ls = localStore();
    if (ls) {
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i += 1) { const k = ls.key(i); if (k && k.startsWith("silicus.")) keys.push(k); }
      keys.forEach((k) => ls.removeItem(k));
    }
    try { globalThis.sessionStorage?.removeItem(PASSCODE_KEY); } catch { /* none */ }
    announce();
  }

  return { handle, exportAll, importAll, deleteAll, dump: () => readAll(db), site };
}

let shared: Promise<BrowserHost> | null = null;

/** The page's one browser host (created on first use). */
export function browserHost(): Promise<BrowserHost> {
  if (!shared) {
    shared = createBrowserHost();
    shared.catch(() => { shared = null; }); // a blocked IndexedDB can be retried after the teacher fixes it
  }
  return shared;
}
