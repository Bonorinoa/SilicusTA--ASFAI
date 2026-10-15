/**
 * DecisionCard.reword.test.tsx — "Edit wording" on a CONFIRMED objective, bound to the REAL gate (via the
 * harness): the intent is a `reword` verb carrying only the objective id and the statement, the id stays,
 * the plan still cites it, the original wording stays visible and the row says "Reworded by you".
 * Focus is managed on open, save and cancel; the editor is keyboard-operable.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ConfirmGateHarness } from "../../gate/harness";
import { useHarnessRevision } from "../../gate/useHarness";
import type { ProposalView } from "../../gate/types";
import { DecisionCard } from "./DecisionCard";

const here = path.dirname(fileURLToPath(import.meta.url));
const P1 = "Students can model one fraction.";

function BoundCard({ harness }: { harness: ConfirmGateHarness }) {
  useHarnessRevision(harness);
  return <DecisionCard rows={harness.views()} onDispatch={(intent) => harness.dispatch(intent)} />;
}

const rowFor = (statement: string) => screen.getByRole("heading", { name: statement }).closest("li") as HTMLElement;

function accepted(statement = P1) {
  const harness = new ConfirmGateHarness();
  const [p] = harness.propose([{ statement }]);
  harness.dispatch({ verb: "accept", proposalId: p.id });
  return { harness, id: p.id };
}

describe("DecisionCard: Edit wording on a confirmed objective", () => {
  it("is offered on accepted, renamed and added rows only, never on a proposal or a dropped objective", () => {
    const harness = new ConfirmGateHarness();
    const [a, r, pr, d] = harness.propose([{ statement: "Accepted one." }, { statement: "To rename." }, { statement: "Still proposed." }, { statement: "To drop." }]);
    harness.dispatch({ verb: "accept", proposalId: a.id });
    harness.dispatch({ verb: "rename", proposalId: r.id, statement: "Renamed one." });
    harness.dispatch({ verb: "add", statement: "Added one." });
    harness.dispatch({ verb: "drop", proposalId: d.id });
    void pr;
    render(<BoundCard harness={harness} />);
    for (const s of ["Accepted one.", "Renamed one.", "Added one."]) {
      expect(within(rowFor(s)).getByRole("button", { name: `Edit the wording of objective ${[...document.querySelectorAll("h3")].findIndex((h) => h.textContent === s) + 1}: “${s}”` })).toBeInTheDocument();
      expect(within(rowFor(s)).queryByRole("button", { name: /^rename objective/i })).not.toBeInTheDocument();
    }
    expect(within(rowFor("Still proposed.")).queryByRole("button", { name: /Edit the wording/ })).not.toBeInTheDocument();
    expect(within(rowFor("Still proposed.")).getByRole("button", { name: /^rename objective/i })).toBeInTheDocument();
    expect(within(rowFor("To drop.")).queryByRole("button", { name: /Edit the wording/ })).not.toBeInTheDocument();
  });

  it("opens an inline editor with focus in it, saves with a reword intent, keeps the id, and focus lands on the row's actions", async () => {
    const user = userEvent.setup();
    const { harness, id } = accepted();
    render(<BoundCard harness={harness} />);
    const row = rowFor(P1);
    await user.click(within(row).getByRole("button", { name: /Edit the wording of objective 1/ }));

    const editor = within(row).getByRole("textbox", { name: "Edit the wording of objective 1" });
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue(P1);
    expect(within(row).getByText(/keeps its id, so the lesson plan still cites it/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await user.clear(editor);
    await user.type(editor, "Learners model one fraction and explain it.");
    await user.click(within(row).getByRole("button", { name: "Save" }));

    const d = harness.gate.decisions().at(-1)!;
    expect(d.verb).toBe("reword");
    expect(d.targetId).toBe(id);
    expect(harness.gate.getObjective(id)?.statement).toBe("Learners model one fraction and explain it.");
    expect(harness.gate.getObjective(id)?.id).toBe(id);

    // Honest wording: reworded by you, with the original still visible.
    const after = rowFor("Learners model one fraction and explain it.");
    expect(within(after).getByText("Reworded by you")).toBeInTheDocument();
    expect(within(after).getByText(/as proposed: “Students can model one fraction\.” — you reworded it; the objective id is unchanged\./)).toBeInTheDocument();
    // Still "Accepted" (what it is did not change), still revocable, still editable.
    expect(within(after).getByText("Accepted")).toBeInTheDocument();
    expect(within(after).getByRole("button", { name: /Edit the wording of objective 1/ })).toBeInTheDocument();
    expect(within(after).getByRole("button", { name: /^Revoke your decision on objective 1/ })).toBeInTheDocument();
    // Focus is not stranded on <body>.
    expect(document.body).not.toHaveFocus();
    expect(after.contains(document.activeElement)).toBe(true);
  });

  it("Enter saves, Esc cancels without dispatching, and Cancel returns focus to Edit wording", async () => {
    const user = userEvent.setup();
    const { harness } = accepted();
    const before = harness.gate.decisions().length;
    render(<BoundCard harness={harness} />);

    await user.click(within(rowFor(P1)).getByRole("button", { name: /Edit the wording/ }));
    await user.keyboard(" and then some{Escape}");
    expect(harness.gate.decisions()).toHaveLength(before);
    expect(screen.getByRole("heading", { name: P1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit the wording of objective 1/ })).toHaveFocus();

    await user.click(within(rowFor(P1)).getByRole("button", { name: /Edit the wording/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(harness.gate.decisions()).toHaveLength(before);
    expect(screen.getByRole("button", { name: /Edit the wording of objective 1/ })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /Edit the wording/ }));
    await user.keyboard(" Now.{Enter}");
    expect(harness.gate.decisions().at(-1)!.verb).toBe("reword");
  });

  it("refuses an empty or unchanged wording in the editor itself, with a visible reason, and sends nothing", async () => {
    const user = userEvent.setup();
    const { harness } = accepted();
    const before = harness.gate.decisions().length;
    render(<BoundCard harness={harness} />);
    await user.click(screen.getByRole("button", { name: /Edit the wording/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Unchanged — change the wording, or Cancel.")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("An objective needs a statement.")).toBeInTheDocument();
    expect(harness.gate.decisions()).toHaveLength(before);
  });

  it("the intent carries only the verb, the objective id and the statement (no provenance, ids or keys)", async () => {
    const user = userEvent.setup();
    const { id } = accepted();
    const rows: ProposalView[] = [{ id, kind: "local", status: "accepted", statement: P1, originalStatement: P1, source: null, alignment: null, by: "ai" }];
    const onDispatch = vi.fn();
    render(<DecisionCard rows={rows} onDispatch={onDispatch} />);
    await user.click(screen.getByRole("button", { name: /Edit the wording/ }));
    await user.type(screen.getByRole("textbox"), " Plus.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith({ verb: "reword", proposalId: id, statement: `${P1} Plus.` });
  });

  it("an objective the teacher added shows its first wording as the original once reworded; the announcement is polite and single", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.dispatch({ verb: "add", statement: "Students can debug." });
    render(<BoundCard harness={harness} />);
    await user.click(screen.getByRole("button", { name: /Edit the wording/ }));
    await user.type(screen.getByRole("textbox"), " a short program.{Enter}");
    const row = rowFor("Students can debug. a short program.");
    expect(within(row).getByText("Reworded by you")).toBeInTheDocument();
    expect(within(row).getByText(/as you first wrote it: “Students can debug\.”/)).toBeInTheDocument();
    const live = document.querySelectorAll("[aria-live='polite'][aria-atomic='true']");
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent("Objective 1: wording saved, reworded by you.");
  });

  it("keeps 44px targets and a visible focus ring on the Edit wording action and the editor buttons (same tokens, same module)", () => {
    const css = readFileSync(path.join(here, "DecisionCard.module.css"), "utf8");
    expect(css).toMatch(/\.verbButton\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.verbButton:focus-visible/);
    // Edit wording reuses the existing verb button (data-verb="rename"); no new component, no raw colours added.
    const tsx = readFileSync(path.join(here, "DecisionCard.tsx"), "utf8");
    expect(tsx).toMatch(/Edit wording/);
    expect(css).toMatch(/\.rewordedMark::before/);
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css.slice(css.indexOf(".rewordedMark"), css.indexOf(".rewordedMark") + 200))).toBe(false);
  });
});
