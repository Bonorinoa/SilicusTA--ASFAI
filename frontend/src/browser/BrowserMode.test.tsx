/**
 * BrowserMode.test.tsx — the online build's UI tells the truth about where things happen.
 *
 * Built (here: imported) with VITE_SILICUS_MODE=browser, the app talks to the in-page host, never to /api over
 * the network; it never shows the developer "host is not reachable" text; it says this browser keeps the record
 * and offers export / import / delete-all (delete confirmed first); ASFAI and YouTube say they need the local
 * app and offer no dead button; and the passcode dialog keeps the code in sessionStorage only.
 */
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialsPanel } from "../live/MaterialsPanel";
import { PASSCODE_KEY, passcodeKeeper } from "./passcode";
import { PasscodeDialog } from "./PasscodeDialog";

const siteFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/worker/status")) {
    return new Response(JSON.stringify({ configured: true, zdr: false, provider: "openrouter", passcodeRequired: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
});

async function browserApp() {
  vi.resetModules();
  vi.stubEnv("VITE_SILICUS_MODE", "browser");
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", siteFetch);
  const transport = await import("../gate/transport");
  const { LiveCourse } = await import("../live/LiveCourse");
  return { ...transport, LiveCourse };
}

beforeEach(() => { siteFetch.mockClear(); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("browser mode", () => {
  it("intents go to the in-page host: no request to /api/courses ever leaves the page", async () => {
    const { host, BROWSER_MODE } = await browserApp();
    expect(BROWSER_MODE).toBe(true);
    const created = await host.createCourse({ owner: "Ada", title: "Plants" });
    expect(created.courseId).toMatch(/^urn:uuid:/);
    expect((await host.listCourses()).courses.map((c) => c.title)).toEqual(["Plants"]);
    expect(siteFetch.mock.calls.map((c) => String(c[0]))).toEqual([]);
    await expect(host.getCourse("urn:uuid:nope")).rejects.toMatchObject({ code: "UNKNOWN_COURSE" });
  });

  it("says this browser keeps the record, never the developer host text; delete-all asks first", async () => {
    const { LiveCourse } = await browserApp();
    render(<LiveCourse />);
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

  it("at the intake step, ASFAI says it needs the local app and offers no Connect button", async () => {
    const { host, LiveCourse } = await browserApp();
    const { courseId } = await host.createCourse({ owner: "Ada", title: "Plants" });
    await host.confirmCheckpoint(courseId, { id: "files", text: "Confirm the material list." });
    render(<LiveCourse />);
    expect(await screen.findByText(/needs the local Silicus app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect ASFAI/ })).not.toBeInTheDocument();
    // the byline keeps "kept in this browser" in its own nowrap span, so match the paragraph's whole text
    expect(screen.getByText((_, el) => el?.tagName === "P" && /kept in this browser/.test(el.textContent ?? ""))).toBeInTheDocument();
  });
});

describe("the material panel without YouTube", () => {
  it("refuses a YouTube link before anything is sent, and says why", () => {
    const onPropose = vi.fn();
    render(<MaterialsPanel busy={false} zdr={false} youtube={false} onPropose={onPropose} />);
    expect(screen.getByText(/YouTube captions need the local Silicus app/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("A public link"), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(screen.getByRole("button", { name: "Add this link" }));
    expect(screen.getByRole("status")).toHaveTextContent(/only be read by the local Silicus app/);
    expect(screen.getByRole("button", { name: /Propose objectives/ })).toBeDisabled();
  });

  it("counts a material's characters in words: '1 character', never '1 characters'", () => {
    render(<MaterialsPanel busy={false} zdr={true} youtube={false} onPropose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Or paste text/), { target: { value: "Lesson notes" } });
    fireEvent.change(screen.getByLabelText("Pasted text"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Add this text" }));

    expect(screen.getByText("Lesson notes · 1 character")).toBeInTheDocument();
    expect(screen.queryByText(/1 characters/)).not.toBeInTheDocument();
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
