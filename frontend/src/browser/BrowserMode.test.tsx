/**
 * BrowserMode.test.tsx — the online build's UI tells the truth about where things happen.
 *
 * Built (here: imported) with VITE_SILICUS_MODE=browser, the app talks to the in-page host, never to /api over
 * the network; it never shows the developer "host is not reachable" text; it says this browser keeps the record
 * and offers export / import / delete-all (delete confirmed first); YouTube says it needs the local app and
 * offers no dead button; and the passcode dialog keeps the code in sessionStorage only.
 *
 * The classic #/live app is gone (K1); the browser-mode truths are read off the studio's Home and Sources.
 */
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSCODE_KEY, passcodeKeeper } from "./passcode";
import { PasscodeDialog } from "./PasscodeDialog";

const siteFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/worker/status")) {
    return new Response(JSON.stringify({ configured: true, zdr: false, provider: "openrouter", passcodeRequired: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
});

async function browserMode() {
  vi.resetModules();
  vi.stubEnv("VITE_SILICUS_MODE", "browser");
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", siteFetch);
  return import("../gate/transport");
}

beforeEach(() => { siteFetch.mockClear(); sessionStorage.clear(); localStorage.clear(); window.location.hash = ""; });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("browser mode", () => {
  it("intents go to the in-page host: no request to /api/courses ever leaves the page", async () => {
    const { host, BROWSER_MODE } = await browserMode();
    expect(BROWSER_MODE).toBe(true);
    const created = await host.createCourse({ owner: "Ada", title: "Plants" });
    expect(created.courseId).toMatch(/^urn:uuid:/);
    expect((await host.listCourses()).courses.map((c) => c.title)).toEqual(["Plants"]);
    expect(siteFetch.mock.calls.map((c) => String(c[0]))).toEqual([]);
    await expect(host.getCourse("urn:uuid:nope")).rejects.toMatchObject({ code: "UNKNOWN_COURSE" });
  });

  it("the studio home says this browser keeps the record, never the developer host text; delete-all asks first", async () => {
    await browserMode();
    const { StudioApp } = await import("../studio/StudioApp");
    window.location.hash = "#/studio";
    render(<StudioApp />);
    expect(await screen.findByText(/This browser keeps the record/i)).toBeInTheDocument();
    expect(screen.getByText(/stored in this browser only, not on a server/)).toBeInTheDocument();
    expect(screen.queryByText(/host is not reachable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/npm start/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export all courses" })).toBeDisabled(); // nothing to export yet
    expect(screen.getByLabelText("Import courses from an exported file")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete all data from this browser" }));
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));
    expect(screen.queryByText(/This cannot be undone/)).not.toBeInTheDocument();
  });

  it("YouTube says it needs the local app and offers no dead button", async () => {
    await browserMode();
    const { SourcesPanel } = await import("../studio/SourcesPanel");
    const { SourceDrop } = await import("../studio/SourceDrop");
    render(<SourcesPanel names={["a.pdf"]} held={[]} links={[]} onHeld={vi.fn()} onLinks={vi.fn()} confirmed={false} />);
    expect(screen.getByText(/YouTube/)).toBeInTheDocument();
    expect(screen.getByText("Local app only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add youtube/i })).not.toBeInTheDocument();

    render(<SourceDrop taken={[]} full={false} onFile={vi.fn()} onLink={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Or paste text, or a web page address/), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    expect(screen.getByText(/YouTube needs the local app\. Paste the transcript here instead\./)).toBeInTheDocument();
  });
});

describe("the passcode dialog", () => {
  it("asks only when called, keeps the code in sessionStorage only, and says when it was refused", async () => {
    render(<PasscodeDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const keeper = passcodeKeeper();
    let answer!: Promise<string | null>;
    act(() => { answer = keeper.ask("needed"); });
    const dialog = await screen.findByRole("dialog", { name: "Demo passcode" });
    expect(dialog).toHaveTextContent(/kept in this tab only/);
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "letmein" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await answer).toBe("letmein");
    expect(sessionStorage.getItem(PASSCODE_KEY)).toBe("letmein");
    expect(localStorage.length).toBe(0);

    keeper.clear();
    act(() => { answer = keeper.ask("rejected"); });
    expect(await screen.findByText(/That passcode was not accepted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(await answer).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sessionStorage.getItem(PASSCODE_KEY)).toBeNull();
  });
});
