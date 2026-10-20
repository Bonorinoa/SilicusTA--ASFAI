/** SourcesPanel.test.tsx — R6: each source says what it is and what Silicus did with it. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourcesPanel } from "./SourcesPanel";
import type { HeldFile } from "../materials/session";

const file = (name: string, chars = 1200): HeldFile => ({ name, kind: "text", text: "x".repeat(chars), chars });
const panel = (over: Partial<Parameters<typeof SourcesPanel>[0]> = {}) =>
  render(<SourcesPanel names={[]} held={[]} links={[]} onHeld={vi.fn()} onLinks={vi.fn()} confirmed={false} {...over} />);

describe("SourcesPanel states (R6)", () => {
  it("a held file says it was read, with its characters; a link says when it is fetched", () => {
    panel({ held: [file("Lesson notes", 1)], links: ["https://example.org/plants"] });
    expect(screen.getByText(/Read in this tab · Text · 1 character$/)).toBeTruthy();
    expect(screen.getByText("Fetched when Silicus reads it")).toBeTruthy();
  });
  it("after a round, counts the proposals that name the source, and says why one was skipped", () => {
    panel({
      held: [file("Lesson notes"), file("Blank")],
      proposals: [{ source: "from material: Lesson notes" }, { source: "from material: Lesson notes, Blank" }, { source: "from material: (several)" }],
      skipped: [{ name: "Blank", code: "EMPTY", reason: "material has no text" }],
    });
    expect(screen.getByText("Used for 2 proposals")).toBeTruthy();
    expect(screen.getByText("Skipped: it has no text Silicus can read")).toBeTruthy();
    expect(screen.queryByText(/material has no text/)).toBeNull();
  });
  it("a names-only row offers to attach the file, and disappears once a file matches it ignoring case and extension", () => {
    const { rerender } = panel({ names: ["Lesson Notes.pdf"] });
    expect(screen.getByRole("button", { name: "Attach the file for Lesson Notes.pdf" })).toBeTruthy();
    rerender(<SourcesPanel names={["Lesson Notes.pdf"]} held={[file("lesson notes.docx")]} links={[]} onHeld={vi.fn()} onLinks={vi.fn()} confirmed={false} />);
    expect(screen.queryByText("Lesson Notes.pdf")).toBeNull();
    expect(screen.queryByRole("button", { name: /Attach the file/ })).toBeNull();
  });
});
