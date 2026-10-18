/**
 * A passcode dialog that fails is not a network failure.
 *
 * A prompt that rejects (the dialog could not open) used to reach the teacher as "The site could not be
 * reached", which blames the connection for a problem on this page, and nothing was sent either way.
 */
import { describe, expect, it } from "vitest";
import { createSite, MESSAGES } from "./site";
import { WorkerError } from "../../../host/worker.mjs";
import type { PasscodeKeeper } from "./passcode";

const status = () => new Response(JSON.stringify({ configured: true, zdr: true, provider: "openrouter", passcodeRequired: true }), { status: 200 });

describe("the passcode dialog fails", () => {
  it("says the dialog failed and that nothing was sent, and never touches the network for the model call", async () => {
    const sent: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/api/worker/status")) return status();
      sent.push(url);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const keeper: PasscodeKeeper = {
      get: () => null, set: () => {}, clear: () => {},
      ask: async () => { throw new Error("dialog exploded"); },
    };
    const site = createSite({ origin: "https://site.test", fetchImpl, passcode: keeper });
    let caught: unknown;
    try { await site.workerFetch("https://site.test/api/worker", { method: "POST", body: "{}" }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(WorkerError);
    expect((caught as WorkerError).message).toBe(MESSAGES.dialogFailed);
    expect((caught as WorkerError).message).not.toMatch(/could not be reached/i);
    expect(sent).toEqual([]); // nothing left the page
  });
});
