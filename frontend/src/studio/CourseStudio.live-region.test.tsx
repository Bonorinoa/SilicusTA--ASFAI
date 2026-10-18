/**
 * CourseStudio.live-region.test.tsx — lane D1 + D2.
 *
 * D1: the step status line is the ONLY polite live region for turn and drafting messages. The action
 * bar is a plain paragraph: it must not carry role="status". So at every step, with no notice shown,
 * the page has exactly one element with role status or an aria-live polite attribute (the status
 * line). A notice from the Notice component legitimately adds its own, so those checks run clean.
 *
 * D2: the step-transition sentence is spoken once, for the one step change it describes, and is
 * cleared as soon as the teacher does anything next. After the brief is confirmed the transition is
 * shown; after the next act ("Use my answers") it is gone and never re-appears.
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

/** Every polite live region in the page: role status or an aria-live polite attribute. */
const liveRegions = () => [...document.querySelectorAll<HTMLElement>('[role="status"], [aria-live="polite"]')];

beforeEach(() => { statusFetch.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("D1: the step status line is the only polite live region", () => {
  it("has exactly one polite live region at every step, with no notice up", async () => {
    const { host, CourseStudio } = await studioEnv();
    const id = await freshCourse(host);
    render(<CourseStudio courseId={id} />);
    await screen.findByText("Your turn: answer the three questions, then confirm the brief");
    expect(liveRegions()).toHaveLength(1); // brief

    // Confirm the brief: on to objectives. The action bar still renders, but adds no live region.
    await waitFor(() => expect(document.querySelector('section[aria-label="Questions"]')).not.toBeNull());
    const questions = () => document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('section[aria-label="Questions"] input:not([type="checkbox"]), section[aria-label="Questions"] textarea');
    await waitFor(() => expect(questions().length).toBe(3));
    setVal([...questions()][2], "Students can explain how a plant makes food.\nStudents can name what a plant needs.");
    setVal([...questions()][0], "How plants make food from sunlight");
    setVal([...questions()][1], "Grade 4 science, ages 9-10");
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm the brief" })).not.toBeDisabled(), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm the brief" }));
    await screen.findByText(/On to the objectives\. Your turn: choose where the first proposals come from/);
    expect(liveRegions()).toHaveLength(1); // objectives, nothing proposed yet

    // Use my answers → proposals arrive; the tray renders, still one live region.
    fireEvent.click(await screen.findByRole("button", { name: "Use my answers" }));
    await waitFor(() => expect(document.querySelectorAll('aside[aria-label="Proposals"] article').length).toBe(2));
    await screen.findByText(/Your turn: accept, edit or drop each proposal/);
    expect(liveRegions()).toHaveLength(1); // objectives with proposals

    // Decide every proposal: the host confirms the objectives and moves on to the plan.
    const acceptOne = () => {
      const article = document.querySelector('aside[aria-label="Proposals"] article');
      const button = article?.querySelector<HTMLButtonElement>("button");
      if (!button) return false;
      fireEvent.click(button);
      return true;
    };
    act(() => { acceptOne(); });
    await waitFor(() => expect(document.querySelectorAll('aside[aria-label="Proposals"] article').length).toBe(1));
    act(() => { acceptOne(); });
    await screen.findByText(/On to the plan\. Your turn: draft the lesson plan/);
    expect(liveRegions()).toHaveLength(1); // plan
  }, 30_000);
});

describe("D2: the transition sentence is spoken once and cleared by the next act", () => {
  it("shows the transition after the brief is confirmed, then clears it on the next act, never to return", async () => {
    const { host, CourseStudio } = await studioEnv();
    const id = await freshCourse(host);
    render(<CourseStudio courseId={id} />);
    await screen.findByText("Your turn: answer the three questions, then confirm the brief");

    await waitFor(() => expect(document.querySelector('section[aria-label="Questions"]')).not.toBeNull());
    const questions = () => document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('section[aria-label="Questions"] input:not([type="checkbox"]), section[aria-label="Questions"] textarea');
    await waitFor(() => expect(questions().length).toBe(3));
    setVal([...questions()][2], "Students can explain how a plant makes food.\nStudents can name what a plant needs.");
    setVal([...questions()][0], "How plants make food from sunlight");
    setVal([...questions()][1], "Grade 4 science, ages 9-10");
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm the brief" })).not.toBeDisabled(), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm the brief" }));

    // The transition to objectives is shown once, right after the step change.
    await screen.findByText(/The brief is confirmed\. On to the objectives\./);
    expect(screen.getByText(/The brief is confirmed\. On to the objectives\. Your turn: choose where the first proposals come from/)).toBeInTheDocument();

    // The next act — "Use my answers" — clears the transition: the status line is a plain turn line.
    fireEvent.click(await screen.findByRole("button", { name: "Use my answers" }));
    await screen.findByText(/Your turn: accept, edit or drop each proposal/);
    expect(screen.queryByText(/The brief is confirmed\. On to the objectives/)).not.toBeInTheDocument();

    // And it never comes back while the teacher keeps acting on the same step.
    act(() => {
      const article = document.querySelector('aside[aria-label="Proposals"] article');
      const button = article?.querySelector<HTMLButtonElement>("button");
      if (button) fireEvent.click(button);
    });
    await waitFor(() => expect(document.querySelectorAll('aside[aria-label="Proposals"] article').length).toBe(1));
    expect(screen.queryByText(/The brief is confirmed\. On to the objectives/)).not.toBeInTheDocument();
  }, 30_000);
});
