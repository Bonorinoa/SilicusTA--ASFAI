/**
 * DecisionCard.test.tsx — the component wired to a REAL ConfirmGate instance
 * (via the harness), asserting that UI verbs become real teacher decisions and
 * that the card never fabricates state: nothing pre-confirmed, rename keeps ids
 * stable, the CONFIRM bar mirrors the gate's auto-confirmation, and the four
 * verbs are keyboard-operable.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import { describe, expect, it, vi } from "vitest";
import { seedProposals } from "../../gate/demo";
import { ConfirmGateHarness } from "../../gate/harness";
import { useHarnessRevision } from "../../gate/useHarness";
import type { CheckpointStatus, DecisionIntent } from "../../gate/types";
import { DecisionCard } from "./DecisionCard";

/** The minimal parent harness: intents → real teacher turns → the real gate. */
function HarnessedCard({ onConfirm }: { onConfirm?: () => void }) {
  const harness = useMemo(() => {
    const h = new ConfirmGateHarness({ courseTitle: "Lesson 3 · AI literacy" });
    seedProposals(h);
    return h;
  }, []);
  useHarnessRevision(harness);
  return (
    <DecisionCard
      rows={harness.views()}
      courseLabel={harness.courseTitle}
      checkpointStatus={harness.gate.checkpoints().objectives.status as CheckpointStatus}
      onDispatch={(intent: DecisionIntent) => {
        harness.dispatch(intent);
      }}
      onConfirm={onConfirm}
    />
  );
}

function rowFor(statement: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: statement });
  return heading.closest("li") as HTMLElement;
}

/** A DecisionCard bound to an externally-owned harness, re-rendering on gate state. */
function BoundCard({ harness }: { harness: ConfirmGateHarness }) {
  useHarnessRevision(harness);
  return (
    <DecisionCard rows={harness.views()} onDispatch={(intent) => harness.dispatch(intent)} />
  );
}

