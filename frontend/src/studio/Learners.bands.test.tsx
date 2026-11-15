/** Learners.bands.test.tsx — H2a: an exact range across two bands marks every band it touches. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bandsTouched, rangeLabel, selectGroup, stepAge, EMPTY_AUDIENCE } from "./audience";
import { LearnersField } from "./Learners";
import w from "./Wizard.module.css";

describe("bandsTouched / rangeLabel (pure)", () => {
  it("5–12 touches Early and Upper primary; a shared edge age alone does not count", () => {
    expect(bandsTouched({ min: 5, max: 12 })).toEqual(["early-primary", "upper-primary"]);
    expect(bandsTouched({ min: 4, max: 8 })).toEqual(["early-primary"]);
    expect(bandsTouched({ min: 19, max: 22 })).toEqual(["adult"]);
    expect(bandsTouched({ min: 8, max: 8 })).toEqual(["early-primary", "upper-primary"]);
    expect(bandsTouched(null)).toEqual([]);
  });
  it("names the range and its bands", () => {
    expect(rangeLabel({ min: 5, max: 12 })).toBe("Ages 5–12: Early primary and Upper primary");
    expect(rangeLabel({ min: 4, max: 8 })).toBe("Ages 4–8: Early primary");
    expect(rangeLabel({ min: 6, max: 16 })).toBe("Ages 6–16: Early primary, Upper primary, Lower secondary and Upper secondary");
  });
});

describe("LearnersField with ages 5–12 after clicking Early primary", () => {
  const aud = stepAge(stepAge(stepAge(stepAge(stepAge(selectGroup(EMPTY_AUDIENCE, "early-primary"), "min", 1), "max", 1), "max", 1), "max", 1), "max", 1);
  it("the clicked band is checked; the other touched band shows the lighter covered state; the rest show nothing", () => {
    expect(aud.ages).toEqual({ min: 5, max: 12 });
    render(<LearnersField aud={aud} coverage={null} onGroup={vi.fn()} onStep={vi.fn()} />);
    const card = (name: string) => screen.getByText(name).closest("label")!;
    expect((card("Early primary").querySelector("input") as HTMLInputElement).checked).toBe(true);
    expect(card("Early primary").getAttribute("data-covered")).toBeNull(); // clicked, not "covered"
    expect(card("Upper primary").getAttribute("data-covered")).toBe("true");
    expect((card("Upper primary").querySelector("input") as HTMLInputElement).checked).toBe(false);
    for (const n of ["Lower secondary", "Upper secondary", "University / adult"]) expect(card(n).getAttribute("data-covered")).toBeNull();
    expect(card("Upper primary").className).toBe(w.group);
    expect(document.querySelector("[data-range-label]")?.textContent).toBe("Ages 5–12: Early primary and Upper primary");
  });
  it("the covered style is lighter than the clicked one: no wash, no inset ring", () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "Wizard.module.css"), "utf8");
    const covered = css.match(/\.group\[data-covered="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    const clicked = css.match(/\.group:has\(input:checked\)\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(covered).not.toBe("");
    expect(clicked).toMatch(/background/);
    expect(covered).not.toMatch(/background|box-shadow/);
  });
});
