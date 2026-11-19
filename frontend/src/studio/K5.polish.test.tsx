/** K5 polish (KV2 C3–C5 and the K4-reported defects): one test per fix. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { WaitLines } from "../components/WaitLines/WaitLines";
import type { HeldFile } from "../materials/session";
import { SourcesPanel } from "./SourcesPanel";
import { namesFromProposals } from "./sourceUse";

const here = join(process.cwd(), "src", "studio");
const src = (f: string) => readFileSync(join(here, f), "utf8");

function Panel({ proposals = [] as { source: string | null }[] }) {
  const [held, setHeld] = useState<HeldFile[]>([]);
  return <SourcesPanel names={[]} held={held} links={[]} onHeld={setHeld} onLinks={() => {}} confirmed={false} proposals={proposals} />;
}

describe("K5 polish", () => {
  it("two files chosen at once keep both, not only the last", async () => {
    const user = userEvent.setup();
    const { container } = render(<Panel />);
    await user.click(screen.getAllByRole("button", { name: "+ Add a source" })[0]);
    const input = await waitFor(() => { const i = document.querySelector<HTMLInputElement>('input[type="file"]'); if (!i) throw new Error("no input"); return i; });
    await user.upload(input, [new File(["first notes"], "a-notes.txt", { type: "text/plain" }), new File(["second notes"], "b-notes.txt", { type: "text/plain" })]);
    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(text).toContain("a-notes.txt");
      expect(text).toContain("b-notes.txt");
    });
  });

  it("after a reload, a file the proposals name is a source, not 'No sources yet'", () => {
    render(<Panel proposals={[{ source: "from material: unit-3.pdf" }, { source: "from material: unit-3.pdf, glossary.docx" }]} />);
    expect(screen.queryByText(/No sources yet/)).not.toBeInTheDocument();
    expect(screen.getByText("unit-3.pdf")).toBeInTheDocument();
    expect(screen.getByText("glossary.docx")).toBeInTheDocument();
    expect(namesFromProposals([{ source: "from material: unit-3.pdf" }], ["Unit-3.PDF"])).toEqual([]);
  });

  it("the plan step's wait is not a second role=status region", () => {
    const { container } = render(<WaitLines live={false} label="Drafting the plan" lines={["One"]} every={1000} />);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(screen.getByRole("group", { name: "Drafting the plan" })).toBeInTheDocument();
    expect(src("steps/PlanStep.tsx")).toMatch(/<WaitLines live=\{false\} label="Drafting the plan"/);
  });

  it("'Back to the current step' is the primary action wherever it appears", () => {
    for (const f of ["steps/PlanStep.tsx", "steps/ObjectivesStep.tsx"]) {
      const lines = src(f).split("\n").filter((l) => l.includes(">Back to the current step<"));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l).toContain('data-primary="true"');
    }
  });

  it("the wizard's mobile step bar lays every step on one row", () => {
    expect(src("Wizard.module.css")).toMatch(/\.mobileBar \{[^}]*grid-auto-flow: column/);
  });
});
