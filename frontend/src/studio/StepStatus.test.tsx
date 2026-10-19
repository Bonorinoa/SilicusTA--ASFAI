/**
 * StepStatus.test.tsx — B2: ONE status line per step, one polite aria-live region, and the same
 * information is never rendered a second time anywhere on the step.
 *
 * The line is either the teacher's turn, "Silicus is drafting <what>" with the real clock and the step's
 * usual range, or "Waiting for your passcode" — never a promise, never a percentage, and the ticking
 * clock is never inside the live region (it would announce every second).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepStatus } from "./StepStatus";
import type { Waiting } from "./useCourse";
import type { HostCheckpoint, HostView } from "../gate/transport";

const checkpoint = (status: HostCheckpoint["status"], id: string): HostCheckpoint => ({ id, status, provenance: {}, note: null });

const VIEW: HostView = {
  course: { courseId: "urn:uuid:x", owner: "Ada", title: "How plants eat", description: "", materials: [], createdAt: 0 },
  checkpoints: { files: checkpoint("confirmed", "files"), outline: checkpoint("confirmed", "outline"), objectives: checkpoint("confirmed", "objectives") },
  intake: { courseId: "urn:uuid:x", guardState: "open", observedState: null, questionsFrom: "local", roundOpened: false, roundAnswered: false, questions: [], draftAuthorization: false, outlineAuthorized: false, mayCallPrepareOutline: false, refusal: null },
  proposals: [],
  objectives: [{ id: "urn:uuid:o", kind: "public", statement: "Students can explain it." }],
  decisions: [],
  plan: { id: "urn:uuid:pl", courseId: "urn:uuid:x", courseVersion: 0, title: "A plan", status: "draft", activities: [], proposedBy: "ai", proposedAt: 0 },
  invalidation: { invalidated: false, gaps: [] },
  publish: { canPublish: false, blockers: [] },
  versions: [],
  timeline: [],
  ledger: [],
  integrity: { events: 0, head: "genesis" },
};

const WORKER = { configured: true, typicalSeconds: { objectives: [3, 15], plan: [5, 25], answer: [2, 8] } } as const;

const working = (over: Partial<Waiting> = {}): Waiting => ({ kind: "plan", phase: "working", startedAt: Date.now() - 60_000, what: "drafting from 1 confirmed objective", ...over });

function statusText(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("StepStatus — the one status line", () => {
  it("says the teacher's turn from the view alone", () => {
    render(<StepStatus view={VIEW} waiting={null} worker={WORKER} transition={null} />);
    expect(statusText()).toBe("Your turn: read the plan, then confirm it");
  });

  it("speaks the drafting state once: what, the real clock, and the step's usual range", () => {
    render(<StepStatus view={VIEW} waiting={working()} worker={WORKER} transition={null} />);
    const line = statusText();
    expect(line).toBe("Silicus is drafting from 1 confirmed objective");
    expect(screen.getByText(/usually 5–25 s/)).toBeInTheDocument(); // the range is the host's, on the same line
    expect(screen.getByText("1:00")).toBeInTheDocument(); // and the real clock
    // ONE live region, and the clock is never inside it: the live region would announce every second.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(statusText()).not.toMatch(/\d+:\d\d/);
  });

  it("suggesting keeps the objectives step's own range", () => {
    render(<StepStatus view={VIEW} waiting={working({ kind: "suggest", what: "finding objectives that round out yours" })} worker={WORKER} transition={null} />);
    expect(statusText()).toBe("Silicus is finding objectives that round out yours");
    expect(screen.getByText(/usually 3–15 s/)).toBeInTheDocument();
  });

  it("while the passcode prompt is open: 'Waiting for your passcode', and no clock", () => {
    render(<StepStatus view={VIEW} waiting={working({ phase: "passcode" })} worker={WORKER} transition={null} />);
    expect(statusText()).toBe("Waiting for your passcode");
    expect(screen.queryByText(/\d+:\d\d/)).not.toBeInTheDocument();
  });

  it("without a worker status the range falls back to the documented defaults", () => {
    render(<StepStatus view={VIEW} waiting={working()} worker={{ configured: true }} transition={null} />);
    expect(screen.getByText(/usually 5–25 s/)).toBeInTheDocument();
  });

  it("a step transition is announced once, ahead of the new step's turn", () => {
    render(<StepStatus view={VIEW} waiting={null} worker={WORKER} transition="Objectives confirmed. On to the plan." />);
    expect(statusText()).toBe("Objectives confirmed. On to the plan. Your turn: read the plan, then confirm it");
  });

  it("counts are words, never digits with a plural fight", () => {
    render(<StepStatus view={VIEW} waiting={working({ what: "reading 1 source" })} worker={WORKER} transition={null} />);
    expect(statusText()).toBe("Silicus is reading 1 source");
    expect(screen.queryByText(/1 sources/)).not.toBeInTheDocument();
  });
});

/* ------------------------------- R5 · B1 and B2 ------------------------------- */

/** A course whose plan is confirmed AND whose latest version is published: the step is done. */
const PUBLISHED: HostView = {
  ...VIEW,
  plan: { ...VIEW.plan, status: "confirmed" } as HostView["plan"],
  versions: [{ version: 1 } as HostView["versions"][number]],
};

describe("B1: the status line owns a whole row of the wrapping flex column", () => {
  it("declares flex-basis:100% on .line so the proposals tray is not pushed left", () => {
    const css = readFileSync(join(__dirname, "StepStatus.module.css"), "utf8");
    const line = css.match(/\.line\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(line).toMatch(/flex-basis:\s*100%/);
  });
});

describe("B2: the status line is not stale after publishing", () => {
  it("says the version is published instead of 'Your turn: review and publish'", () => {
    render(<StepStatus view={PUBLISHED} waiting={null} worker={WORKER} transition={null} />);
    expect(statusText()).toBe("Version 1 is published. Preview it or revise.");
    expect(statusText()).not.toMatch(/review and publish/);
  });

  it("still says 'review and publish' while the plan is confirmed but nothing is published yet", () => {
    render(<StepStatus view={{ ...VIEW, plan: { ...VIEW.plan, status: "confirmed" } as HostView["plan"] }} waiting={null} worker={WORKER} transition={null} />);
    expect(statusText()).toBe("Your turn: review and publish");
  });
});