/**
 * narrow-width.test.tsx — the shell and the intake surfaces hold up from 320px.
 *
 * jsdom applies no CSS-module rules and no media queries, so the LAYOUT itself is proved in real
 * Chrome by scripts/narrow-shell.mjs (every element's box against the viewport, 320 → 1440px, with
 * cropped screenshots). What is proved here is the CONTRACT that made the narrow window broken, so
 * it cannot come back quietly:
 *
 *   1. the promise line in the masthead is never hidden by a breakpoint (it was: `display: none`
 *      below 640px, which is why the product owner saw a header with an empty right half);
 *   2. the classes that hold the teacher's own words are allowed to break anywhere (a long course
 *      title, an unbreakable urn, a pasted URL);
 *   3. no control sets its own minimum width (a text field's default is ~20 characters and the file
 *      chooser's is wider still — both pushed the material panel past a 320px viewport);
 *   4. the honesty copy on the surfaces this round touches is exactly as it was.
 */
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaterialsPanel } from "./MaterialsPanel";
import { StudentChat } from "./StudentChat";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule in a stylesheet as {selectors, body}; the last one wins, as in CSS. */
function rules(css: string): { selectors: string[]; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()).filter(Boolean),
    body: m[2],
  }));
}
/** The body of every rule that names this class — including `a, .b { }` lists and media queries. */
function rule(css: string, selector: string): string {
  return rules(css).filter((r) => r.selectors.includes(selector)).map((r) => r.body).join(" ");
}
/** Everything inside the narrow-width media query (one breakpoint: 40rem, the project's own). */
function narrowBlock(css: string): string {
  const m = css.match(/@media\s*\(max-width:\s*40rem\)\s*\{([\s\S]*?)\n\}/);
  return m ? m[1] : "";
}
const normal = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const pageText = () => normal(document.body.textContent);

