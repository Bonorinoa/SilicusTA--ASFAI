/**
 * N1.waits.test.tsx — N1 item 3 (L1 finding 3), the studio half: the site fetch honours a task's own deadline, every
 * wait shows its seconds after ten, a timed-out map says "The map took too long. Search it, or skip it.", and a
 * timed-out helper says "That took too long. Ask again."
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSite } from "../browser/site";
import { WorkerError } from "../../../host/worker.mjs";
import { Elapsed } from "../components/WaitLines/Elapsed";
import { explainRefusal } from "../lib/refusals";

const mocks = vi.hoisted(() => ({ marbleRank: vi.fn(), marbleCoverageFor: vi.fn(), marbleSearch: vi.fn(), marbleLane: vi.fn() }));
vi.mock("../gate/transport", () => ({ host: mocks }));
import { MapStep, _resetRankCache } from "./MapStep";

afterEach(() => { vi.useRealTimers(); });

describe("N1 waits", () => {
  it("the site fetch ends at the task's own deadline when it is shorter than the site's", async () => {
    const keeper = { get: () => "p", set: () => {}, clear: () => {}, ask: async () => "p" };
    const fetchImpl = (async (u: string, init: RequestInit = {}) => {
      if (String(u).endsWith("/status")) return new Response(JSON.stringify({ configured: true, passcodeRequired: true }), { status: 200 });
      return await new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))));
    }) as typeof fetch;
    const site = createSite({ origin: "https://s.test", fetchImpl, passcode: keeper, requestTimeoutMs: 5_000 });
    const t0 = Date.now();
    const err = await site.workerFetch("https://s.test/api/worker", { method: "POST", body: "{}", silicusDeadlineMs: 40 } as RequestInit).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).code).toBe("WORKER_TIMEOUT");
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("a wait shows nothing for ten seconds, then its seconds", () => {
    vi.useFakeTimers();
    render(<p>waiting <Elapsed /></p>);
    act(() => { vi.advanceTimersByTime(9_000); });
    expect(document.querySelector("[data-elapsed]")).toBeNull();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(document.querySelector("[data-elapsed]")?.textContent).toBe("12 s");
  });

  it("a timed-out helper reads: That took too long. Ask again.", () => {
    const x = explainRefusal(new WorkerError("WORKER_TIMEOUT", "the drafting worker did not answer in time"), "ask");
    expect(`${x.what} ${x.next}`).toBe("That took too long. Ask again.");
  });

  it("a timed-out map ranking reads: The map took too long. Search it, or skip it.", async () => {
    _resetRankCache();
    mocks.marbleCoverageFor.mockResolvedValue({ overlapping: 10, total: 20, missingWord: null });
    mocks.marbleRank.mockResolvedValue({ threads: [], topics: {}, suggestions: [], reason: "WORKER_TIMEOUT" });
    mocks.marbleSearch.mockResolvedValue({ hits: [] });
    render(<MapStep title="Moon" goal="phases" ages={{ min: 8, max: 9 }} choice={{ anchor: null, connected: null, skipped: false }} onChoice={() => {}} />);
    expect(await screen.findByText("The map took too long. Search it, or skip it.")).toBeInTheDocument();
  });
});