describe("DecisionCard, bound to a real ConfirmGate", () => {
  it("renders proposals with quiet provenance lines and pre-confirms nothing", () => {
    render(<HarnessedCard />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);

    // Quiet provenance, line 1 in the teacher's words (source · suggested match).
    expect(screen.getByText("from your slides p.4")).toBeInTheDocument();
    expect(screen.getAllByText("suggested match").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        (_content, el) =>
          el?.tagName === "P" &&
          (el.textContent ?? "").replace(/\s+/g, " ").trim() ===
            "from your slides p.4 · suggested match",
      ),
    ).toBeInTheDocument();

    // The machine key (Marble id) is demoted to its OWN paragraph — raw key only,
    // no prose wrapper duplicating line 1 — out of the reading path.
    const alignmentKey = screen.getByText("mt_K6qtan847r");
    expect(alignmentKey.tagName).toBe("P");
    expect(alignmentKey.textContent).toBe("mt_K6qtan847r");

    // Honest resting state: nothing decided yet, all rows awaiting.
    expect(screen.getByText("Nothing decided yet — 0 of 3.")).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting your decision")).toHaveLength(3);
  });

  it("accept dispatches a real accept decision into the gate", async () => {
    const user = userEvent.setup();
    render(<HarnessedCard />);

    const row = rowFor("Students can explain what an algorithm is, in their own words, with an example from everyday life.");
    await user.click(within(row).getByRole("button", { name: /^accept objective/i }));

    expect(within(row).getByText("Accepted")).toBeInTheDocument();
    // Non-color state: the label text carries the state.
    expect(within(row).queryByText("Awaiting your decision")).not.toBeInTheDocument();
  });

  it("rename is one keystroke away, commits with Enter, and keeps the id stable", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    const [proposal] = harness.propose([{ statement: "Students can model one fraction." }]);
    render(<BoundCard harness={harness} />);

    // One keystroke: Enter on the row's rename action opens the editor.
    const row = rowFor("Students can model one fraction.");
    const rename = within(row).getByRole("button", { name: /^rename objective/i });
    rename.focus();
    await user.keyboard("{Enter}");

    const editor = within(row).getByRole("textbox");
    expect(editor).toHaveFocus();
    await user.clear(editor);
    await user.type(editor, "Learners draw one fraction and explain it.{Enter}");

    expect(harness.gate.decisions()[0].verb).toBe("rename");
    const objective = harness.gate.getObjective(proposal.id);
    expect(objective?.id).toBe(proposal.id); // id stable — wording is versioned content
    expect(objective?.statement).toBe("Learners draw one fraction and explain it.");
    expect(harness.gate.getProposal(proposal.id)?.statement).toBe("Students can model one fraction.");
    expect(screen.getByText(/as proposed: “Students can model one fraction.”/)).toBeInTheDocument();
  });

  it("Esc cancels an inline rename without dispatching anything", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Students can model one fraction." }]);
    render(<BoundCard harness={harness} />);

    const row = rowFor("Students can model one fraction.");
    const rename = within(row).getByRole("button", { name: /^rename objective/i });
    rename.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("changed wording{Escape}");

    expect(harness.gate.decisions()).toHaveLength(0);
    expect(screen.getByText("Students can model one fraction.")).toBeInTheDocument();
    // focus returns to the rename action (re-rendered node — re-query it)
    expect(
      within(row).getByRole("button", { name: /^rename objective/i }),
    ).toHaveFocus();
  });

  it("drop is never one tap: it asks first, quoting the statement, defaulting to Keep it", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    const [proposal] = harness.propose([{ statement: "Students can model one fraction." }]);
    render(<BoundCard harness={harness} />);

    await user.click(
      within(rowFor("Students can model one fraction.")).getByRole("button", {
        name: /^drop objective/i,
      }),
    );

    // The terminal verb waits for an explicit choice: nothing dispatched yet.
    expect(harness.gate.decisions()).toHaveLength(0);
    const confirm = screen.getByRole("group", { name: /confirm dropping objective 1/i });
    expect(
      within(confirm).getByText(/removed from this plan and cannot be restored/i),
    ).toBeInTheDocument();
    // The statement is NOT re-quoted inside the dialog — it sits directly above
    // it — but assistive tech still gets it from the destructive button's label.
    expect(
      within(confirm).getByRole("button", {
        name: /^drop objective 1 for good: “Students can model one fraction.”/i,
      }),
    ).toBeInTheDocument();
    // The safe choice holds focus by default.
    expect(within(confirm).getByRole("button", { name: "Keep it" })).toHaveFocus();

    // Keep it: nothing happens.
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(harness.gate.decisions()).toHaveLength(0);
    expect(harness.gate.getProposal(proposal.id)).not.toBeNull();

    // Now go through with it.
    await user.click(
      within(rowFor("Students can model one fraction.")).getByRole("button", {
        name: /^drop objective/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /^drop objective 1 for good/i }));

    expect(harness.gate.decisions()[0].verb).toBe("drop");
    expect(harness.gate.confirmedObjectives()).toHaveLength(0);
    expect(screen.getByText("Dropped")).toBeInTheDocument();
    expect(
      screen.getByText(/Dropped objectives cannot be revived/),
    ).toBeInTheDocument();
  });

  it("add authors a new LOCAL objective that the gate confirms as the teacher's", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Students can model one fraction." }]);
    render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /add a new local objective/i }));
    const editor = screen.getByRole("textbox", { name: /new objective, written by you/i });
    await user.type(editor, "Students can ask one honest question.{Enter}");

    const confirmed = harness.gate.confirmedObjectives();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].kind).toBe("local");
    expect(confirmed[0].proposedBy).toBe("teacher");
    expect(screen.getByText("Added by you")).toBeInTheDocument();
  });

  it("the CONFIRM bar mirrors the gate's objectives auto-confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<HarnessedCard onConfirm={onConfirm} />);

    const confirm = screen.getByRole("button", { name: /confirm .*objectives/i });
    // Not-yet state is reachable (aria-disabled, not hidden `disabled`) and honest.
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAccessibleName(/3 decisions left/);
    expect(screen.getByText("Every proposal needs a decision first.")).toBeInTheDocument();

    const statements = [
      "Students can explain what an algorithm is, in their own words, with an example from everyday life.",
      "Students can spot the claim in an AI-generated answer and say what evidence would support it.",
      "Students can list three facts about machine learning.",
    ];
    await user.click(
      within(rowFor(statements[0])).getByRole("button", { name: /^accept objective/i }),
    );
    expect(confirm).toHaveAttribute("aria-disabled", "true");

    // Rename proposal 2 through the real gate.
    const row2 = rowFor(statements[1]);
    await user.click(within(row2).getByRole("button", { name: /^rename objective/i }));
    await user.clear(within(row2).getByRole("textbox"));
    await user.type(
      within(row2).getByRole("textbox"),
      "Learners can find the claim in an AI answer and name the evidence.{Enter}",
    );
    // Drop proposal 3 (through its confirm step).
    await user.click(
      within(rowFor(statements[2])).getByRole("button", { name: /^drop objective/i }),
    );
    await user.click(screen.getByRole("button", { name: /^drop objective 3 for good/i }));

    expect(confirm).toHaveAttribute("aria-disabled", "false");
    expect(confirm).toHaveAccessibleName(/build the plan/);
    expect(
      screen.getByText(/All 3 proposals decided — every objective carries your decision\. Objectives checkpoint confirmed \(3 of 5\)\./),
    ).toBeInTheDocument();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("uses the singular objective label when one proposal is decided", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /^accept objective/i }));

    expect(
      screen.getByRole("button", { name: "Confirm 1 objective · build the plan" }),
    ).toBeInTheDocument();
  });

  it("says 'All 1 proposal decided', never 'All 1 proposals', in the bar and the live region", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    const { container } = render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /^accept objective/i }));

    // The milestone text is the same string family as the one the product owner reported.
    expect(screen.getAllByText(/All 1 proposal decided — every objective carries your decision\./).length).toBeGreaterThan(0);
    expect(screen.queryByText(/All 1 proposals/)).not.toBeInTheDocument();
    // …and the single live region announces the same singular wording.
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toMatch(
      /All 1 proposal decided — every objective carries your decision\./,
    );
  });

  it("tab order: accept → rename → drop per row, then Add, then Confirm", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([
      { statement: "Alpha objective." },
      { statement: "Beta objective." },
    ]);
    render(<BoundCard harness={harness} />);

    const order: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      await user.tab();
      order.push(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "");
    }
    expect(order).toEqual([
      "Accept objective: “Alpha objective.”",
      "Rename objective: “Alpha objective.”",
      "Drop objective: “Alpha objective.”",
      "Accept objective: “Beta objective.”",
      "Rename objective: “Beta objective.”",
      "Drop objective: “Beta objective.”",
      "Add a new local objective, written by you",
    ]);

    // The CONFIRM action is REACHABLE while disarmed (aria-disabled, not hidden
    // `disabled`): a keyboard/SR teacher can land on it and hear why it waits.
    const confirm = screen.getByRole("button", { name: /confirm .*objectives/i });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(confirm).toHaveAttribute("aria-disabled", "true"); // still not armed

    // Once every proposal is decided, Confirm arms and its label says so.
    await user.click(screen.getAllByRole("button", { name: /^accept objective/i })[0]);
    await user.click(screen.getAllByRole("button", { name: /^accept objective/i })[0]);
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    confirm.focus();
    expect(confirm).toHaveFocus();
  });

  it("every verb button is keyboard-operable (Enter) with a visible focus style hook", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    render(<BoundCard harness={harness} />);

    const accept = screen.getByRole("button", { name: /^accept objective/i });
    accept.focus();
    expect(accept).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(harness.gate.decisions()[0].verb).toBe("accept");
  });
});

