/**
 * passcode-cancel.test.tsx — R5 · B5 (second half): a dismissed passcode prompt leaves ONE polite live
 * region, because it leaves no notice.
 *
 * The step status line is the only polite live region for turn and drafting messages (D1). A cancelled
 * passcode is not a failure — nothing was sent and the step is still the teacher's — so it must not add
 * the Notice's second announcement on top of the status line that already says the teacher's turn.
 * Driven through the real browser-mode transport, the in-page host, the site function and the passcode
 * keeper, exactly as useCourse.waiting.test.tsx drives the same chain.
 */
import { act, cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../browser/testkit";
import type { Waiting } from "./useCourse";

const siteFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/worker/status")) {
    return new Response(JSON.stringify({ configured: true, zdr: true, provider: "openrouter", passcodeRequired: true, typicalSeconds: { objectives: [3, 15], plan: [3, 35], answer: [3, 35] } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // The passcode prompt is dismissed before the model request: /api/worker is never reached.
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

interface TestHost {
  createCourse(b: { owner: string; title: string; materials: { name: string }[] }): Promise<{ courseId: string }>;
  confirmCheckpoint(id: string, b: { id: string; text: string }): Promise<unknown>;
  answerIntake(id: string, b: { text: string; answers: Record<string, string> }): Promise<unknown>;
  proposeObjectives(id: string): Promise<{ proposals: { id: string }[] }>;
  decide(id: string, b: { text: string; decisions: unknown[] }): Promise<unknown>;
}

type ProbeCourse = {
  notice: string | null;
  waiting: Waiting | null;
  actions: { draftPlan(): Promise<unknown> };
};

/** A course at the outline gate with the host's own questions answered; nothing here needs AI. */
async function readyCourse(host: TestHost): Promise<string> {
  const created = await host.createCourse({ owner: "Ada Lovelace", title: "How plants eat", materials: [{ name: "Lesson notes" }] });
  const id = created.courseId;
  await host.confirmCheckpoint(id, { id: "files", text: "Confirm the material list." });
  await host.answerIntake(id, { text: "topic", answers: { topic: "photosynthesis" } });
  await host.answerIntake(id, { text: "course", answers: { course: "Science, ages 8-10" } });
  await host.answerIntake(id, { text: "outcomes", answers: { learning_outcomes: "Students can explain how a plant makes food.\nStudents can name what a plant needs." } });
  await host.confirmCheckpoint(id, { id: "outline", text: "Confirm the outline." });
  return id;
}

let useProbe: (id: string) => ProbeCourse = () => { throw new Error("not wired"); };
let probe: ProbeCourse | null = null;

function Probe({ id }: { id: string }) { probe = useProbe(id); return null; }

beforeEach(() => { probe = null; siteFetch.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("B5: a cancelled passcode leaves one polite live region", () => {
  it("sets no notice and clears the waiting state when the teacher dismisses the prompt", async () => {
    const env = await browserEnv();
    useProbe = env.useCourse;
    const id = await readyCourse(env.host);
    const { proposals } = await env.host.proposeObjectives(id);
    for (const p of proposals) await env.host.decide(id, { text: "Accept it.", decisions: [{ verb: "accept", proposalId: p.id }] });

    // The teacher clicks "Not now": the prompt resolves with no code.
    const { setPasscodePrompt } = await import("../browser/passcode");
    setPasscodePrompt(() => Promise.resolve(null));

    render(<Probe id={id} />);
    await act(async () => { await Promise.resolve(); }); // mount; let the host view land
    expect(probe).not.toBeNull();

    await act(async () => { await probe!.actions.draftPlan(); });

    expect(probe!.notice).toBeNull(); // no second live region: the status line carries the turn
    expect(probe!.waiting).toBeNull();
    expect(siteFetch.mock.calls.some((c) => String(c[0]).endsWith("/api/worker"))).toBe(false); // nothing was sent
  }, 20_000);
});
