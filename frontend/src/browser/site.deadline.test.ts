/**
 * The deadline covers the network, never the teacher.
 *
 * Found live on production (2026-10-14): PlanWorker starts its 60 s AbortSignal.timeout BEFORE calling the site's
 * fetch, and the site's fetch waits for the passcode dialog inside it. A teacher who took more than a minute to
 * type the passcode got "the drafting worker could not be reached: signal timed out" and no request ever left the
 * page. The site now starts a fresh deadline per network attempt, after it has the passcode, and a timeout is a
 * plain message.
 */
import { describe, expect, it } from "vitest";
import { createSite, MESSAGES } from "./site";
import { PlanWorker, WorkerError } from "../../../host/worker.mjs";
import type { PasscodeKeeper } from "./passcode";

const ORIGIN = "https://site.test";
const status = () => new Response(JSON.stringify({ configured: true, zdr: true, provider: "openrouter", passcodeRequired: true }), { status: 200 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A keeper whose dialog takes `delay` ms before the teacher answers. */
function slowTeacher(delay: number, code = "right-passcode"): PasscodeKeeper {
  let held: string | null = null;
  return {
    get: () => held,
    set: (c) => { held = c; },
    clear: () => { held = null; },
    ask: async () => { await sleep(delay); held = code; return code; },
  };
}

/** A fetch that behaves like the real one about signals: an aborted signal rejects with the browser's TimeoutError. */
function siteFetch(reply: (url: string, init: RequestInit) => Promise<Response>, seen: { url: string; signalAborted: boolean; passcode: string | null }[]) {
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/api/worker/status")) return status();
    const signal = init.signal ?? undefined;
    seen.push({ url, signalAborted: !!signal?.aborted, passcode: new Headers(init.headers).get("x-silicus-passcode") });
    if (signal?.aborted) throw new DOMException("signal timed out", "TimeoutError");
    return await new Promise<Response>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("signal timed out", "TimeoutError")), { once: true });
      reply(url, init).then(resolve, reject);
    });
  }) as typeof fetch;
}

const objectivesReply = () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ objectives: [{ statement: "Students can say what a plant needs to make food.", from: ["notes"] }] }) } }],
}), { status: 200 });

describe("the site's deadline starts when the request leaves, not when the teacher is asked", () => {
  it("a passcode dialog that outlasts the worker's own deadline still sends the request (the production failure)", async () => {
    const seen: { url: string; signalAborted: boolean; passcode: string | null }[] = [];
    const site = createSite({ origin: ORIGIN, fetchImpl: siteFetch(async () => objectivesReply(), seen), passcode: slowTeacher(150) });
    const worker = new PlanWorker({ url: `${ORIGIN}/api/worker`, model: "server", timeoutMs: 50, fetchImpl: ((u: string, i: RequestInit) => site.workerFetch(u, i)) as typeof fetch });
    const out = await worker.draftObjectives({ materials: [{ name: "notes", text: "Plants use light, water and air to make sugar." }], topic: "Plants" });
    const list = (Array.isArray(out) ? out : (out as unknown as { objectives: unknown[] }).objectives) as unknown[];
    expect(list.length).toBeGreaterThan(0);
    const calls = seen.filter((s) => s.url.endsWith("/api/worker"));
    expect(calls).toHaveLength(1);
    expect(calls[0].signalAborted).toBe(false);
    expect(calls[0].passcode).toBe("right-passcode");
  });

  it("a request that hangs ends at the site's own deadline, with a plain message (no raw 'signal timed out')", async () => {
    const seen: { url: string; signalAborted: boolean; passcode: string | null }[] = [];
    const keeper = slowTeacher(0); keeper.set("right-passcode");
    const site = createSite({ origin: ORIGIN, fetchImpl: siteFetch(() => new Promise<Response>(() => {}), seen), passcode: keeper, requestTimeoutMs: 60 });
    const err = await site.workerFetch(`${ORIGIN}/api/worker`, { method: "POST", body: "{}" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).code).toBe("WORKER_UNREACHABLE");
    expect((err as Error).message).toBe(MESSAGES.timeout);
    expect((err as Error).message).not.toMatch(/signal/i);
  });

  it("the same holds for reading a link: the dialog does not count, a hung read is a plain message", async () => {
    const seen: { url: string; signalAborted: boolean; passcode: string | null }[] = [];
    const site = createSite({ origin: ORIGIN, fetchImpl: siteFetch(() => new Promise<Response>(() => {}), seen), passcode: slowTeacher(80), requestTimeoutMs: 60 });
    const err = await site.resolveUrl("https://example.org/page").then(() => null, (e) => e);
    expect((err as { code?: string }).code).toBe("URL_UNREACHABLE");
    expect((err as Error).message).not.toMatch(/signal/i);
    expect(seen.filter((s) => s.url.endsWith("/api/fetch"))[0].signalAborted).toBe(false);
  });
});