/* ------------------------- safety behaviors (A1) -------------------------- */
/* Each test pins one fix from the design review: a rushed teacher's decision
 * must never be one tap into an irreversible state, must never strand focus,
 * and must always be explicable to assistive tech. */

describe("DecisionCard safety behaviors (design review A1)", () => {
  it("never strands keyboard focus after a decision", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    render(<BoundCard harness={harness} />);

    const accept = screen.getByRole("button", { name: /^accept objective/i });
    accept.focus();
    await user.keyboard("{Enter}");

    // The verb unmounts; focus must land on the row's action group, not <body>.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Decisions for objective 1");
  });

  it("keeps focus on the row's actions after a confirmed drop", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /^drop objective/i }));
    await user.click(screen.getByRole("button", { name: /^drop objective 1 for good/i }));

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Decisions for objective 1");
  });

  it("a decided row offers Revoke (not Drop), and revoking asks first", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /^accept objective/i }));
    expect(harness.gate.confirmedObjectives()).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: /revoke your decision on objective 1/i }),
    );
    expect(harness.gate.decisions()).toHaveLength(1); // nothing dispatched by the first click
    expect(screen.getByText(/Revoke this decision\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^revoke objective 1 for good/i }));
    expect(harness.gate.decisions().map((d) => d.verb)).toEqual(["accept", "drop"]);
    expect(harness.gate.confirmedObjectives()).toHaveLength(0);
    expect(screen.getByText("Dropped")).toBeInTheDocument();
  });

  it("the disarmed CONFIRM button stays focusable, explains itself, and does not confirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<HarnessedCard onConfirm={onConfirm} />);

    const confirm = screen.getByRole("button", { name: /confirm .*objectives/i });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("aria-describedby", "confirm-hint");
    confirm.focus();
    expect(confirm).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("uses exactly one polite live region for decisions", () => {
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    const { container } = render(<BoundCard harness={harness} />);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it("announces a decision through the single live region", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    const { container } = render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /^accept objective/i }));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toMatch(
      /Objective 1: accepted\./,
    );
  });

  it("the three verbs carry their visual-differentiation hooks", () => {
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    render(<BoundCard harness={harness} />);

    // ACCEPT is the one filled (accent) control; RENAME is a ghost; DROP/REVOKE
    // is text-only and set apart — the CSS hangs off these hooks.
    expect(screen.getByRole("button", { name: /^accept objective/i })).toHaveAttribute(
      "data-verb",
      "accept",
    );
    expect(screen.getByRole("button", { name: /^rename objective/i })).toHaveAttribute(
      "data-verb",
      "rename",
    );
    expect(screen.getByRole("button", { name: /^drop objective/i })).toHaveAttribute(
      "data-verb",
      "drop",
    );
  });

  it("keeps the source visible while the teacher is rewording", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([
      { statement: "Students can model one fraction.", source: "from your slides p.4" },
    ]);
    render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /^rename objective/i }));

    // The statement gives way to the editor — but the provenance stays: it is
    // part of what the teacher is judging while they reword.
    expect(
      screen.queryByRole("heading", { name: "Students can model one fraction." }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("from your slides p.4")).toBeInTheDocument();
  });

  it("announces the reason when the disarmed CONFIRM action is activated", async () => {
    const user = userEvent.setup();
    render(<HarnessedCard />);

    const confirm = screen.getByRole("button", { name: /confirm .*objectives/i });
    confirm.focus();
    await user.keyboard("{Enter}");

    // A disarmed activation is never silent for assistive tech.
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toMatch(
      /needs a decision first/i,
    );
  });

  it("returns focus to the Add objective action when its editor is cancelled", async () => {
    const user = userEvent.setup();
    const harness = new ConfirmGateHarness();
    harness.propose([{ statement: "Alpha objective." }]);
    render(<BoundCard harness={harness} />);

    await user.click(screen.getByRole("button", { name: /add a new local objective/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.getByRole("button", { name: /add a new local objective/i })).toHaveFocus();
  });
});
