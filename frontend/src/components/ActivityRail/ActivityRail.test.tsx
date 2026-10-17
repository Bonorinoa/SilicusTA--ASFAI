/**
 * ActivityRail.test.tsx — the rail says who did what, in plain words, and claims nothing it cannot know.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityActor, ActivityItem } from "../../gate/types";
import { ActivityRail } from "./ActivityRail";
import { LANES } from "./lanes";
import { relativeTime, sentenceOf } from "./copy";

const T0 = Date.UTC(2026, 9, 16, 17, 0, 0);

let seq = 0;
function item(action: ActivityItem["action"], actor: ActivityActor, artifact: ActivityItem["artifact"], facts: ActivityItem["facts"] = {}, minutesAgo = 0): ActivityItem {
  seq += 1;
  return { seq, at: T0 - minutesAgo * 60_000, actor, action, artifact, facts };
}

/** matchMedia stub: `wide` answers the min-width query, `reduce` answers prefers-reduced-motion. */
function stubMedia({ wide = false, reduce = false }: { wide?: boolean; reduce?: boolean } = {}) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? reduce : q.includes("min-width") ? wide : false,
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  }));
}

beforeEach(() => { seq = 100; vi.useFakeTimers(); vi.setSystemTime(T0); stubMedia({ wide: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const HISTORY: ActivityItem[] = [
  item("course.created", "teacher", "record", {}, 40),
  item("checkpoint.confirmed", "teacher", "record", { checkpoint: "files" }, 38),
  item("objectives.drafted", "worker", "objectives", { count: 3, materials: 1 }, 10),
  item("objectives.decided", "teacher", "objectives", { accepted: 2, renamed: 1 }, 6),
  item("plan.drafted", "worker", "plan", { activities: 4 }, 3),
  item("plan.checked", "asfai", "plan", { valid: true }, 2),
  item("package.sealed", "teacher", "package", { version: 1 }, 1),
];

const rows = () => screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-action"));

describe("ActivityRail — the lanes", () => {
  it("names four lanes, in this order and wording", () => {
    render(<ActivityRail items={HISTORY} asfaiAvailable />);
    const key = screen.getByRole("list", { name: "The four lanes" });
    const names = within(key).getAllByRole("listitem").map((li) => li.querySelector("[data-lane-name]")?.textContent);
    expect(names).toEqual(["You", "Silicus", "Drafting model", "ASFAI"]);
    expect(LANES.map((l) => l.blurb)).toEqual([
      "your decisions",
      "keeps the record and the rules",
      "proposes and drafts, never decides",
      "asks questions, checks format; local app only",
    ]);
    expect(screen.getByRole("heading", { name: "Behind the scenes" })).toBeInTheDocument();
  });

  it("does not draw the ASFAI lane at all when ASFAI is not available (and drops any ASFAI row or step)", () => {
    const { container } = render(
      <ActivityRail items={HISTORY} asfaiAvailable={false} now={{ actor: "asfai", label: "Checking the plan", startedAt: T0 }} />,
    );
    expect(container.textContent).not.toMatch(/ASFAI/);
    expect(container.querySelector('[data-actor="asfai"]')).toBeNull();
    const key = screen.getByRole("list", { name: "The three lanes" });
    expect(within(key).getAllByRole("listitem")).toHaveLength(3);
    expect(rows()).toHaveLength(HISTORY.length - 1); // the one ASFAI row is not drawn
    expect(screen.queryByText("Checking the plan")).toBeNull();
  });
});

describe("ActivityRail — rows", () => {
  it("renders one row per item, newest first, each in its own lane with its sentence and artifact", () => {
    render(<ActivityRail items={HISTORY} asfaiAvailable />);
    const r = rows();
    expect(r).toHaveLength(HISTORY.length);
    // newest first
    expect(r.map((li) => li.getAttribute("data-seq"))).toEqual([...HISTORY].reverse().map((h) => String(h.seq)));
    const sealed = r[0];
    expect(sealed).toHaveAttribute("data-actor", "teacher");
    expect(within(sealed).getByText("Published version 1")).toBeInTheDocument();
    expect(sealed.querySelector("[data-artifact]")?.textContent).toMatch(/Version/); // the glossary's word, not the host's "package"
    const drafted = r.find((li) => li.getAttribute("data-action") === "objectives.drafted")!;
    expect(drafted).toHaveAttribute("data-actor", "worker");
    expect(within(drafted).getByText("Drafting model")).toBeInTheDocument();
    expect(within(drafted).getByText("Drafted 3 objectives from 1 material")).toBeInTheDocument();
    const checked = r.find((li) => li.getAttribute("data-action") === "plan.checked")!;
    expect(checked).toHaveAttribute("data-actor", "asfai");
    expect(within(checked).getByText("ASFAI")).toBeInTheDocument();
  });

  it("says one, not 1 objectives — and many when there are many", () => {
    const { unmount } = render(<ActivityRail items={[item("objectives.drafted", "worker", "objectives", { count: 1, materials: 1 })]} asfaiAvailable />);
    expect(screen.getByText("Drafted 1 objective from 1 material")).toBeInTheDocument();
    unmount();
    render(<ActivityRail items={[item("objectives.drafted", "worker", "objectives", { count: 8, materials: 2 })]} asfaiAvailable />);
    expect(screen.getByText("Drafted 8 objectives from 2 materials")).toBeInTheDocument();
  });

  it("keeps the copy table: action + facts -> sentence", () => {
    const t = (action: ActivityItem["action"], facts: ActivityItem["facts"] = {}) =>
      sentenceOf({ seq: 1, at: 0, actor: "teacher", artifact: "record", action, facts });
    expect(t("course.created")).toBe("Started this course");
    expect(t("checkpoint.confirmed", { checkpoint: "files" })).toBe("Confirmed the material list");
    expect(t("checkpoint.confirmed", { checkpoint: "outline" })).toBe("Confirmed the brief");
    expect(t("checkpoint.confirmed", { checkpoint: "objectives" })).toBe("Confirmed the objectives");
    expect(t("checkpoint.confirmed", { checkpoint: "plan" })).toBe("Confirmed the lesson plan");
    expect(t("intake.asked", { questions: 1 })).toBe("Asked 1 question about your course");
    expect(t("intake.asked", { questions: 3 })).toBe("Asked 3 questions about your course");
    expect(t("intake.answered")).toBe("Answered the questions");
    expect(t("intake.sent")).toBe("Reported that your answers are enough to start drafting");
    expect(t("objectives.derived", { count: 2 })).toBe("Listed 2 objectives from your own answers");
    expect(t("objectives.drafted", { count: 3, materials: 1 })).toBe("Drafted 3 objectives from 1 material");
    expect(t("objectives.decided", { accepted: 2, renamed: 1 })).toBe("Your decisions: 2 accepted, 1 renamed");
    expect(t("objectives.decided", { accepted: 1, renamed: 0, dropped: 1, added: 1 })).toBe("Your decisions: 1 accepted, 1 dropped, 1 added");
    expect(t("plan.drafted", { activities: 1 })).toBe("Drafted a lesson plan with 1 activity");
    expect(t("plan.drafted", { activities: 5 })).toBe("Drafted a lesson plan with 5 activities");
    expect(t("plan.checked", { valid: true })).toBe("Checked the plan\u2019s format: no problems reported");
    expect(t("plan.checked", { valid: false, issues: 1 })).toBe("Checked the plan\u2019s format: 1 problem reported");
    expect(t("plan.confirmed")).toBe("Confirmed the lesson plan");
    expect(t("package.sealed", { version: 2 })).toBe("Published version 2");
  });

  it("never invents a number: a missing or malformed fact drops its clause instead of printing undefined or NaN", () => {
    const t = (action: ActivityItem["action"], facts: ActivityItem["facts"] = {}) =>
      sentenceOf({ seq: 1, at: 0, actor: "worker", artifact: "plan", action, facts });
    expect(t("objectives.drafted")).toBe("Drafted objectives");
    expect(t("objectives.drafted", { count: 3 })).toBe("Drafted 3 objectives");
    expect(t("objectives.drafted", { count: "three", materials: -2 })).toBe("Drafted objectives");
    expect(t("objectives.decided")).toBe("Decided on the proposed objectives");
    expect(t("plan.drafted", { activities: Number.NaN })).toBe("Drafted a lesson plan");
    expect(t("plan.checked")).toBe("Checked the plan\u2019s format");
    expect(t("package.sealed")).toBe("Published a version for students");
    expect(t("checkpoint.confirmed")).toBe("Confirmed a step");
    expect(t("intake.asked")).toBe("Asked questions about your course");
    const all = (["course.created", "checkpoint.confirmed", "intake.asked", "intake.answered", "intake.sent", "objectives.derived", "objectives.drafted", "objectives.decided", "plan.drafted", "plan.checked", "plan.confirmed", "package.sealed"] as const).map((a) => t(a)).join(" | ");
    expect(all).not.toMatch(/undefined|NaN|null|\[object/);
  });

  it("overclaims nothing: no verified, secure, proof, approval or percent in any sentence", () => {
    const facts = { checkpoint: "plan", count: 3, materials: 2, accepted: 1, renamed: 1, dropped: 1, added: 1, activities: 3, valid: true, issues: 2, version: 1, questions: 2 };
    for (const action of ["course.created", "checkpoint.confirmed", "intake.asked", "intake.answered", "intake.sent", "objectives.derived", "objectives.drafted", "objectives.decided", "plan.drafted", "plan.checked", "plan.confirmed", "package.sealed"] as const) {
      const s = sentenceOf({ seq: 1, at: 0, actor: "worker", artifact: "plan", action, facts });
      expect(s, action).not.toMatch(/verif|secur|proof|proven|approv|certif|%|decided for you/i);
    }
  });

  it("the drafting model's rows never say it decided or confirmed anything", () => {
    render(<ActivityRail items={HISTORY} asfaiAvailable />);
    for (const li of rows().filter((r) => r.getAttribute("data-actor") === "worker")) {
      expect(li.textContent).not.toMatch(/confirm|decid|accept/i);
    }
  });

  it("writes a relative time through plural(), and refreshes it without announcing", () => {
    expect(relativeTime(T0 - 5_000, T0)).toBe("just now");
    expect(relativeTime(T0 - 60_000, T0)).toBe("1 minute ago");
    expect(relativeTime(T0 - 5 * 60_000, T0)).toBe("5 minutes ago");
    expect(relativeTime(T0 - 60 * 60_000, T0)).toBe("1 hour ago");
    expect(relativeTime(T0 - 3 * 3600_000, T0)).toBe("3 hours ago");
    expect(relativeTime(T0 - 48 * 3600_000, T0)).toBe("2 days ago");
    expect(relativeTime(T0 + 5_000, T0)).toBe("just now"); // a clock a little ahead is not "in the future"
    render(<ActivityRail items={[item("course.created", "teacher", "record", {}, 0)]} asfaiAvailable />);
    expect(screen.getByText("just now")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(screen.getByText("3 minutes ago")).toBeInTheDocument();
  });

  it("shows up to eight steps whole, with no fold that hides just one or two", () => {
    const eight = Array.from({ length: 8 }, (_, i) => item("checkpoint.confirmed", "teacher", "record", { checkpoint: "files" }, (20 - i) * 3));
    render(<ActivityRail items={eight} asfaiAvailable />);
    expect(rows()).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /earlier step/ })).toBeNull();
  });

  it("folds a long history: the newest six, then a button for the earlier steps", () => {
    const many = Array.from({ length: 11 }, (_, i) => item("checkpoint.confirmed", "teacher", "record", { checkpoint: "files" }, (30 - i) * 3));
    render(<ActivityRail items={many} asfaiAvailable />);
    expect(rows()).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show 5 earlier steps" }));
    expect(rows()).toHaveLength(11);
    expect(screen.queryByRole("button", { name: /earlier step/ })).toBeNull();
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<ActivityRail items={[]} asfaiAvailable />);
    expect(container).toBeEmptyDOMElement();
    const again = render(<ActivityRail items={[]} now={null} worker={null} asfaiAvailable={false} />);
    expect(again.container).toBeEmptyDOMElement();
  });
});

describe("ActivityRail — the step in flight", () => {
  const NOW = { actor: "worker" as const, label: "Drafting a lesson plan from your 6 confirmed objectives", startedAt: T0 - 4_000 };

  it("is the one animated element, says which actor is working, and has no bar or percentage", () => {
    const { container } = render(<ActivityRail items={HISTORY} now={NOW} asfaiAvailable />);
    const live = container.querySelector("[data-now]") as HTMLElement;
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("data-actor", "worker");
    expect(live).toHaveAttribute("data-motion", "live");
    expect(within(live).getByText("Drafting model")).toBeInTheDocument();
    expect(within(live).getByText(/working now/)).toBeInTheDocument();
    expect(within(live).getByText(NOW.label)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-motion='live']")).toHaveLength(1);
    expect(container.querySelector("progress, [role='progressbar'], [role='meter']")).toBeNull();
    expect(container.textContent).not.toMatch(/\d\s?%/);
  });

  it("holds still under prefers-reduced-motion", () => {
    stubMedia({ wide: true, reduce: true });
    const { container } = render(<ActivityRail items={HISTORY} now={NOW} asfaiAvailable />);
    expect(container.querySelector("[data-now]")).toHaveAttribute("data-motion", "still");
    expect(container.querySelectorAll("[data-motion='live']")).toHaveLength(0);
  });

  it("can be the only thing on the rail (no history yet)", () => {
    render(<ActivityRail items={[]} now={NOW} asfaiAvailable={false} />);
    expect(screen.getByText(NOW.label)).toBeInTheDocument();
  });

  it("names ASFAI as the actor when ASFAI is working and available", () => {
    const { container } = render(<ActivityRail items={[]} now={{ actor: "asfai", label: "Checking the plan\u2019s format", startedAt: T0 }} asfaiAvailable />);
    const live = container.querySelector("[data-now]") as HTMLElement;
    expect(live).toHaveAttribute("data-actor", "asfai");
    expect(within(live).getByText("ASFAI")).toBeInTheDocument();
  });

  it("while the drafting model works: one sentence on what it sees, pointing at the waiting card", () => {
    render(<ActivityRail items={HISTORY} now={NOW} asfaiAvailable />);
    expect(screen.getByText(/It sees only what this step sends/)).toBeInTheDocument();
    expect(screen.getByText(/What the model sees/)).toBeInTheDocument();
    cleanup();
    render(<ActivityRail items={HISTORY} now={{ actor: "asfai", label: "Checking", startedAt: T0 }} asfaiAvailable />);
    expect(screen.queryByText(/It sees only what this step sends/)).toBeNull();
  });

  it("claims zero-retention only when worker.zdr is exactly true", () => {
    const view = (zdr: boolean | null | undefined) => {
      const { container, unmount } = render(<ActivityRail items={HISTORY} now={NOW} worker={zdr === undefined ? {} : { zdr }} asfaiAvailable />);
      const text = container.textContent ?? "";
      unmount();
      return text;
    };
    expect(view(true)).toMatch(/zero-data-retention/);
    expect(view(false)).not.toMatch(/zero-data-retention/);
    expect(view(false)).toMatch(/normal data-retention terms/);
    expect(view(null)).not.toMatch(/retention/i);
    expect(view(undefined)).not.toMatch(/retention/i);
    // and with no worker at all
    const { container } = render(<ActivityRail items={HISTORY} now={NOW} asfaiAvailable />);
    expect(container.textContent).not.toMatch(/retention/i);
  });

  it("shows Model name for the whole session: the host's name when supplied, 'not reported' when missing or failed, nothing while the status request is still pending", () => {
    const { container, rerender } = render(<ActivityRail items={HISTORY} now={NOW} worker={{ model: "host-model-x" }} asfaiAvailable />);
    expect(container.textContent).toMatch(/Model name: host-model-x/);
    // the caption is not tied to a step working: it stays at rest
    rerender(<ActivityRail items={HISTORY} now={null} worker={{ model: "host-model-x" }} asfaiAvailable />);
    expect(container.textContent).toMatch(/Model name: host-model-x/);
    // missing, empty or an answered-but-nameless status: the caption says so, never "null"
    rerender(<ActivityRail items={HISTORY} now={null} worker={{ model: null }} asfaiAvailable />);
    expect(container.textContent).toMatch(/Model name: not reported/);
    expect(container.textContent).not.toMatch(/null/);
    rerender(<ActivityRail items={HISTORY} now={null} worker={{ model: "   " }} asfaiAvailable />);
    expect(container.textContent).toMatch(/Model name: not reported/);
    rerender(<ActivityRail items={HISTORY} now={null} worker={{ zdr: false }} asfaiAvailable />);
    expect(container.textContent).toMatch(/Model name: not reported/);
    // the status request has not answered yet: no caption at all
    rerender(<ActivityRail items={HISTORY} now={null} worker={null} asfaiAvailable />);
    expect(container.textContent).not.toMatch(/Model name/);
  });
});

describe("ActivityRail — the live region", () => {
  const region = (c: HTMLElement) => c.querySelector("[aria-live='polite']") as HTMLElement;

  it("is polite, atomic, and silent about history it was mounted with", () => {
    const { container } = render(<ActivityRail items={HISTORY} asfaiAvailable />);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(region(container)).toHaveAttribute("aria-live", "polite");
    expect(region(container)).toHaveAttribute("aria-atomic", "true");
    expect(region(container).textContent).toBe("");
  });

  it("announces a row when it is ADDED, once, and not again when the same items arrive in a new array", () => {
    const { container, rerender } = render(<ActivityRail items={HISTORY} asfaiAvailable />);
    const added = item("plan.confirmed", "teacher", "plan");
    rerender(<ActivityRail items={[...HISTORY, added]} asfaiAvailable />);
    expect(region(container).textContent).toBe("You: Confirmed the lesson plan.");
    // same items again (a new array with the same rows): nothing new, nothing re-announced
    rerender(<ActivityRail items={[...HISTORY, added]} asfaiAvailable />);
    expect(region(container).textContent).toBe("You: Confirmed the lesson plan.");
    // the clock ticking does not announce either
    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(region(container).textContent).toBe("You: Confirmed the lesson plan.");
  });

  it("does not announce the in-flight step (the waiting card already does), nor a step finishing without a row", () => {
    const { container, rerender } = render(<ActivityRail items={HISTORY} asfaiAvailable />);
    rerender(<ActivityRail items={HISTORY} now={{ actor: "worker", label: "Drafting", startedAt: T0 }} asfaiAvailable />);
    expect(region(container).textContent).toBe("");
    rerender(<ActivityRail items={HISTORY} now={null} asfaiAvailable />);
    expect(region(container).textContent).toBe("");
  });

  it("names several rows when several arrive together", () => {
    const { container, rerender } = render(<ActivityRail items={HISTORY.slice(0, 2)} asfaiAvailable />);
    rerender(<ActivityRail items={HISTORY.slice(0, 4)} asfaiAvailable />);
    expect(region(container).textContent).toBe("Drafting model: Drafted 3 objectives from 1 material. You: Your decisions: 2 accepted, 1 renamed.");
  });
});

describe("ActivityRail — narrow screens collapse, wide screens do not", () => {
  it("wide: the history is always open and there is no toggle", () => {
    stubMedia({ wide: true });
    render(<ActivityRail items={HISTORY} asfaiAvailable />);
    expect(screen.queryByRole("button", { name: /Behind the scenes/ })).toBeNull();
    expect(rows()).toHaveLength(HISTORY.length);
  });

  it("narrow: a labelled disclosure, closed at first; the step in flight stays visible while it is closed", () => {
    stubMedia({ wide: false });
    const now = { actor: "worker" as const, label: "Drafting a lesson plan from your 1 confirmed objective", startedAt: T0 };
    render(<ActivityRail items={HISTORY} now={now} asfaiAvailable />);
    const toggle = screen.getByRole("button", { name: /Behind the scenes/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.textContent).toMatch(/7 steps/);
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(body).toHaveAttribute("hidden");
    expect(screen.getByText(now.label)).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(body).not.toHaveAttribute("hidden");
    expect(rows()).toHaveLength(HISTORY.length);
  });

  it("narrow: one step reads \"1 step\"", () => {
    stubMedia({ wide: false });
    render(<ActivityRail items={[item("course.created", "teacher", "record")]} asfaiAvailable />);
    expect(screen.getByRole("button", { name: /Behind the scenes/ }).textContent).toMatch(/1 step\b/);
  });
});

describe("ActivityRail — consecutive alike steps are one row", () => {
  it("folds three decisions made within two minutes into one row with the counts added", () => {
    const three = [
      item("objectives.decided", "teacher", "objectives", { decisions: 1, accepted: 1 }, 4),
      item("objectives.decided", "teacher", "objectives", { decisions: 1, accepted: 1 }, 3),
      item("objectives.decided", "teacher", "objectives", { decisions: 1, accepted: 1 }, 2),
    ];
    render(<ActivityRail items={three} asfaiAvailable />);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toMatch(/Your decisions: 3 accepted/);
    expect(rows()[0].getAttribute("data-seq")).toBe(String(three[2].seq)); // the newest of the three stands for the row
  });

  it("adds the different verbs separately, and reads the head count of steps after grouping", () => {
    const mixed = [
      item("objectives.decided", "teacher", "objectives", { decisions: 1, accepted: 1 }, 5),
      item("objectives.decided", "teacher", "objectives", { decisions: 1, renamed: 1 }, 4),
      item("objectives.decided", "teacher", "objectives", { decisions: 1, accepted: 1 }, 3),
    ];
    render(<ActivityRail items={mixed} asfaiAvailable />);
    expect(rows()[0].textContent).toMatch(/Your decisions: 2 accepted, 1 renamed/);
    expect(screen.getByText("1 step", { exact: false, selector: "p" }).textContent).toBe("1 step, newest first");
  });

  it("keeps decisions apart when more than two minutes pass between them", () => {
    render(<ActivityRail items={[
      item("objectives.decided", "teacher", "objectives", { decisions: 1, accepted: 1 }, 10),
      item("objectives.decided", "teacher", "objectives", { decisions: 1, accepted: 1 }, 2),
    ]} asfaiAvailable />);
    expect(rows()).toHaveLength(2);
  });

  it("never folds different actors, actions or checkpoints into each other", () => {
    render(<ActivityRail items={[
      item("checkpoint.confirmed", "teacher", "record", { checkpoint: "files" }, 6),
      item("checkpoint.confirmed", "teacher", "record", { checkpoint: "outline" }, 5),
      item("plan.drafted", "worker", "plan", { activities: 3 }, 4),
      item("plan.confirmed", "teacher", "plan", {}, 3),
    ]} asfaiAvailable />);
    expect(rows()).toHaveLength(4);
  });

  it("does not add counts that are not a tally (two plans drafted are two plans, not six activities)", () => {
    render(<ActivityRail items={[
      item("plan.drafted", "worker", "plan", { activities: 3 }, 3),
      item("plan.drafted", "worker", "plan", { activities: 4 }, 2),
    ]} asfaiAvailable />);
    expect(rows()).toHaveLength(2);
  });

  it("says how many times when identical steps with nothing to add repeat", () => {
    render(<ActivityRail items={[
      item("intake.answered", "teacher", "outline", {}, 3),
      item("intake.answered", "teacher", "outline", {}, 2),
      item("intake.answered", "teacher", "outline", {}, 1),
    ]} asfaiAvailable />);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toMatch(/Answered the questions · 3 times/);
  });
});

describe("ActivityRail — it owns its scroll and sits still while the stage scrolls", () => {
  it("is sticky inside its own full-height cell, with a max height of the window minus its margins", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ActivityRail.module.css"), "utf8");
    const wide = css.slice(css.indexOf("@media (min-width: 80rem)"));
    expect(wide).toMatch(/\.root\s*\{[^}]*position:\s*sticky/);
    expect(wide).toMatch(/\.root\s*\{[^}]*max-height:\s*calc\(100vh/);
    expect(wide).toMatch(/\.root\s*\{[^}]*overflow-y:\s*auto/);
  });
});

describe("ActivityRail — C-e: the glossary's words, a clock when the words say nothing, a header on one line", () => {
  it("tags a row with the stage vocabulary: Material, Brief, Objectives, Plan, Version; never Outline, Record or Package", () => {
    const all: ActivityItem[] = [
      item("course.created", "teacher", "record", {}, 50), item("checkpoint.confirmed", "teacher", "outline", { checkpoint: "outline" }, 40),
      item("objectives.decided", "teacher", "objectives", { accepted: 1 }, 30), item("plan.drafted", "worker", "plan", { activities: 2 }, 20),
      item("package.sealed", "teacher", "package", { version: 1 }, 10),
    ];
    render(<ActivityRail items={all} asfaiAvailable />);
    expect(rows().map((li) => li.querySelector("[data-artifact]")?.textContent?.replace("Changed: ", ""))).toEqual(["Version", "Plan", "Objectives", "Brief", "Material"]);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\b(outline|package|sealed|record)\b(?! and the rules)/i);
  });

  it("when every row would say \"just now\", shows the clock (with seconds if they share a minute), and goes back to words as time passes", () => {
    const fresh = [item("course.created", "teacher", "record", {}, 0), item("checkpoint.confirmed", "teacher", "record", { checkpoint: "files" }, 0)];
    render(<ActivityRail items={fresh} asfaiAvailable />);
    const times = () => rows().map((li) => li.querySelector("time")?.textContent ?? "");
    expect(times().every((t) => /^\d\d:\d\d:\d\d$/.test(t))).toBe(true);
    expect(times().join(" ")).not.toMatch(/just now/);
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(times().every((t) => t === "3 minutes ago")).toBe(true);
  });

  it("does not use the clock when the rows differ, or when there is only one row", () => {
    render(<ActivityRail items={[item("course.created", "teacher", "record", {}, 0)]} asfaiAvailable />);
    expect(screen.getByText("just now")).toBeInTheDocument();
    cleanup();
    render(<ActivityRail items={[item("course.created", "teacher", "record", {}, 5), item("checkpoint.confirmed", "teacher", "record", { checkpoint: "files" }, 0)]} asfaiAvailable />);
    expect(rows().map((li) => li.querySelector("time")?.textContent)).toEqual(["just now", "5 minutes ago"]);
  });
});
