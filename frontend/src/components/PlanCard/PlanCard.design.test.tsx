/**
 * PlanCard.design.test.tsx — the learning design a v2 plan carries, on the page; and the v1
 * fallback: a plan with none of the new fields renders byte-for-byte as it did before (golden HTML
 * captured from the pre-v2 PlanCard).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPlanScenario } from "../../gate/demo";
import type { LessonPlanView } from "../../gate/types";
import { PlanCard } from "./PlanCard";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenario = buildPlanScenario();
const STAGE1 = "AI in this course: learners do not use AI at all; nothing a child makes goes into a tool. The teacher may use AI to prepare.";

/** The scenario mints fresh uuids each run: name each distinct one by first appearance, so HTML compares by shape. */
function stable(html: string): string {
  const seen = new Map<string, string>();
  return html.replace(/urn:uuid:[0-9a-f-]{36}/g, (u) => {
    if (!seen.has(u)) seen.set(u, `urn:uuid:#${seen.size + 1}`);
    return seen.get(u)!;
  });
}

function v2(over: Partial<LessonPlanView> = {}): LessonPlanView {
  const [a0, a1, ...rest] = scenario.plan.activities;
  return {
    ...scenario.plan,
    activities: [
      { ...a0, phase: 1, learnerFirst: "Each pair gives a guess and its reason.", decisionAfterHelp: "Each pair keeps or changes its guess, and says why.", channels: ["speaking", "discussion"], aiStatus: "forbidden", session: 1 },
      { ...a1, phase: 2, supportingPhase: 3, learnerFirst: "Each pair sorts alone first.", aiStatus: "permitted", noAiAlternative: "The same sorting with paper cards only.", channels: ["handling", "writing"], session: 1 },
      ...rest,
    ],
    sessions: [{ session: 1, evidence: { kind: "work-product", whatLearnerProduces: "Each child's sorted card strip with one written reason." } }],
    spacedReviews: [
      { afterDays: 2, form: "recall-without-support", whatChanges: "no cards on the table", prompt: "Name two things at home that decide by themselves." },
      { afterDays: 7, form: "far-transfer", whatChanges: "a picture of a shop instead of the cards", prompt: "Spot the AI in this shop picture and say how you know." },
    ],
    notes: ['aiStatus "permitted" clamped to "forbidden": learners at this stage do not use AI at all.'],
    ...over,
  };
}

