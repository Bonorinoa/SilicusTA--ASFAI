// @vitest-environment node
/**
 * browserHost.test.ts — the browser host is the SAME host with different adapters, and the locks hold in it.
 *
 *   parity        the scripted course through the Node host (child process: real HTTP, disk, node:crypto) and
 *                 through the browser host (fake IndexedDB, the shared SHA-256) — identical transcript and log
 *   reload        a fresh host over the same IndexedDB replays every course to the same view
 *   tamper        an edited or missing IndexedDB record is flagged "needs attention", never served
 *   materials     material text never reaches IndexedDB, localStorage or sessionStorage
 *   student chat  asking writes nothing (the whole store compared before and after)
 *   backup        export -> delete all -> import round-trips and verifies; a tampered file is refused whole
 *   passcode      sessionStorage only; a 401 clears it and asks again; no AI action, no passcode needed
 *   refusals      the site's 402 / 429 / 503 become words a teacher can act on
 *   local-only    ASFAI and YouTube say "the local app"; archive is not offered
 *   pin           the teacher-device pin still catches a self-consistent rewrite of the stored record
 *   tabs          a second tab that writes over a stale copy fails closed, never overwrites
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MATERIAL, MATERIAL_SECRET, runScriptedCourse } from "../../../host/test/scripted-course.mjs";
import { linkDigest } from "../../../host/chain.mjs";
import { comparePin, pinVersion, type CourseAnchor } from "../gate/pin";
import { PASSCODE_KEY, setPasscodePrompt } from "./passcode";
import { MESSAGES } from "./site";
import { createBrowserHost } from "./browserHost";
import { everythingStored, fakeSite, MemoryStorage, ORIGIN, rig, type Rig } from "./testkit";

const PARITY_SCRIPT = fileURLToPath(new URL("../../../host/scripts/parity-run.mjs", import.meta.url));

afterEach(() => { setPasscodePrompt(null); vi.restoreAllMocks(); });

/** The shared scripted course (host/test/scripted-course.mjs), driven through this browser host. */
const drive = (r: Rig) => runScriptedCourse((m: string, p: string, b?: unknown) => r.call(m as "GET" | "POST", p, b));

