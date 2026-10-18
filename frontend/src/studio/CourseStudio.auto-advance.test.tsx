/**
 * CourseStudio.auto-advance.test.tsx — B4 + B2 end to end: when the last objective proposal is decided the
 * host confirms the objectives and the studio moves on — that move is announced once through the one status
 * line ("Objectives confirmed. On to the plan.") and focus lands on the new step's heading. The same walk
 * also shows the one status line changing with the step, derived only from the host view.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../browser/testkit";

const statusFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/worker/status")) {
    return new Response(JSON.stringify({ configured: true, zdr: true, provider: "openrouter", passcodeRequired: true, typicalSeconds: { objectives: [3, 15], plan: [5, 25], answer: [2, 8] } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
});

async function studioEnv() {
  vi.resetModules();
  vi.stubEnv("VITE_SILICUS_MODE", "browser");
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", statusFetch);
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  const transport = await import("../gate/transport");
  const { CourseStudio } = await import("./CourseStudio");
  return { host: transport.host, CourseStudio };
}

const setVal = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  fireEvent.change(el, { target: { value: v } });
};

/** Create a fresh course only: the test drives every step through the UI so the studio's own view updates arrive. */
async function freshCourse(host: { createCourse: Function }) {
  const created = await host.createCourse({ owner: "Ada Lovelace", title: "How plants eat", materials: [{ name: "Lesson notes" }] });
  return created.courseId;
}

beforeEach(() => { statusFetch.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("the studio's one status line and the announced auto-advance", () => {
  it("announces 'Objectives confirmed. On to the plan.' once and moves focus to the plan heading", async () => {
    const { host, CourseStudio } = await studioEnv();
    const id = await freshCourse(host);
    render(<CourseStudio courseId={id} />);
    expect(await screen.findByText("Your turn: answer the three questions, then confirm the brief")).toBeInTheDocument();

    // Answer the three questions and confirm the brief.
    await waitFor(() => expect(document.querySelector('section[aria-label="Questions"]')).not.toBeNull());
    const questions = () => document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('section[aria-label="Questions"] input:not([type="checkbox"]), section[aria-label="Questions"] textarea');
    await waitFor(() => expect(questions().length).toBe(3));
    setVal([...questions()][2], "Students can explain how a plant makes food.\nStudents can name what a plant needs.");
    setVal([...questions()][0], "How plants make food from sunlight");
    setVal([...questions()][1], "Grade 4 science, ages 9-10");
    // One click: the studio saves the answers, confirms the source list and confirms the brief.
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm the brief" })).not.toBeDisabled(), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm the brief" }));

    // Objectives: proposals arrive from the answers; the status line follows the view (with the one-time
    // "brief confirmed" transition prefix from the step change).
    await screen.findByText(/On to the objectives\. Your turn: choose where the first proposals come from/);
    fireEvent.click(await screen.findByRole("button", { name: "Use my answers" }));
    await waitFor(() => expect(document.querySelectorAll('aside[aria-label="Proposals"] article').length).toBe(2));
    await screen.findByText(/Your turn: accept, edit or drop each proposal/);

    const acceptOne = () => {
      const article = document.querySelector('aside[aria-label="Proposals"] article');
      const button = article?.querySelector<HTMLButtonElement>("button");
      if (!button) return false;
      fireEvent.click(button);
      return true;
    };

    // The first decision stays on the objectives step: no announcement, no focus jump.
    act(() => { acceptOne(); });
    await waitFor(() => expect(document.querySelectorAll('aside[aria-label="Proposals"] article').length).toBe(1));
    expect(screen.queryByText(/On to the plan/)).not.toBeInTheDocument();
    expect(document.activeElement?.textContent?.trim()).not.toBe("Lesson plan");

    // The last decision confirms the objectives: the host moves the studio to the plan step.
    act(() => { acceptOne(); });
    await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe("Lesson plan"));
    // Announced once through the status line, with the new step's turn right behind it.
    expect(screen.getAllByText("Objectives confirmed. On to the plan. Your turn: draft the lesson plan")).toHaveLength(1);
    expect(screen.queryByText("Objectives confirmed. On to the plan.")).toBeNull(); // never a second copy
  }, 30_000);
});