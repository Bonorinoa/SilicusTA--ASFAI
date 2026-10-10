/**
 * PlanCard.test.tsx — a REAL confirmed LessonPlanRecord from the confirm-gate
 * core (built through proposeLessonPlan + confirmLessonPlan with recorded
 * teacher turns), rendered as a printable page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPlanScenario } from "../../gate/demo";
import { PlanCard } from "./PlanCard";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("PlanCard, rendering a real gate-confirmed plan", () => {
  const scenario = buildPlanScenario();

  it("renders the plan record: title, audience band, timing, version", () => {
    render(
      <PlanCard
        plan={scenario.plan}
        objectives={scenario.objectives}
        teacher={{ name: "R. Okonkwo", confirmedAt: new Date("2026-10-09T10:00:00Z") }}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Seeing the claim: how AI answers are built" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ages 8–10")).toBeInTheDocument();
    expect(screen.getByText("40 minutes")).toBeInTheDocument();
    expect(screen.getByText("3 activities")).toBeInTheDocument();
    expect(screen.getByText("Course version 1")).toBeInTheDocument();
    expect(screen.getByText("Confirmed by R. Okonkwo")).toBeInTheDocument();
  });

  it("renders every activity: title, minutes, learnerDoes, teacherDoes, evidence", () => {
    render(<PlanCard plan={scenario.plan} objectives={scenario.objectives} />);

    const warmup = screen
      .getByRole("heading", { name: "Warm-up: three answers, one question" })
      .closest("li") as HTMLElement;
    expect(within(warmup).getByText("8 min")).toBeInTheDocument();
    expect(
      within(warmup).getByText(
        "Read three short answers to the same question and mark the one that shows where it got its facts.",
      ),
    ).toBeInTheDocument();
    expect(
      within(warmup).getByText(
        "Read the answers aloud and ask the room which one they would trust, and why.",
      ),
    ).toBeInTheDocument();
    // One gutter style for every label/value pair (A3): label and value are
    // separate elements now, instead of one dashed sentence.
    expect(within(warmup).getByText("Evidence")).toBeInTheDocument();
    expect(within(warmup).getByText(/none collected in this activity/)).toBeInTheDocument();
    expect(within(warmup).getByText("Not evidence")).toBeInTheDocument();
    expect(
      within(warmup).getByText("A learner asking the assistant for the answer."),
    ).toBeInTheDocument();

    expect(screen.getByText(/teacher observation/)).toBeInTheDocument();
    expect(screen.getByText(/learner work product/)).toBeInTheDocument();
    expect(screen.getByText("15 min")).toBeInTheDocument();
    expect(screen.getByText("17 min")).toBeInTheDocument();
  });

  it("cites only confirmed objectives, keyed at the foot of the page", () => {
    render(<PlanCard plan={scenario.plan} objectives={scenario.objectives} />);

    const key = screen.getByRole("region", { name: "Objectives referenced" });
    const items = within(key).getAllByRole("listitem");
    expect(items).toHaveLength(3); // accepted + renamed + teacher-added …
    // … and NOT the dropped proposal ("list three facts about machine learning"):
    expect(within(key).queryByText(/list three facts about machine learning/)).not.toBeInTheDocument();

    expect(
      within(key).getByText(/Students can explain what an algorithm is/),
    ).toBeInTheDocument();
    expect(
      within(key).getByText(/Learners can find the claim in an AI answer/),
    ).toBeInTheDocument();
    expect(
      within(key).getByText(/Students can ask one honest question about how an AI tool works\./),
    ).toBeInTheDocument();
    // Alignment garnish rides along as metadata, never the headline. The raw id
    // sits in its own mono span, so assert the parts (testing-library matches an
    // element's own text nodes, not text nested in children).
    expect(within(key).getByText("mt_K6qtan847r")).toBeInTheDocument();
    expect(within(key).getByText(/close match/)).toBeInTheDocument();
  });

  it("states WHY an invalidated plan is invalid: the dropped citation and where it is cited (D)", () => {
    const invalidation = {
      invalidated: true,
      gaps: [
        {
          id: "urn:uuid:gap-1",
          statement: "Learners can find the claim in an AI answer and name what evidence would back it up.",
          citedIn: ["Spotting the claim"],
        },
      ],
    };
    render(
      <PlanCard
        plan={{ ...scenario.plan, status: "invalidated" }}
        objectives={scenario.objectives}
        invalidation={invalidation}
      />,
    );

    expect(screen.getByText(/why this plan is invalidated/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Learners can find the claim in an AI answer and name what evidence would back it up\.” was dropped, but this plan still cites it — in Spotting the claim\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be published until every cited objective is confirmed again\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/invalidated — needs re-confirmation/i)).toBeInTheDocument();
  });

  it("renders no invalidation notice on a confirmed plan", () => {
    render(<PlanCard plan={scenario.plan} objectives={scenario.objectives} />);
    expect(screen.queryByText(/why this plan is invalidated/i)).not.toBeInTheDocument();
  });

  it("carries the contract's honesty line as a quiet footer", () => {
    render(<PlanCard plan={scenario.plan} objectives={scenario.objectives} />);
    expect(
      screen.getByText("Asking the assistant a question is not evidence."),
    ).toBeInTheDocument();
  });

  it("has a clean print stylesheet (page chrome off, no mid-activity breaks)", () => {
    const css = readFileSync(path.join(here, "PlanCard.module.css"), "utf8");
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/break-inside:\s*avoid/);
    expect(css).toMatch(/\.page\s*\{[^}]*box-shadow:\s*none/s);
    // The gutter must be wide enough to hold its own labels — the A3 collision.
    expect(css).toMatch(/\.line\s*\{[^}]*grid-template-columns:\s*6rem/s);
    // Print geometry is GLOBAL: a CSS module cannot scope @page, so leaving it
    // here let the plan's page size govern every print in the app.
    const globalPrint = readFileSync(path.join(here, "..", "..", "styles", "print.css"), "utf8");
    expect(globalPrint).toMatch(/@page\s*\{[^}]*size:\s*A4/s);
    expect(globalPrint).toMatch(/margin:\s*20mm 22mm 22mm/);
    // No @page AT-RULE left in the module (the prose comment naming the move is
    // fine — this asserts the rule itself is gone).
    expect(css).not.toMatch(/@page\s*\{/);
  });

  it("self-hosts a real serif, so the display stack cannot fall back to Times", () => {
    const fonts = readFileSync(path.join(here, "..", "..", "styles", "fonts.css"), "utf8");
    expect(fonts).toMatch(/@font-face/);
    expect(fonts).toMatch(/font-family:\s*"Source Serif 4"/);
    // One VARIABLE file per style (a 200..900 range) gives a real 600 rather than
    // synthesis — on ChromeOS the old stack had no serif at all.
    expect(fonts).toMatch(/font-weight:\s*200 900/);
    expect(fonts).toMatch(/font-display:\s*swap/);
  });
});
