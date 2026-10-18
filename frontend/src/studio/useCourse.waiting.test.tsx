/**
 * useCourse.waiting.test.tsx — B1: the wait clock starts when the request actually leaves, not while the
 * teacher is typing the demo passcode.
 *
 * In the online build the passcode prompt is awaited inside the worker fetch (site.workerFetch →
 * keeper.ask → the dialog). The real chain is driven here: the browser-mode transport → the in-page host →
 * the site function (a stand-in fetch) → the passcode keeper with a fake prompt that resolves after five
 * fake-timer seconds. The waiting state must expose the prompt as its own phase ("passcode", no clock) and
 * must not report a working startedAt before the prompt resolved. Shared runAi covers all three AI steps;
 * all three are driven end to end (propose from sources, suggest more, draft the plan).
 */
import { act, cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { modelReply } from "../../../host/test/scripted-course.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../browser/testkit";
import type { Waiting } from "./useCourse";

const MATERIAL = { name: "Lesson notes", text: "Plants make their own food from light." };

const siteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = typeof init?.body === "string" ? init.body : "";
  if (url.endsWith("/api/worker/status")) {
    return new Response(JSON.stringify({ configured: true, zdr: true, provider: "openrouter", passcodeRequired: true, typicalSeconds: { objectives: [3, 15], plan: [5, 25], answer: [2, 8] } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/api/worker")) {
    // Hold the request in flight (a fake-timer delay) so the working state is observable mid-run.
    await new Promise((r) => setTimeout(r, 10_000));
    const prompt = String(JSON.parse(body).messages?.[0]?.content ?? "");
    const reply = prompt.startsWith("SUGGEST")
      ? { objectives: [{ statement: "Students can label the parts of a leaf." }] }
      : modelReply(prompt);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
});

/** The browser-mode app: transport and useCourse, both fresh with VITE_SILICUS_MODE=browser. */
async function browserEnv(): Promise<{ host: TestHost; useCourse: (id: string) => ProbeCourse }> {
  vi.resetModules();
  vi.stubEnv("VITE_SILICUS_MODE", "browser");
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", siteFetch);
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  const transport = await import("../gate/transport");
  const { useCourse } = await import("./useCourse");
  return { host: transport.host as TestHost, useCourse };
}

/** The host's verbs the setup needs, and the AI verbs the probe presses. */
interface TestHost {
  createCourse(b: { owner: string; title: string; materials: { name: string }[] }): Promise<{ courseId: string }>;
  confirmCheckpoint(id: string, b: { id: string; text: string }): Promise<unknown>;
  answerIntake(id: string, b: { text: string; answers: Record<string, string> }): Promise<unknown>;
  proposeObjectives(id: string): Promise<{ proposals: { id: string }[] }>;
  decide(id: string, b: { text: string; decisions: unknown[] }): Promise<unknown>;
}

type ProbeCourse = {
  view: unknown;
  busy: boolean;
  notice: string | null;
  waiting: Waiting | null;
  actions: {
    proposeFromSources(materials: { name: string; text: string }[]): Promise<unknown>;
    suggestMore(): Promise<unknown>;
    draftPlan(): Promise<unknown>;
  };
};

/** A course at the outline gate with the host's own questions answered; nothing here needs AI. */
async function readyCourse(host: TestHost, fromMaterials: boolean): Promise<string> {
  const created = await host.createCourse({ owner: "Ada Lovelace", title: "How plants eat", materials: [{ name: MATERIAL.name }] });
  const id = created.courseId;
  await host.confirmCheckpoint(id, { id: "files", text: "Confirm the material list." });
  await host.answerIntake(id, { text: "topic", answers: { topic: "photosynthesis" } });
  await host.answerIntake(id, { text: "course", answers: { course: "Science, ages 8-10" } });
  await host.answerIntake(id, fromMaterials
    ? { text: "Propose the outcomes from my materials.", answers: { outcomes_from: "materials" } }
    : { text: "outcomes", answers: { learning_outcomes: "Students can explain how a plant makes food.\nStudents can name what a plant needs." } });
  await host.confirmCheckpoint(id, { id: "outline", text: "Confirm the outline." });
  return id;
}

let useProbe: (id: string) => ProbeCourse = () => { throw new Error("not wired"); };
/** Every waiting state the probe rendered, in order (null between steps). */
let seen: (Waiting | null)[] = [];
let actions: ProbeCourse["actions"] | null = null;

function Probe({ id }: { id: string }) {
  const c = useProbe(id);
  actions = c.actions;
  const key = c.waiting ? `${c.waiting.phase}:${c.waiting.startedAt}` : null;
  const lastKey = seen.length ? (seen.at(-1) === null ? null : `${seen.at(-1)!.phase}:${seen.at(-1)!.startedAt}`) : "none";
  if (key !== lastKey) seen.push(c.waiting === null ? null : { ...c.waiting });
  return null;
}

beforeEach(() => { seen = []; actions = null; siteFetch.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

/** Press one AI step with a prompt that resolves after five fake-timer seconds, and check the clock. */
async function driveStep(id: string, trigger: (a: ProbeCourse["actions"]) => Promise<unknown>) {
  vi.useFakeTimers();
  // Register the prompt on the SAME (post-reset) module instance the app's keeper reads.
  const { setPasscodePrompt: setPrompt } = await import("../browser/passcode");
  let resolve!: (code: string | null) => void;
  setPrompt((_reason) => new Promise<string | null>((r) => { resolve = r; }));
  render(<Probe id={id} />);
  await act(async () => { await Promise.resolve(); }); // mount; let the host view land
  expect(actions).not.toBeNull();

  // The teacher presses the AI button; the prompt opens inside the worker fetch.
  const pump = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); };
  act(() => { void trigger(actions!); });
  for (let i = 0; i < 300 && (seen.at(-1) ?? null)?.phase !== "passcode"; i++) await pump();
  expect((seen.at(-1) ?? null)?.phase).toBe("passcode"); // B1: the prompt is its own honest phase, clock held

  // The teacher types for five fake-timer seconds; then the request actually leaves (the fetch is now in
  // flight, held on its own timer), so the working phase is observable mid-run.
  await vi.advanceTimersByTimeAsync(5000);
  resolve("letmein");
  for (let i = 0; i < 40 && (seen.at(-1) ?? null)?.phase !== "working"; i++) await pump();
  expect((seen.at(-1) ?? null)?.phase).toBe("working"); // the clock starts when the prompt resolves
  const workingNow = seen.filter((w): w is Waiting => w !== null && w.phase === "working").at(-1)!;
  expect(workingNow.startedAt).toBeGreaterThanOrEqual(Date.now() - 2); // not before the prompt resolved
  expect(workingNow.startedAt).toBeGreaterThan(seen.find((w) => w !== null && w.phase === "working")!.startedAt); // later than the press

  // The request finishes; everything settles and waiting clears.
  await vi.advanceTimersByTimeAsync(20_000);
  for (let i = 0; i < 500 && (seen.at(-1) ?? null) !== null; i++) await pump();
  expect(seen.at(-1)).toBeNull();
}

describe("B1: the wait clock starts when the request leaves, not while the passcode prompt is open", () => {
  it("propose from sources", async () => {
    const env = await browserEnv();
    useProbe = env.useCourse;
    await driveStep(await readyCourse(env.host, true), (a) => a.proposeFromSources([MATERIAL]));
  });

  it("suggest more", async () => {
    const env = await browserEnv();
    useProbe = env.useCourse;
    const id = await readyCourse(env.host, false);
    await env.host.proposeObjectives(id); // a first round on record, so suggestions are allowed
    await driveStep(id, (a) => a.suggestMore());
  });

  it("draft the plan", async () => {
    const env = await browserEnv();
    useProbe = env.useCourse;
    const id = await readyCourse(env.host, false);
    const { proposals } = await env.host.proposeObjectives(id);
    for (const p of proposals) {
      await env.host.decide(id, { text: "Accept it.", decisions: [{ verb: "accept", proposalId: p.id }] });
    }
    await driveStep(id, (a) => a.draftPlan());
  });
});