describe("narrow widths — the stylesheet contract", () => {
  const shell = read("../workbench/Workbench.module.css");
  const live = read("./LiveCourse.module.css");
  const intake = read("./OnboardingChat.module.css");
  const library = read("./CourseLibrary.module.css");

  it("the masthead keeps its promise: no breakpoint hides the tagline", () => {
    // The defect the product owner saw: below 640px the header showed the wordmark and nothing else.
    expect(rule(shell, ".tagline")).not.toMatch(/display:\s*none/);
    // Below the breakpoint the promise takes its own line under the wordmark, smaller.
    expect(narrowBlock(shell)).toMatch(/\.tagline\s*\{[^}]*flex:\s*1 1 100%/);
    // The masthead wraps rather than squeezes both halves onto one line.
    expect(rule(shell, ".masthead")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("one narrow breakpoint (40rem), the project's own, in every sheet it touches", () => {
    for (const [name, css] of [["Workbench", shell], ["LiveCourse", live], ["OnboardingChat", intake]] as const) {
      expect(css, name).toMatch(/@media\s*\(max-width:\s*40rem\)/);
      expect(narrowBlock(css).length, name).toBeGreaterThan(0);
    }
  });

  it("text that holds the teacher's own words can break anywhere", () => {
    const pairs: [string, string, string[]][] = [
      ["LiveCourse", live, [".title", ".lede", ".sub", ".pinDigest", ".pinDetail", ".assure"]],
      ["OnboardingChat", intake, [".ask", ".said", ".status", ".kept"]],
      ["CourseLibrary", library, [".name", ".meta"]],
    ];
    for (const [name, css, selectors] of pairs) {
      for (const selector of selectors) {
        expect(rule(css, selector), `${name} ${selector}`).toMatch(/overflow-wrap:\s*anywhere/);
      }
    }
  });

  it("no control sets its own minimum width, so nothing pushes past the viewport", () => {
    const pairs: [string, string, string[]][] = [
      ["OnboardingChat", intake, [".box", ".send", ".quiet"]],
      ["LiveCourse", live, [".primaryButton"]],
      ["CourseLibrary", library, [".open"]],
    ];
    for (const [name, css, selectors] of pairs) {
      for (const selector of selectors) {
        expect(rule(css, selector), `${name} ${selector}`).toMatch(/max-width:\s*100%/);
      }
    }
    // A text field takes the column's width instead of its own ~20-character default.
    expect(rule(intake, ".box")).toMatch(/width:\s*100%/);
  });

  it("the file chooser is a house-styled button, so no width can truncate its status text", () => {
    // Chrome renders the native control's "No file chosen" and truncates it to "N...n" in a narrow
    // column. The browser's own control is out of the layout and driven by a quiet label, the way
    // the record band's Import is.
    expect(rule(intake, ".fileHidden")).toMatch(/position:\s*absolute/);
    expect(rule(intake, ".fileHidden")).toMatch(/width:\s*1px/);
    expect(intake).toMatch(/\.fileHidden:focus-visible\s*\+\s*\.quiet/);
    // A label used as a button must be a box for its 44px minimum to mean anything.
    expect(rule(intake, ".quiet")).toMatch(/display:\s*inline-flex/);
  });

  it("a card that can sit in a row of buttons is allowed to shrink", () => {
    // The material panel is a flex item among the page's buttons: without min-width the widest
    // control inside it (the file chooser) set the whole card's width.
    expect(rule(intake, ".composer")).toMatch(/min-width:\s*0/);
    expect(rule(live, ".stageMeta")).toMatch(/min-width:\s*0/);
    expect(rule(library, ".rowBody")).toMatch(/min-width:\s*0/);
  });

  it("the four-column pin row has a stacked narrow fallback", () => {
    // 3rem + 9rem + 7rem + 1fr is 340px of fixed columns: wider than a 320px viewport.
    expect(rule(live, ".pinRow")).toMatch(/grid-template-columns/);
    const narrow = narrowBlock(live);
    expect(narrow).toMatch(/\.pinRow\s*\{[^}]*display:\s*flex/);
    expect(narrow).toMatch(/\.pinDigest,\s*\n?\s*\.pinDetail\s*\{[^}]*flex:\s*1 1 100%/);
  });

  it("the steps line becomes a numbered ledger instead of a wrapped arrow chain", () => {
    const narrow = narrowBlock(live);
    expect(narrow).toMatch(/\.moves\s*\{[^}]*flex-direction:\s*column/);
    expect(narrow).toMatch(/counter-reset:\s*step/);
    expect(narrow).toMatch(/content:\s*counter\(step\)/);
  });
});

describe("narrow widths — the honesty copy is untouched", () => {
  it("the material panel still says where the material goes and that it is not kept", () => {
    render(<MaterialsPanel busy={false} zdr onPropose={() => {}} />);
    const text = pageText();
    expect(text).toContain("The material stays in this tab only: it is not saved, and it is sent once to the drafting worker");
    expect(text).toContain("which is set to zero-data-retention providers only");
    expect(text).toContain("Reload and it is gone.");
    expect(text).toContain("You decide every objective afterwards.");
  });

  it("without zero retention the panel says the plain truth, not the claim", () => {
    render(<MaterialsPanel busy={false} zdr={null} onPropose={() => {}} />);
    expect(pageText()).toContain("under that provider's normal data-retention terms (not zero-retention), so use public material or material you may share");
  });

  it("the material panel's file chooser is still a labelled, reachable control", () => {
    render(<MaterialsPanel busy={false} zdr onPropose={() => {}} />);
    const chooser = screen.getByLabelText("A text file");
    expect(chooser).toBe(document.querySelector('input[type="file"]'));
    // The quiet label that drives it is on the page and names the act.
    expect(screen.getByText("Choose a file")).toBeInTheDocument();
  });

  it("the student chat still says an answer is not evidence of learning", () => {
    render(<StudentChat courseId="c1" courseTitle="How plants eat" />);
    const text = pageText();
    expect(text).toContain("Answers come only from the version you published, and say what they rest on.");
    expect(text).toContain("Asking here is not evidence of learning, and nothing you ask is saved.");
    // The composer is reachable and labelled, which is what a narrow window must not lose.
    expect(screen.getByLabelText("Your question")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
  });
});
