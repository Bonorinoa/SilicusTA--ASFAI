/**
 * PasscodeNote.test.tsx — B3: on the online build, when the worker status says the demo passcode is
 * required and this tab does not hold one yet, the Brief step shows a calm note with a quiet
 * "Enter the passcode now" button. The button opens the SAME dialog through the keeper: no network call
 * until a draft is requested, and cancel sends nothing. In local (host) mode nothing new ever shows.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSCODE_KEY } from "../browser/passcode";

const statusFetch = vi.fn(async (input: RequestInfo | URL) => {
  if (String(input).endsWith("/api/worker/status")) {
    return new Response(JSON.stringify({ configured: true, zdr: false, provider: "openrouter", passcodeRequired: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
});

async function renderNote(required = true) {
  vi.resetModules();
  vi.stubEnv("VITE_SILICUS_MODE", "browser");
  vi.stubGlobal("fetch", statusFetch);
  const [noteMod, dialogMod] = await Promise.all([import("./PasscodeNote"), import("../browser/PasscodeDialog")]);
  const { PasscodeNote } = noteMod;
  const PasscodeDialog = dialogMod.PasscodeDialog;
  const worker = { configured: true, passcodeRequired: required } as const;
  render(
    <>
      <PasscodeNote worker={worker} />
      <PasscodeDialog />
    </>,
  );
  return PasscodeNote;
}

beforeEach(() => { sessionStorage.clear(); statusFetch.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("PasscodeNote on the Brief step (online build)", () => {
  it("speaks calmly when the site needs the passcode and this tab does not hold it", async () => {
    await renderNote();
    expect(screen.getByText(/AI drafting on this site needs the demo passcode/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter the passcode now" })).toBeInTheDocument();
  });

  it("opens the same dialog through the keeper; cancelling sends nothing and the note stays", async () => {
    await renderNote();
    fireEvent.click(screen.getByRole("button", { name: "Enter the passcode now" }));
    const dialog = await screen.findByRole("dialog", { name: "Demo passcode" });
    expect(dialog).toHaveTextContent(/kept in this tab only/);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sessionStorage.getItem(PASSCODE_KEY)).toBeNull();
    expect(statusFetch.mock.calls).toEqual([]); // no network call until a draft is requested
    expect(screen.getByText(/AI drafting on this site needs the demo passcode/)).toBeInTheDocument();
  });

  it("after the passcode lands, the note gives way and no second prompt is offered", async () => {
    await renderNote();
    fireEvent.click(screen.getByRole("button", { name: "Enter the passcode now" }));
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "letmein" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(sessionStorage.getItem(PASSCODE_KEY)).toBe("letmein"));
    await waitFor(() => expect(screen.queryByText(/needs the demo passcode/)).not.toBeInTheDocument());
    expect(statusFetch.mock.calls).toEqual([]); // entered or not, the note itself never fetches
  });

  it("says nothing when the site does not require a passcode", async () => {
    await renderNote(false);
    expect(screen.queryByText(/needs the demo passcode/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter the passcode now" })).not.toBeInTheDocument();
  });
  it("says nothing when this tab already holds the passcode", async () => {
    sessionStorage.setItem(PASSCODE_KEY, "already-here");
    await renderNote();
    expect(screen.queryByText(/needs the demo passcode/)).not.toBeInTheDocument();
  });
});

describe("PasscodeNote outside the online build", () => {
  it("host mode renders nothing new", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", statusFetch);
    const { PasscodeNote } = await import("./PasscodeNote");
    render(<PasscodeNote worker={{ configured: true, passcodeRequired: true }} />);
    expect(screen.queryByText(/needs the demo passcode/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter the passcode now" })).not.toBeInTheDocument();
  });
});