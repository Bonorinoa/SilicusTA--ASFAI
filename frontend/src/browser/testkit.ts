/**
 * testkit.ts — test doubles for the browser host: an in-memory Web Storage, and a stand-in for the site's two
 * functions that follows their fixed contract (status, the model proxy, the link reader, the passcode header,
 * and every refusal code). Test-only; nothing in the app imports it.
 */
import { IDBFactory } from "fake-indexeddb";
import { chatCompletion } from "../../../host/test/scripted-course.mjs";
import { createBrowserHost, type BrowserHost } from "./browserHost";
import { passcodeKeeper, setPasscodePrompt, type PasscodeReason } from "./passcode";

export const ORIGIN = "http://127.0.0.1:4317";

/** A Web Storage that keeps strings in a Map, like the real one. */
export class MemoryStorage implements Storage {
  #m = new Map<string, string>();
  get length() { return this.#m.size; }
  clear() { this.#m.clear(); }
  getItem(k: string) { return this.#m.has(k) ? this.#m.get(k)! : null; }
  key(i: number) { return [...this.#m.keys()][i] ?? null; }
  removeItem(k: string) { this.#m.delete(k); }
  setItem(k: string, v: string) { this.#m.set(k, String(v)); }
  entries() { return [...this.#m.entries()]; }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export interface FakeSiteOptions {
  passcode?: string;
  status?: Record<string, unknown> | null;
  /** Replace the model proxy's answer (e.g. a 502 with status 402). Return null for the normal answer. */
  worker?: (body: any) => Response | null;
  pages?: Record<string, { name: string; text: string }>;
}

export function fakeSite({ passcode = "letmein", status = { configured: true, zdr: true, provider: "openrouter", passcodeRequired: true }, worker, pages = {} }: FakeSiteOptions = {}) {
  const calls: { url: string; passcode: string | null; body: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, passcode: headers.get("x-silicus-passcode"), body });
    const path = url.replace(ORIGIN, "");
    if (path === "/api/worker/status") return status ? json(200, status) : json(404, { error: { code: "NOT_FOUND" } });
    const gated = status?.passcodeRequired !== false;
    if (path === "/api/worker" || path === "/api/fetch") {
      if (gated && headers.get("x-silicus-passcode") !== passcode) return json(401, { error: { code: "BAD_PASSCODE" } });
    }
    if (path === "/api/worker") {
      const parsed = JSON.parse(body ?? "{}");
      return worker?.(parsed) ?? json(200, chatCompletion(parsed));
    }
    if (path === "/api/fetch") {
      const { url: target } = JSON.parse(body ?? "{}") as { url: string };
      const page = pages[target];
      return page ? json(200, { name: page.name, text: page.text, chars: page.text.length, digest: "x" }) : json(422, { error: { code: "URL_REFUSED", message: "that address is not a public one" } });
    }
    return json(404, { error: { code: "NOT_FOUND" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export interface Rig {
  host: BrowserHost;
  idb: IDBFactory;
  session: MemoryStorage;
  local: MemoryStorage;
  site: ReturnType<typeof fakeSite>;
  asked: PasscodeReason[];
  /** A fresh host over the SAME IndexedDB and storages: what a page reload does. */
  reload(): Promise<BrowserHost>;
  call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any }>;
}

/** A browser host on fake IndexedDB; the passcode prompt answers from `answers` in order. */
export async function rig({ site = fakeSite(), answers = ["letmein"] as (string | null)[], idb = new IDBFactory(), session = new MemoryStorage(), local = new MemoryStorage() } = {}): Promise<Rig> {
  const asked: PasscodeReason[] = [];
  const queue = [...answers];
  setPasscodePrompt(async (reason) => { asked.push(reason); return queue.length ? queue.shift()! : null; });
  const make = () => createBrowserHost({ indexedDB: idb, fetchImpl: site.fetchImpl, origin: ORIGIN, passcode: passcodeKeeper(() => session), localStore: () => local, channel: null });
  const r: Rig = {
    host: await make(), idb, session, local, site, asked,
    async reload() { r.host = await make(); return r.host; },
    async call(method, path, body) { const out = await r.host.handle({ method, path, body }); return { status: out.status, json: out.json as any }; },
  };
  return r;
}

/** Every string this browser holds for Silicus: every IndexedDB value and every Web Storage entry. */
export async function everythingStored(r: Rig): Promise<string> {
  const d = await r.host.dump();
  return JSON.stringify({ idb: d, session: r.session.entries(), local: r.local.entries() });
}
