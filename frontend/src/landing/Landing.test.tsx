/**
 * Landing.test.tsx — the landing says what Silicus is, says what it is not, and routes without disturbing the app.
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
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    const main = screen.getByRole("main");
    const regions = within(main).getAllByRole("region");
    expect(regions.map((r) => r.getAttribute("aria-labelledby")).every(Boolean)).toBe(true);
    expect(regions).toHaveLength(5);
  });

  it("shows the five steps in order, the three nevers, the age range, and says prototype plainly", () => {
    render(<Landing />);
    const names = [...document.querySelectorAll("ol > li > h3")].map((h) => h.textContent);
    expect(names).toEqual(["Course", "Brief", "Objectives", "Lesson plan", "Version"]);
    expect(screen.getByRole("heading", { name: "What Silicus never does" })).toBeInTheDocument();
    for (const t of ["Decide for you", "Keep your files", "Grade or save student questions"]) expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    expect(screen.getByText(/aged\s5–14/, { selector: "p" })).toBeInTheDocument();
    expect(screen.getAllByText(/prototype/i).length).toBeGreaterThanOrEqual(3);
  });

  it("offers Try it (to the app) and the local setup, and nothing like sign-in", () => {
    render(<Landing />);
    expect(screen.getByRole("link", { name: "Try it" })).toHaveAttribute("href", "#/live");
    expect(screen.getByRole("link", { name: "Run it on your computer (with ASFAI)" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).not.toMatch(/sign[ -]?in|log[ -]?in|sign up|create an account/i);
    expect(document.querySelector("img")).toBeNull();
  });

  it("the secondary action moves to the local setup and puts focus on its heading, without changing the route", () => {
    window.location.hash = "#/";
    render(<Landing />);
    const heading = screen.getByRole("heading", { name: "Run it on your computer" });
    heading.scrollIntoView = vi.fn();
    screen.getByRole("link", { name: "Run it on your computer (with ASFAI)" }).click();
    expect(heading).toHaveFocus();
    expect(window.location.hash).toBe("#/");
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

  it("says where the record is kept, truthfully for each build", async () => {
    for (const [mode, kept, other] of [["browser", /kept in this browser/, /on this computer/], ["", /kept on this computer/, /in this browser/]] as const) {
      vi.resetModules();
      vi.stubEnv("VITE_SILICUS_MODE", mode);
      const { Landing: L } = await import("./Landing");
      const { unmount } = render(<L />);
      const footer = screen.getByRole("contentinfo").textContent ?? "";
      expect(footer).toMatch(kept);
      expect(footer).not.toMatch(other);
      expect(/demo passcode/.test(document.body.textContent ?? "")).toBe(mode === "browser");
      unmount();
    }
  });
});

describe("routing (Workbench.tsx)", () => {
  it("#/ shows the landing; the workbench hashes do not, and no hash at all opens where it always did", () => {
    window.location.hash = "#/";
    const first = render(<Workbench />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Plan a lesson/);
    first.unmount();
    window.location.hash = "";
    const bare = render(<Workbench />);
    expect(screen.queryByText(/^Plan a lesson/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    bare.unmount();
    window.location.hash = "#/decision";
    const { unmount } = render(<Workbench />);
    expect(screen.queryByText(/^Plan a lesson/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workbench sections" })).toBeInTheDocument();
    unmount();
  });
});

/* ---------------------------- contrast ---------------------------- */

describe("every text pair the landing sets is AA (>= 4.5:1)", () => {
  const tokens = Object.fromEntries([...readFileSync(join(process.cwd(), "src/design/tokens.css"), "utf8").matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg: string, bg: string) => { const [a, b] = [lum(tokens[fg]), lum(tokens[bg])].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  // [text colour, ground it is set on] — read from Landing.module.css
  const PAIRS: [string, string][] = [
    ["ink", "canvas"], ["ink-soft", "canvas"],                      // headline, standfirst, body, notes on the desk
    ["accent-strong", "canvas"],                                    // the secondary link
    ["paper-raised", "accent"], ["paper-raised", "accent-strong"],  // the primary button, resting and hover
    ["ink", "paper"], ["ink-soft", "paper"], ["ink-muted", "paper"], // the steps, the wordmark, the footer
    ["accent-strong", "paper"],                                     // the step numerals
    ["ink", "sunken"],                                              // command lines
  ];
  it.each(PAIRS)("%s on %s", (fg, bg) => { expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5); });

  it("the stylesheet sets no text colour that is not in the list above", () => {
    const css = readFileSync(join(process.cwd(), "src/landing/Landing.module.css"), "utf8");
    const used = new Set([...css.matchAll(/(?<![-\w])color:\s*var\(--color-([a-z-]+)\)/g)].map((m) => m[1]));
    const allowed = new Set(PAIRS.map(([fg]) => fg));
    expect([...used].filter((c) => !allowed.has(c))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(|gradient/);
  });
});