/** A course at the outline gate, answered with the host's own questions; nothing here needs AI. */
async function readyCourse(r: Rig, { fromMaterials = true } = {}) {
  const created = await r.call("POST", "/api/courses", { owner: "Ada Lovelace", title: "How plants eat", materials: [{ name: MATERIAL.name }] });
  const c = `/api/courses/${encodeURIComponent(created.json.courseId)}`;
  await r.call("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  await r.call("POST", `${c}/intake/answer`, { text: "topic", answers: { topic: "photosynthesis" } });
  await r.call("POST", `${c}/intake/answer`, { text: "course", answers: { course: "Science, ages 8-10" } });
  if (fromMaterials) await r.call("POST", `${c}/intake/answer`, { text: "Propose the outcomes from my materials.", answers: { outcomes_from: "materials" } });
  else await r.call("POST", `${c}/intake/answer`, { text: "outcomes", answers: { learning_outcomes: "Students can explain how a plant makes food.\nStudents can name what a plant needs." } });
  const outline = await r.call("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  expect(outline.status).toBe(200);
  return { c, courseId: created.json.courseId as string };
}

describe("parity: one API, two hosts", () => {
  it("the scripted course gives the same transcript and a byte-identical log on the Node host and in the browser", async () => {
    const node = spawnSync(process.execPath, [PARITY_SCRIPT], { encoding: "utf8", timeout: 60_000 });
    expect(node.status, node.stderr).toBe(0);
    const disk = JSON.parse(node.stdout) as { transcript: any[]; lines: string[]; meta: string };

    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`);
    vi.spyOn(Date, "now").mockReturnValue(1767225600000);
    const r = await rig();
    const { transcript } = await drive(r);
    const dump = await r.host.dump();

    expect(transcript.length).toBe(disk.transcript.length);
    transcript.forEach((step: any, i: number) => expect(step, `step ${i}: ${step.method} ${step.path}`).toEqual(disk.transcript[i]));
    expect(dump.events.sort((a, b) => a.seq - b.seq).map((e) => e.line)).toEqual(disk.lines);
    expect(dump.metas.map((m) => m.text)).toEqual([disk.meta]);
    // It was a real course: published, grounded, the forged keys cut away on both hosts.
    expect(transcript.find((s: any) => s.path.endsWith("/publish"))?.status).toBe(200);
    expect(transcript.filter((s: any) => s.path.endsWith("/student/ask")).at(-1)?.json.grounded).toBe(true);
    expect(disk.lines.join("\n")).not.toMatch(/forged|attacker|mt_1/);
  }, 60_000);
});

describe("the record survives a reload, and a tampered record is flagged, never served", () => {
  it("a fresh host over the same IndexedDB replays the course to the same view, and the chain verifies", async () => {
    const r = await rig();
    const { courseId } = await drive(r);
    const c = `/api/courses/${encodeURIComponent(courseId)}`;
    const before = (await r.call("GET", c)).json;
    await r.reload();
    const after = (await r.call("GET", c)).json;
    expect(after).toEqual(before);
    expect(after.versions).toHaveLength(1);
    expect((await r.call("GET", `${c}/verify`)).json).toMatchObject({ ok: true, events: before.integrity.events, head: before.integrity.head });
    expect((await r.call("GET", "/api/courses")).json.courses[0].progress).toEqual({ confirmed: 5, total: 5, versions: 1 });
  });

  async function tamperWith(r: Rig, fn: (store: IDBObjectStore, row: { courseId: string; seq: number; line: string }) => void, seq: number) {
    const db = await new Promise<IDBDatabase>((res, rej) => { const q = r.idb.open("silicus-host"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("events", "readwrite");
      const st = tx.objectStore("events");
      const get = st.openCursor();
      get.onsuccess = () => {
        const cur = get.result;
        if (!cur) return;
        if ((cur.value as { seq: number }).seq === seq) fn(st, cur.value);
        cur.continue();
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }

  it("an edited event in IndexedDB: the library says it needs attention and the course is refused (409 LOG_INTEGRITY)", async () => {
    const r = await rig();
    const { courseId } = await drive(r);
    await tamperWith(r, (st, row) => { st.put({ ...row, line: row.line.replace("Confirm the material list.", "Confirm nothing at all.") }); }, 2);
    await r.reload();
    const lib = (await r.call("GET", "/api/courses")).json.courses;
    expect(lib[0]).toMatchObject({ courseId, progress: { error: "LOG_INTEGRITY" } });
    const view = await r.call("GET", `/api/courses/${encodeURIComponent(courseId)}`);
    expect(view.status).toBe(409);
    expect(view.json.code).toBe("LOG_INTEGRITY");
    const ask = await r.call("POST", `/api/courses/${encodeURIComponent(courseId)}/student/ask`, { question: "What do plants need?" });
    expect(ask.status).toBe(409);
  });

  it("a deleted event (a gap) is caught the same way", async () => {
    const r = await rig();
    const { courseId } = await drive(r);
    await tamperWith(r, (st, row) => { st.delete([row.courseId, row.seq]); }, 4);
    await r.reload();
    const view = await r.call("GET", `/api/courses/${encodeURIComponent(courseId)}`);
    expect(view.json.code).toBe("LOG_INTEGRITY");
  });

  it("a self-consistent rewrite verifies (tamper-EVIDENT, not proof) — and the pin on the teacher's device catches it", async () => {
    const r = await rig();
    const local = new MemoryStorage();
    vi.stubGlobal("localStorage", local);
    const { courseId } = await drive(r);
    const c = `/api/courses/${encodeURIComponent(courseId)}`;
    const { anchor } = (await r.call("GET", `${c}/anchor/1`)).json as { anchor: CourseAnchor };
    const pin = pinVersion(anchor, 1);
    expect(pin).not.toBeNull();
    expect(comparePin(pin!, anchor).status).toBe("ok");

    // Rewrite the plan title inside the stored log and recompute every digest from there on.
    const d = await r.host.dump();
    const rows = d.events.sort((a, b) => a.seq - b.seq).map((e) => ({ ...e, rec: JSON.parse(e.line) }));
    let prev = "genesis";
    for (const row of rows) {
      if (row.rec.event.kind === "plan.proposed") row.rec.event.spec.title = "A plan nobody confirmed";
      row.rec.prev = prev;
      row.rec.digest = linkDigest(prev, row.rec.event);
      prev = row.rec.digest;
    }
    const db = await new Promise<IDBDatabase>((res) => { const q = r.idb.open("silicus-host"); q.onsuccess = () => res(q.result); });
    await new Promise<void>((res) => {
      const tx = db.transaction("events", "readwrite");
      rows.forEach((row) => tx.objectStore("events").put({ courseId: row.courseId, seq: row.seq, line: JSON.stringify(row.rec) }));
      tx.oncomplete = () => res();
    });
    db.close();
    await r.reload();
    expect((await r.call("GET", `${c}/verify`)).json.ok).toBe(true); // the chain alone cannot tell
    const now = (await r.call("GET", `${c}/anchor/1`)).json.anchor as CourseAnchor;
    expect(comparePin(pin!, now).status).toBe("changed"); // the pin can
    vi.unstubAllGlobals();
  });
});

describe("material text is never stored", () => {
  it("pasted text and a fetched page: not in any IndexedDB value, localStorage or sessionStorage", async () => {
    const PAGE_SECRET = "MAGENTA-PANGOLIN-0042";
    const site = fakeSite({ pages: { "https://example.org/leaves": { name: "Leaves (example.org)", text: `Leaves are green. ${PAGE_SECRET} is only on this page.` } } });
    const r = await rig({ site });
    const { c } = await readyCourse(r);
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL, { url: "https://example.org/leaves" }] });
    expect(res.status).toBe(200);
    expect(res.json.materials.map((m: any) => m.name)).toEqual([MATERIAL.name, "Leaves (example.org)"]);
    // The text DID leave once, to the model proxy — that is the point of proposing from it.
    expect(site.calls.some((x) => x.url.endsWith("/api/worker") && x.body?.includes(MATERIAL_SECRET) && x.body.includes(PAGE_SECRET))).toBe(true);
    const stored = await everythingStored(r);
    expect(stored).not.toContain(MATERIAL_SECRET);
    expect(stored).not.toContain(PAGE_SECRET);
    expect(stored).not.toContain("Light, water and air become sugar");
    expect(stored).toContain(res.json.materials[0].digest); // what is kept: the name, the digest, the size
  });
});

describe("student chat is use, never evidence: it leaves no trace", () => {
  it("asking compares equal before and after: every IndexedDB value and both web storages", async () => {
    const r = await rig();
    const { courseId } = await drive(r);
    const before = await everythingStored(r);
    const ask = await r.call("POST", `/api/courses/${encodeURIComponent(courseId)}/student/ask`, { question: "Why are leaves green?", history: [], studentId: "s-9", provenance: { turnRef: "x" } });
    expect(ask.status).toBe(200);
    expect(ask.json.grounded).toBe(true);
    expect(await everythingStored(r)).toBe(before);
    await r.reload();
    expect(await everythingStored(r)).toBe(before);
  });
});

describe("export, delete all, import", () => {
  it("round-trips: the courses come back, replay to the same views, and verify", async () => {
    const r = await rig();
    r.local.setItem("silicus.pin.x.1", "{}");
    const { courseId } = await drive(r);
    const second = await readyCourse(r, { fromMaterials: false });
    const c = `/api/courses/${encodeURIComponent(courseId)}`;
    const before = [(await r.call("GET", c)).json, (await r.call("GET", second.c)).json];
    const exported = await r.host.exportAll();
    expect(exported.included).toHaveLength(2);
    expect(exported.filename).toMatch(/^silicus-courses-\d{4}-\d{2}-\d{2}\.json$/);
    expect(exported.text).not.toContain(MATERIAL_SECRET);

    await r.host.deleteAll();
    expect(await r.host.dump()).toEqual({ metas: [], events: [] });
    expect((await r.call("GET", "/api/courses")).json.courses).toEqual([]);
    expect(r.local.getItem("silicus.pin.x.1")).toBeNull();
    expect(r.session.getItem(PASSCODE_KEY)).toBeNull();

    const imported = await r.host.importAll(exported.text);
    expect(imported.imported.sort()).toEqual(["How plants eat", "How plants eat"]);
    await r.reload();
    expect([(await r.call("GET", c)).json, (await r.call("GET", second.c)).json]).toEqual(before);
    expect((await r.call("GET", `${c}/verify`)).json.ok).toBe(true);
    // Importing the same file again changes nothing.
    expect((await r.host.importAll(exported.text)).alreadyHere).toHaveLength(2);
  });

  it("a tampered file is refused whole, with a clear message, and nothing is written", async () => {
    const r = await rig();
    await drive(r);
    const { text } = await r.host.exportAll();
    await r.host.deleteAll();

    const edited = text.replace("Confirm this lesson plan.", "Confirm a plan I never saw.");
    await expect(r.host.importAll(edited)).rejects.toMatchObject({ code: "DIGEST_MISMATCH", message: expect.stringMatching(/does not match its own fingerprint.*Nothing was imported/) });
    await expect(r.host.importAll("not json")).rejects.toMatchObject({ code: "NOT_JSON" });
    expect(await r.host.dump()).toEqual({ metas: [], events: [] });
  });

  it("a course that does not verify is left out of an export and reported", async () => {
    const r = await rig();
    await drive(r);
    const db = await new Promise<IDBDatabase>((res) => { const q = r.idb.open("silicus-host"); q.onsuccess = () => res(q.result); });
    await new Promise<void>((res) => { const tx = db.transaction("events", "readwrite"); tx.objectStore("events").delete(["urn:none", 1]); const cur = tx.objectStore("events").openCursor(); cur.onsuccess = () => { if (cur.result) { const v = cur.result.value; if (v.seq === 3) cur.result.update({ ...v, line: v.line.replace("photosynthesis", "fungi") }); cur.result.continue(); } }; tx.oncomplete = () => res(); });
    db.close();
    const out = await r.host.exportAll();
    expect(out.included).toEqual([]);
    expect(out.skipped[0].reason).toMatch(/does not verify/);
  });
});

describe("the demo passcode", () => {
  it("is asked for on the first AI action, kept in sessionStorage only, and sent as the header", async () => {
    const r = await rig();
    const { c } = await readyCourse(r);
    expect(r.asked).toEqual([]); // nothing so far needed it
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL] });
    expect(res.status).toBe(200);
    expect(r.asked).toEqual(["needed"]);
    expect(r.session.getItem(PASSCODE_KEY)).toBe("letmein");
    expect(r.local.length).toBe(0);
    const idb = JSON.stringify(await r.host.dump());
    expect(idb).not.toContain("letmein");
    expect(r.site.calls.filter((x) => x.url.endsWith("/api/worker")).every((x) => x.passcode === "letmein")).toBe(true);
  });

  it("a 401 clears it and asks again, saying it was not accepted", async () => {
    const r = await rig({ answers: ["wrong", "letmein"] });
    const { c } = await readyCourse(r);
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL] });
    expect(res.status).toBe(200);
    expect(r.asked).toEqual(["needed", "rejected"]);
    expect(r.session.getItem(PASSCODE_KEY)).toBe("letmein");
  });

  it("declining sends nothing and refuses in words; the record is unchanged", async () => {
    const r = await rig({ answers: [null] });
    const { c } = await readyCourse(r);
    const before = JSON.stringify(await r.host.dump());
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL] });
    expect(res.json).toMatchObject({ code: "PASSCODE_REQUIRED", message: MESSAGES.cancelled });
    expect(r.site.calls.some((x) => x.url.endsWith("/api/worker"))).toBe(false);
    expect(JSON.stringify(await r.host.dump())).toBe(before);
  });

  it("the teacher's own path needs no passcode and no network at all: outcomes, decisions, verify, export, library", async () => {
    const r = await rig({ answers: [] });
    const { c } = await readyCourse(r, { fromMaterials: false });
    const proposals = (await r.call("POST", `${c}/objectives`, {})).json.proposals;
    expect(proposals).toHaveLength(2);
    const d = await r.call("POST", `${c}/decisions`, { text: "Accept both.", decisions: proposals.map((p: any) => ({ verb: "accept", proposalId: p.id })) });
    expect(d.status).toBe(200);
    expect((await r.call("GET", `${c}/verify`)).json.ok).toBe(true);
    expect((await r.call("GET", `${c}/export`)).status).toBe(200);
    expect((await r.call("GET", "/api/courses")).json.courses).toHaveLength(1);
    expect(r.asked).toEqual([]);
    expect(r.site.calls).toEqual([]);
  });
});

describe("the site's refusals become words a teacher can act on", () => {
  const withWorker = (worker: (b: any) => Response | null) => rig({ site: fakeSite({ worker }) });
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("502 with upstream 402: the model account has no credits", async () => {
    const r = await withWorker(() => reply(502, { error: { code: "UPSTREAM_ERROR", status: 402 } }));
    const { c } = await readyCourse(r);
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL] });
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ code: "MODEL_NO_CREDITS", message: MESSAGES.noCredits });
  });

  it("429: wait, with the server's retry-after", async () => {
    const r = await withWorker(() => reply(429, { error: { code: "RATE_LIMITED" } }, { "retry-after": "30" }));
    const { c } = await readyCourse(r);
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL] });
    expect(res.json).toMatchObject({ code: "RATE_LIMITED", message: MESSAGES.wait(30) });
  });

  it("503: AI drafting is not set up on this site (501, the same 'not configured' as the Node host)", async () => {
    const r = await withWorker(() => reply(503, { error: { code: "NOT_CONFIGURED" } }));
    const { c } = await readyCourse(r);
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL] });
    expect(res.status).toBe(501);
    expect(res.json).toMatchObject({ code: "WORKER_NOT_CONFIGURED", message: MESSAGES.notSetUp });
  });

  it("an OpenAI length finish is a 502 WORKER_TRUNCATED refusal in the browser host", async () => {
    const r = await withWorker(() => reply(200, { choices: [{ finish_reason: "length", message: { content: '{"objectives":[' } }] }));
    const { c } = await readyCourse(r);
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [MATERIAL] });
    expect(res.status).toBe(502);
    expect(res.json).toEqual({ ok: false, code: "WORKER_TRUNCATED", message: "The model ran out of room before finishing. Try again, or use less material." });
  });

  it("worker status is the SITE's: zero-retention only when it says so, and whether a passcode is required", async () => {
    const typicalSeconds = { objectives: [3, 15], plan: [5, 25], answer: [2, 8] };
    const r = await rig({ site: fakeSite({ status: { configured: true, zdr: false, provider: "openrouter", passcodeRequired: true, model: "x", typicalSeconds } }) });
    expect((await r.call("GET", "/api/worker/status")).json).toEqual({ configured: true, zdr: false, provider: "openrouter", passcodeRequired: true, typicalSeconds });
    const none = await rig({ site: fakeSite({ status: null }) });
    expect((await none.call("GET", "/api/worker/status")).json).toMatchObject({ configured: false, zdr: false });
  });
});

describe("what needs the local app says so", () => {
  it("ASFAI is off: status says unavailable, every ASFAI action refuses in words, no knowledge sources", async () => {
    const r = await rig();
    expect((await r.call("GET", "/api/asfai/status")).json).toMatchObject({ connected: false, available: false });
    const connect = await r.call("POST", "/api/asfai/connect", {});
    expect(connect.json).toMatchObject({ code: "LOCAL_APP_ONLY" });
    const { c } = await readyCourse(r);
    expect((await r.call("POST", `${c}/intake/call`, {})).json.code).toBe("LOCAL_APP_ONLY");
    expect((await r.call("GET", "/api/knowledge/status")).json).toEqual({ sources: [] });
    expect((await r.call("POST", `${c}/archive`, {})).json.code).toBe("LOCAL_APP_ONLY");
    expect((await r.call("GET", "/api/archives")).json).toEqual({ refs: [] });
  });

  it("a YouTube link is refused here, with no network call, and the course is untouched", async () => {
    const r = await rig();
    const { c } = await readyCourse(r);
    const res = await r.call("POST", `${c}/materials/propose`, { materials: [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: "YOUTUBE_LOCAL_ONLY", message: MESSAGES.youtube });
    expect(r.site.calls.filter((x) => !x.url.endsWith("/status"))).toEqual([]);
  });
});

describe("two tabs", () => {
  let idb: Rig["idb"];
  beforeEach(async () => { idb = (await rig()).idb; });

  it("a tab writing over a stale copy fails closed (409 STORAGE_CONFLICT), never overwrites, and recovers", async () => {
    const a = await rig({ idb });
    const b = await rig({ idb }); // same storage, its own memory: a second tab
    const { c } = await readyCourse(a, { fromMaterials: false });
    await b.reload(); // b sees the course
    await a.call("POST", `${c}/objectives`, {}); // a moves on; b's copy is now stale
    const stale = await b.call("POST", `${c}/objectives`, {});
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("STORAGE_CONFLICT");
    // Nothing was overwritten: the stored record still verifies, and b now sees a's work.
    expect((await a.call("GET", `${c}/verify`)).json.ok).toBe(true);
    expect((await b.call("GET", c)).json.proposals).toHaveLength(2);
  });

  it("with a channel, the other tab re-reads before its next request", async () => {
    const listeners: { onmessage: ((e: MessageEvent) => void) | null }[] = [];
    const bus = () => { const ch = { onmessage: null as ((e: MessageEvent) => void) | null, postMessage: () => listeners.filter((l) => l !== ch).forEach((l) => l.onmessage?.({} as MessageEvent)) }; listeners.push(ch); return ch; };
    const site = fakeSite();
    const a = await createBrowserHost({ indexedDB: idb, fetchImpl: site.fetchImpl, origin: ORIGIN, channel: bus(), localStore: () => null });
    const b = await createBrowserHost({ indexedDB: idb, fetchImpl: site.fetchImpl, origin: ORIGIN, channel: bus(), localStore: () => null });
    const created = await a.handle({ method: "POST", path: "/api/courses", body: { owner: "Ada", title: "Tab A" } });
    expect(created.status).toBe(201);
    const list = await b.handle({ method: "GET", path: "/api/courses" });
    expect((list.json as any).courses.map((x: any) => x.title)).toEqual(["Tab A"]);
  });
});
