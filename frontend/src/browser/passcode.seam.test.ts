/**
 * passcode.seam.test.ts — the observable "asking" seam (B1).
 *
 * The demo passcode itself never leaves passcode.ts: a keeper hands it to the site as a header and keeps
 * it under its one sessionStorage key. But the studio must know WHEN the prompt is open, so the clock does
 * not count the teacher typing: the seam exposes the asking state (a prompt pending) as a boolean, with a
 * subscribe function, and nothing else. The value never travels with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSCODE_KEY, onPasscodeAsking, passcodeKeeper, setPasscodePrompt } from "./passcode";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { setPasscodePrompt(null); vi.useRealTimers(); });

describe("the passcode asking seam", () => {
  it("exposes the asking state while a prompt is pending, and clears it when the prompt resolves", async () => {
    const events: boolean[] = [];
    const off = onPasscodeAsking((asking) => { events.push(asking); });
    vi.useFakeTimers();
    let resolve!: (code: string | null) => void;
    let entered = 0;
    setPasscodePrompt((_reason) => { entered += 1; return new Promise<string | null>((r) => { resolve = r; }); });

    const keeper = passcodeKeeper();
    const pending = keeper.ask("needed");
    expect(entered).toBe(1);
    expect(events).toEqual([true]); // the state is exposed while the teacher is typing

    resolve("letmein");
    await vi.advanceTimersByTimeAsync(0);
    await pending;

    expect(events).toEqual([true, false]); // asked once, resolved once
    expect(keeper.get()).toBe("letmein"); // the value stayed put, in its one key
    expect(sessionStorage.getItem(PASSCODE_KEY)).toBe("letmein");
    off();
  });

  it("a cancelled prompt also clears the asking state, and stores nothing", async () => {
    const events: boolean[] = [];
    onPasscodeAsking((asking) => { events.push(asking); });
    vi.useFakeTimers();
    let resolve!: (code: string | null) => void;
    setPasscodePrompt((_reason) => new Promise<string | null>((r) => { resolve = r; }));
    const keeper = passcodeKeeper();
    const pending = keeper.ask("rejected");
    expect(events).toEqual([true]);
    resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(events).toEqual([true, false]);
    expect(keeper.get()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("with no prompt registered the seam stays quiet: ask returns null and nothing is exposed", async () => {
    const events: boolean[] = [];
    const off = onPasscodeAsking((asking) => { events.push(asking); });
    const keeper = passcodeKeeper();
    expect(await keeper.ask("needed")).toBeNull();
    expect(events).toEqual([]);
    off();
  });
});