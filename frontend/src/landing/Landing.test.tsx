/**
 * Landing.test.tsx — the landing says what Silicus is, says what it is not, and leads into the studio.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing";
import Workbench from "../workbench/Workbench";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); window.location.hash = ""; });

describe("the page", () => {
  it("has one h1, a banner, one main, a footer, and every section is named by its heading", () => {
    render(<Landing />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plan a lesson with an AI that proposes. You decide.");
    expect([...document.querySelectorAll("h1 > span")].map((n) => n.textContent)).toEqual(["Plan a lesson with an AI that proposes.", "You decide."]);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    const regions = within(screen.getByRole("main")).getAllByRole("region");
    expect(regions.map((r) => r.getAttribute("aria-labelledby")).every(Boolean)).toBe(true);
    expect(regions).toHaveLength(6);
  });

  it("shows the four steps the studio uses, in order, the three places, the three nevers, and says prototype plainly", () => {
    render(<Landing />);
    const steps = within(screen.getByRole("region", { name: /^Four steps/ })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(steps).toEqual(["Brief", "Objectives", "Plan", "Publish"]);
    const places = within(screen.getByRole("region", { name: "Three places" })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(places).toEqual(["The studio", "Rehearse", "The student space"]);
    for (const t of ["Never decides for you", "Never keeps your files", "Never grades students"]) expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    expect(screen.getByText(/aged 5–14/)).toBeInTheDocument();
    expect(screen.getAllByText(/prototype/i).length).toBeGreaterThanOrEqual(3);
  });

  it("leads into the studio, keeps the classic page one quiet link away, and offers nothing like sign-in", () => {
    render(<Landing />);
    const open = screen.getAllByRole("link", { name: "Open the studio" });
    expect(open.length).toBe(2); // the header and the hero
    for (const a of open) expect(a).toHaveAttribute("href", "#/studio");
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Classic view" })).toHaveAttribute("href", "#/live");
    expect(screen.queryByRole("link", { name: /try it/i })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).not.toMatch(/sign[ -]?in|log[ -]?in|sign up|create an account/i);
  });

  it("the hero is drawn from the studio's own parts, not a screenshot, and its caption says what it shows", () => {
    render(<Landing />);
    expect(document.querySelectorAll("img")).toHaveLength(0);
    const figure = screen.getByRole("figure");
    expect(figure.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(within(figure).getByText(/The Objectives step: proposals wait/)).toBeInTheDocument();
    // the sketch's words match the studio's: Accept / Edit / Drop, a real provenance label, a suggestion labelled as one
    const sketch = figure.textContent ?? "";
    expect(sketch).toMatch(/AcceptEditDrop/);
    expect(sketch).toMatch(/from material: Lesson notes/);
    expect(sketch).toMatch(/Suggested by Silicus/);
  });

  it("How it works moves to the steps and puts focus on their heading, without changing the route", () => {
    window.location.hash = "#/";
    render(<Landing />);
    const heading = screen.getByRole("heading", { name: /^Four steps/ });
    heading.scrollIntoView = vi.fn();
    screen.getByRole("link", { name: "How it works" }).click();
    expect(heading).toHaveFocus();
    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/");
  });

  it("the technical detail is one collapsed disclosure at the bottom, and ASFAI is defined as a protocol exactly once", () => {
    render(<Landing />);
    const details = screen.getByText("Under the hood").closest("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    const regions = within(screen.getByRole("main")).getAllByRole("region");
    expect(regions[regions.length - 1].contains(details)).toBe(true);
    const text = document.body.textContent ?? "";
    expect(text.match(/ASFAI is a protocol[^.]*\./g)).toHaveLength(1);
    expect(text).not.toMatch(/ASFAI account/);
  });

  it("'decide' is said at most three times: the headline, the sketch's caption and the never-does heading", () => {
    render(<Landing />);
    const text = document.body.textContent ?? "";
    expect(text.match(/decid/gi)?.length ?? 0).toBeLessThanOrEqual(3);
    expect(text).toMatch(/You decide\./);
    expect(text).toMatch(/Never decides for you/);
  });

  it("claims only what Silicus controls: no retention promise, and the provider's terms are named where the drafting model is", () => {
    render(<Landing />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/zero[- ]?retention|not retained|never stored|never leaves|private by|confidential/i);
    expect(text).toMatch(/Silicus does not keep it/);
    expect(text.match(/provider’s terms apply/g)?.length).toBe(2);
  });

  it("an unbuilt feature carries a Soon badge and links nowhere", () => {
    render(<Landing />);
    const soon = screen.getByText("Class codes · soon");
    expect(soon.closest("a")).toBeNull();
  });
});

describe("copy contract (docs/design/glossary.md)", () => {
  it("uses none of the retired or forbidden words, and claims no approval or endorsement", () => {
    render(<Landing />);
    const text = document.body.textContent ?? "";
    for (const bad of [/\boutline\b/i, /\bpackage\b/i, /\bsealed?\b/i, /\byet\b/i, /\bverified\b/i, /\bsecure\b/i, /\bguarantee/i, /\bapproved\b/i, /\bvalidated\b/i,
      /\bGoogle\b/, /\bASU\b/, /\bArizona\b/, /\bendorse/i, /\btrusted by\b/i, /\bloved by\b/i, /\d+\s?%/, /\bthousands?\b/i]) {
      expect(text).not.toMatch(bad);
    }
  });

  it("says where the record is kept once, truthfully for each build, and the demo passcode only where there is one", async () => {
    for (const [mode, kept, other] of [["browser", /kept in this browser/, /on this computer/], ["", /kept on this computer/, /in this browser/]] as const) {
      vi.resetModules();
      vi.stubEnv("VITE_SILICUS_MODE", mode);
      const { Landing: L } = await import("./Landing");
      const { unmount } = render(<L />);
      const stands = screen.getByRole("region", { name: "Where it stands" }).textContent ?? "";
      expect(stands).toMatch(kept);
      const all = screen.getByRole("main").textContent ?? "";
      expect(all.match(/kept (in this browser|on this computer)/g)).toHaveLength(1);
      expect(all).not.toMatch(other);
      const hasPasscode = /The AI steps ask for a demo passcode\. Ask the person who shared this link\./.test(document.body.textContent ?? "");
      expect(hasPasscode).toBe(mode === "browser");
      unmount();
    }
  }, 15_000);
});

describe("routing (Workbench.tsx)", () => {
  it("the bare URL, '#' and '#/' show the landing; #/decision does not (#/live: Workbench.test.tsx)", () => {
    for (const hash of ["", "#", "#/"]) {
      window.location.hash = hash;
      const { unmount } = render(<Workbench />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Plan a lesson/);
      unmount();
    }
    window.location.hash = "#/decision";
    const { unmount } = render(<Workbench />);
    expect(screen.queryByText(/^Plan a lesson/)).toBeNull();
    expect(screen.getByRole("navigation", { name: "Workbench sections" })).toBeInTheDocument();
    unmount();
  });
});

/* ---------------------------- contrast ---------------------------- */

