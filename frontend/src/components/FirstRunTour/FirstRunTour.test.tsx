/**
 * FirstRunTour.test.tsx — four short panels, a real modal, and wording that overclaims nothing.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunTour } from "./FirstRunTour";
import { PANELS } from "./panels";

const ASFAI_LINE = "ASFAI can ask its own questions and align to its skill map. It is recommended, never required.";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const dialog = () => screen.getByRole("dialog");
const title = () => dialog().querySelector("h2")!.textContent;

describe("FirstRunTour — panels", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<FirstRunTour open={false} onClose={() => {}} asfaiAvailable />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a modal dialog named by the panel it shows", () => {
    render(<FirstRunTour open onClose={() => {}} asfaiAvailable={false} />);
    const d = dialog();
    expect(d).toHaveAttribute("aria-modal", "true");
    const labelled = document.getElementById(d.getAttribute("aria-labelledby")!);
    expect(labelled?.textContent).toBe("You bring the course.");
  });

  it("has four panels in order, walked with Next and Back, ending in \"Start my course\"", async () => {
    const user = userEvent.setup();
    render(<FirstRunTour open onClose={() => {}} asfaiAvailable={false} />);
    expect(PANELS).toHaveLength(4);
    const seen: (string | null)[] = [title()];
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start my course" })).toBeNull();
    for (let i = 0; i < 3; i += 1) { await user.click(screen.getByRole("button", { name: "Next" })); seen.push(title()); }
    expect(seen).toEqual([
      "You bring the course.",
      "The AI proposes, you decide.",
      "Silicus keeps the record.",
      "Publish, then let students ask.",
    ]);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start my course" })).toBeInTheDocument();
    expect(dialog().textContent).toMatch(/4 of 4/);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(title()).toBe("Silicus keeps the record.");
    expect(dialog().textContent).toMatch(/3 of 4/);
  });

  it("\"Start my course\" closes the tour through onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FirstRunTour open onClose={onClose} asfaiAvailable={false} />);
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Start my course" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts at the first panel every time it opens", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FirstRunTour open onClose={() => {}} asfaiAvailable={false} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(title()).toBe("The AI proposes, you decide.");
    rerender(<FirstRunTour open={false} onClose={() => {}} asfaiAvailable={false} />);
    rerender(<FirstRunTour open onClose={() => {}} asfaiAvailable={false} />);
    expect(title()).toBe("You bring the course.");
  });

  it("adds the ASFAI sentence to panel 2, only when ASFAI is available", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FirstRunTour open onClose={() => {}} asfaiAvailable />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(dialog().textContent).toContain(ASFAI_LINE);
    // and not on the other panels
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(dialog().textContent).not.toContain("ASFAI can ask");
    unmount();
    render(<FirstRunTour open onClose={() => {}} asfaiAvailable={false} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(dialog().textContent).not.toMatch(/ASFAI/);
  });

  it("keeps the locks: the AI proposes, the record is evidence not proof, chat is not evidence", async () => {
    const user = userEvent.setup();
    render(<FirstRunTour open onClose={() => {}} asfaiAvailable />);
    const all: string[] = [dialog().textContent ?? ""];
    for (let i = 0; i < 3; i += 1) { await user.click(screen.getByRole("button", { name: "Next" })); all.push(dialog().textContent ?? ""); }
    expect(all[1]).toMatch(/Nothing counts until you accept, rename, drop or add\./);
    expect(all[1]).toMatch(/You can always see what it was sent\./);
    expect(all[2]).toMatch(/append-only record/);
    expect(all[2]).toMatch(/evidence of what was decided, not proof of who decided it/);
    expect(all[3]).toMatch(/asking is never evidence of learning/i);
    const text = all.join(" ");
    expect(text).not.toMatch(/verified|secure|tamper|guarantee|zero-retention|zero-data/i);
    expect(text).not.toMatch(/\d\s?%/);
  });

  it("tells the step out loud through one polite live region, without moving focus", async () => {
    const user = userEvent.setup();
    render(<FirstRunTour open onClose={() => {}} asfaiAvailable={false} />);
    const live = dialog().querySelector("[aria-live='polite']")!;
    expect(dialog().querySelectorAll("[aria-live]")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(live.textContent).toBe("Step 2 of 4: The AI proposes, you decide.");
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  });
});

describe("FirstRunTour — focus and keys", () => {
  it("puts focus inside the dialog when it opens", () => {
    render(<FirstRunTour open onClose={() => {}} asfaiAvailable={false} />);
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  });

  it("traps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<><button type="button">Outside</button><FirstRunTour open onClose={() => {}} asfaiAvailable={false} /></>);
    await user.click(screen.getByRole("button", { name: "Next" })); // now Close, Back, Next are the stops
    const stops = Array.from(dialog().querySelectorAll<HTMLElement>("button:not([disabled])"));
    expect(stops.length).toBeGreaterThanOrEqual(3);
    const first = stops[0]; const last = stops[stops.length - 1];
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    for (let i = 0; i < 12; i += 1) { await user.tab(); expect(dialog().contains(document.activeElement)).toBe(true); }
    expect(screen.getByRole("button", { name: "Outside" })).not.toHaveFocus();
  });

  it("closes on Escape and calls onClose", () => {
    const onClose = vi.fn();
    render(<FirstRunTour open onClose={onClose} asfaiAvailable={false} />);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the Close button too", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FirstRunTour open onClose={onClose} asfaiAvailable={false} />);
    await user.click(screen.getByRole("button", { name: "Close the tour" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the opener when it closes", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (<><button type="button" onClick={() => setOpen(true)}>How it works</button><FirstRunTour open={open} onClose={() => setOpen(false)} asfaiAvailable={false} /></>);
    }
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole("button", { name: "How it works" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});