describe("PlanCard, plan schema v2 learning design", () => {
  it("stage 1-2: the AI policy shows once, at the top, in plain words, and no per-activity AI tag", () => {
    const { container } = render(<PlanCard plan={v2({ aiPolicy: STAGE1 })} objectives={scenario.objectives} />);
    const lines = container.querySelectorAll("[data-ai-policy]");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("Children don’t use AI in this lesson. You may use it to prepare.");
    expect(container.querySelectorAll("[data-ai-status]")).toHaveLength(0);
    // the policy sits above the activities
    const ol = container.querySelector("ol")!;
    expect(lines[0].compareDocumentPosition(ol) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("stage 3-4: a small AI tag per activity, with the no-AI alternative on focus and always in print", () => {
    const { container } = render(<PlanCard plan={v2()} objectives={scenario.objectives} />);
    expect(container.querySelector("[data-ai-policy]")).toBeNull();
    const tags = [...container.querySelectorAll("[data-ai-status]")];
    expect(tags.map((t) => t.getAttribute("data-ai-status"))).toEqual(["forbidden", "permitted"]);
    expect(tags[0].textContent).toBe("No AI");
    const permitted = tags[1] as HTMLElement;
    expect(permitted.getAttribute("tabindex")).toBe("0");
    const tip = document.getElementById(permitted.getAttribute("aria-describedby")!)!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toBe("Without AI: The same sorting with paper cards only.");
    // print copy: a block the print sheet shows (hidden on screen)
    const printCopy = container.querySelectorAll("[data-no-ai-print]");
    expect(printCopy).toHaveLength(1);
    expect(printCopy[0].textContent).toContain("The same sorting with paper cards only.");
    const css = readFileSync(path.join(here, "PlanCard.module.css"), "utf8");
    expect(css).toMatch(/@media print \{[^}]*\.printOnlyBlock \{ display: block; \}/);
  });

  it("per activity: a phase chip, 'Learners first', 'Then they decide' when present, channels as words", () => {
    render(<PlanCard plan={v2()} objectives={scenario.objectives} />);
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("[data-design-row]"));
    expect(items).toHaveLength(2);
    const [first, second] = items;
    expect(first.querySelector("[data-phase]")!.textContent).toBe("1 Notice and guess");
    expect(second.querySelector("[data-phase]")!.textContent).toBe("2 Try and fix · also 3 Check own work");
    expect(within(first).getByText("Each pair gives a guess and its reason.")).toBeInTheDocument();
    expect(first.querySelector("[data-learner-first]")!.textContent).toMatch(/^Learners first:/);
    expect(first.querySelector("[data-then-decide]")!.textContent).toMatch(/^Then they decide: Each pair keeps/);
    expect(second.querySelector("[data-then-decide]")).toBeNull();
    expect(first.querySelector("[data-channels]")!.textContent).toBe("talk · discuss");
    expect(document.body.textContent).not.toMatch(/visual learner|auditory|kinesthetic|SYNAPSE|Chardonnens/i);
  });

  it("one 'Evidence for this session' line under the plan header", () => {
    const { container } = render(<PlanCard plan={v2()} objectives={scenario.objectives} />);
    const ev = container.querySelectorAll("[data-session-evidence]");
    expect(ev).toHaveLength(1);
    expect(ev[0].textContent).toBe("Evidence for this session Each child's sorted card strip with one written reason.");
    const h1 = container.querySelector("h1")!;
    expect(h1.compareDocumentPosition(ev[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a 'Later' section: each spaced review with its offset, what changes and the prompt", () => {
    render(<PlanCard plan={v2()} objectives={scenario.objectives} />);
    const later = screen.getByRole("region", { name: "Later" });
    const rows = within(later).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "In 2 daysRecall without help. What changes: no cards on the table“Name two things at home that decide by themselves.”",
      "Next weekSame idea, a new setting. What changes: a picture of a shop instead of the cards“Spot the AI in this shop picture and say how you know.”",
    ]);
  });

  it("the host's clamp notes as a short 'Silicus adjusted' list", () => {
    render(<PlanCard plan={v2()} objectives={scenario.objectives} />);
    const box = screen.getByRole("region", { name: "Silicus adjusted" });
    expect(within(box).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
      'AI use "permitted" clamped to "forbidden": learners at this stage do not use AI at all.',
    ]);
  });

  it("H3 C2: a clamped activity carries the 'AI removed by Silicus: reword this step' marker on screen and in print, and the host's note names the activity", () => {
    const [a0, a1, ...rest] = scenario.plan.activities;
    const plan = v2({
      activities: [
        { ...a0, phase: 1, aiStatus: "forbidden" },
        { ...a1, phase: 2, aiStatus: "forbidden", clamped: { from: "permitted", to: "forbidden", reason: "at this stage AI may follow only an attempt the teacher has watched" }, learnerDoes: "spotting the claim with a checklist" },
        ...rest,
      ],
      notes: ['aiStatus "permitted" clamped to "forbidden" in activity 2 "Spotting the claim": at this stage AI may follow only an attempt the teacher has watched.'],
    });
    const { container } = render(<PlanCard plan={plan} objectives={scenario.objectives} />);
    // the marker is ON the activity itself, once, with the exact fixed wording (UI never matches note text)
    expect(document.querySelectorAll("[data-clamped]")).toHaveLength(1);
    const marker = container.querySelector("[data-clamped]")!;
    expect(marker.textContent).toMatch(/AI removed by Silicus: reword this step/);
    // it sits inside the second activity's body (the clamped one)
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("[data-design-row]"));
    expect(items[1].contains(marker)).toBe(true);
    expect(items[0].contains(marker)).toBe(false);
    // the note names the activity the marker points at
    const box = screen.getByRole("region", { name: "Silicus adjusted" });
    expect(within(box).getAllByRole("listitem")[0].textContent).toContain('in activity 2 "Spotting the claim"');
    // print: the marker block is part of the sheet, shown in print media
    const css = readFileSync(path.join(here, "PlanCard.module.css"), "utf8");
    expect(css).toMatch(/\.clamped \{[\s\S]*?\}/);
    expect(css).not.toMatch(/@media print \{[\s\S]*?\.clamped \{ display: none/);
  });

  it("v1 fallback: a plan with no new fields renders exactly as before (golden HTML from the pre-v2 PlanCard)", () => {
    const golden = JSON.parse(readFileSync(path.join(here, "__fixtures__", "v1-plan.golden.json"), "utf8")) as Record<string, string>;
    const withCitations = { ...scenario.plan, citations: [{ ref: "marble:mt_x", label: "A topic", source: "marble", activityIndexes: [0], verified: true }] };
    const cases: Record<string, React.ReactElement> = {
      plain: <PlanCard plan={scenario.plan} objectives={scenario.objectives} teacher={{ name: "R. Okonkwo", confirmedAt: new Date("2026-10-09T10:00:00Z") }} />,
      record: <PlanCard plan={withCitations} objectives={scenario.objectives} ids="record" onPrint={() => {}} />,
    };
    for (const [name, el] of Object.entries(cases)) {
      const { container, unmount } = render(el);
      // H2a added the one Marble credit inside "Suggested alignment" (record case only, it cites Marble).
      // The golden stays the pre-v2 bytes; everything except that one deliberate line must still match.
      const credit = /<p class="[^"]*" data-marble-credit="true">.*?<\/p>/;
      expect(container.querySelectorAll("[data-marble-credit]").length, name).toBe(name === "record" ? 1 : 0);
      expect(stable(container.innerHTML.replace(credit, "")), name).toBe(stable(golden[name]));
      expect(container.querySelector("[data-ai-policy],[data-session-evidence],[data-later],[data-adjusted],[data-design-row],[data-learner-first]"), name).toBeNull();
      unmount();
    }
  });
});

// H2a: when the host replaces the plan's AI line with the stage rule, the "Silicus adjusted" note and the AI line
// on the plan must quote the same sentence — the plain-words one the plan shows — never the raw stage line beside it.
describe("PlanCard, 'Silicus adjusted' quotes the AI line the plan shows", () => {
  // The host's exact stage lines (host/worker.mjs STAGE_AI_POLICY) and its note format.
  const HOST_STAGE = {
    1: "AI in this course: learners do not use AI at all; nothing a child produces enters a tool. The teacher may use AI to prepare.",
    2: "AI in this course: teacher-led and projected to the whole class, only after children state their own view first; no child uses AI alone.",
  } as const;
  it.each([1, 2] as const)("stage %i: the note's quoted sentence is exactly the AI line shown", (stage) => {
    render(<PlanCard plan={v2({ aiPolicy: HOST_STAGE[stage], notes: [`replaced aiPolicy with the stage rule: ${HOST_STAGE[stage]}`] })} objectives={scenario.objectives} />);
    const shown = document.querySelector("[data-ai-policy] span:last-child")!.textContent!;
    const note = within(screen.getByRole("region", { name: "Silicus adjusted" })).getByText(/^Replaced the AI line/).textContent!;
    expect(note).toBe(`Replaced the AI line with this stage's rule: ${shown}`);
    expect(note).not.toContain("AI in this course:");
    expect(note).not.toMatch(/aiPolicy/);
  });
});