describe("every text pair the landing sets is AA (>= 4.5:1)", () => {
  const tokens = Object.fromEntries([...readFileSync(join(process.cwd(), "src/studio/studio.css"), "utf8").matchAll(/--fn-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg: string, bg: string) => { const [a, b] = [lum(tokens[fg]), lum(tokens[bg])].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  // [text colour, ground it is set on] — read from Landing.module.css
  const PAIRS: [string, string][] = [
    ["ink", "desk"], ["ink-soft", "desk"], ["accent", "desk"],      // headline, its second line, body on the desk
    ["accent-strong", "desk"],                                      // the secondary and footer links
    ["sheet", "accent"], ["sheet", "accent-strong"],                // the primary, resting and hover; the sketch's on-state
    ["ink", "sheet"], ["ink-soft", "sheet"], ["ink-muted", "sheet"], // header, cards, the sketch's labels
    ["ink-muted", "desk"],                                          // the wordmark's TA and the sketch's numerals
    ["accent-strong", "accent-wash"],                               // the step numerals
    ["soon-fg", "soon-bg"],                                         // the Soon badge
    ["danger", "sheet"],                                            // the sketch's Drop
    ["ink", "tray"],                                                // the sketch's Proposals heading
  ];
  it.each(PAIRS)("%s on %s", (fg, bg) => { expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5); });

  it("the stylesheet sets no text colour that is not in the list above, and no raw colour at all", () => {
    const css = readFileSync(join(process.cwd(), "src/landing/Landing.module.css"), "utf8");
    const used = new Set([...css.matchAll(/(?<![-\w])color:\s*var\(--fn-([a-z-]+)\)/g)].map((m) => m[1]));
    const allowed = new Set(PAIRS.map(([fg]) => fg));
    expect([...used].filter((c) => !allowed.has(c))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  });
});
