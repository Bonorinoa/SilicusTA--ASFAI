/**
 * CourseStudio.back.test.tsx — K1 item 4 (owner walk, 17 Nov): "Back" in the course steps is the step before
 * the one on screen, never a jump to the Brief.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../browser/testkit";
import { previousStep } from "./CourseStudio";

const statusFetch = vi.fn(async (input: RequestInfo | URL) => {
  if (String(input).endsWith("/api/worker/status")) {
    return new Response(JSON.stringify({ configured: true, zdr: true, provider: "openrouter", passcodeRequired: true }), { status: 200, headers: { "content-type": "application/json" } });
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

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("Back in the course steps", () => {
  it("previousStep is the step before, in Brief → Objectives → Plan → Publish order", () => {
    expect(previousStep("brief")).toBeNull();
    expect(previousStep("objectives")?.id).toBe("brief");
    expect(previousStep("plan")?.id).toBe("objectives");
    expect(previousStep("publish")?.id).toBe("plan");
  });

  it("on the Objectives step, Back shows the Brief; on the Brief there is no Back", async () => {
    const { host, CourseStudio } = await studioEnv();
    const { courseId } = await host.createCourse({ owner: "Ada Lovelace", title: "Why is the grass green", materials: [{ name: "Lesson notes" }] });
    const answers = { topic: "Why grass is green", course: "Ages 4-10", learning_outcomes: "Say why leaves are green" };
    await host.answerIntake(courseId, { text: "answers", answers });
    await host.confirmCheckpoint(courseId, { id: "files", text: "Confirm the source list." });
    await host.confirmCheckpoint(courseId, { id: "outline", text: "Confirm the brief." });

    render(<CourseStudio courseId={courseId} />);
    expect(await screen.findByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Back to Brief" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Learning objectives" })).toBeNull());
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^← Back to/ })).toBeNull();
  });
});
