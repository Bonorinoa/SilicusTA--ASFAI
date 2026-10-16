/**
 * BriefCard — the Brief stage never offers a confirm with nothing on screen (owner, 2026-10-16: "the outline stage
 * had nothing to confirm"). Each test pins one rule of the glossary's Brief.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BriefCard, hasOutcome } from "./BriefCard";

const ALL = ["topic", "course", "learning_outcomes"];
const full = { topic: "Unit fractions", course: "Grade 3 math", learning_outcomes: ["Name a unit fraction.", "Order unit fractions."] };
const props = (o: Partial<Parameters<typeof BriefCard>[0]> = {}) => ({ answers: full, editable: ALL, source: null, busy: false, onEdit: vi.fn(), onConfirm: vi.fn(), ...o });

describe("BriefCard", () => {
  it("shows the teacher's three answers as the thing confirmed, with one enabled primary", () => {
    const { container } = render(<BriefCard {...props()} />);
    expect(screen.getByText("Unit fractions")).toBeInTheDocument();
    expect(screen.getByText("Grade 3 math")).toBeInTheDocument();
    expect(screen.getByText(/Name a unit fraction\./)).toBeInTheDocument();
    const primaries = container.querySelectorAll('[data-primary="true"]');
    expect(primaries).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm the brief" })).toBeEnabled();
  });

  it("with no outcome on record the primary is disabled and a plain reason sits beside it", async () => {
    const onConfirm = vi.fn();
    render(<BriefCard {...props({ answers: { topic: "Unit fractions", course: "Grade 3 math" }, onConfirm })} />);
    const button = screen.getByRole("button", { name: "Confirm the brief" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Nothing to confirm yet: no outcome is on record/)).toBeInTheDocument();
    await userEvent.setup().click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("an empty record says so on screen: the confirm is disabled and every row is marked", () => {
    render(<BriefCard {...props({ answers: {} })} />);
    expect(screen.getByRole("button", { name: "Confirm the brief" })).toBeDisabled();
    expect(screen.getByText("Nothing on record")).toBeInTheDocument();
    expect(screen.getAllByText("Not answered")).toHaveLength(2);
  });

  it("asking for the outcomes to be proposed from materials is an outcome on record, and says so", () => {
    expect(hasOutcome({ outcomes_from: "materials" })).toBe(true);
    render(<BriefCard {...props({ answers: { topic: "T", course: "C", outcomes_from: "materials" } })} />);
    expect(screen.getByText("You asked Silicus to propose them from your materials.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm the brief" })).toBeEnabled();
  });

  it("Edit re-answers one question: it sends that id and the teacher's words, one outcome per line", async () => {
    const onEdit = vi.fn();
    render(<BriefCard {...props({ onEdit })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit: Learners should be able to" }));
    const box = screen.getByRole("textbox", { name: "Learners should be able to" });
    expect(box).toHaveValue("Name a unit fraction.\nOrder unit fractions.");
    await user.clear(box);
    await user.type(box, "Compare 1/2 and 1/4.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onEdit).toHaveBeenCalledWith("learning_outcomes", "Compare 1/2 and 1/4.");
  });

  it("offers Edit only for a question the host still takes an answer to, and says why the others have none", () => {
    render(<BriefCard {...props({ editable: ["topic"] })} />);
    expect(screen.getAllByRole("button", { name: /^Edit:/ })).toHaveLength(1);
    expect(screen.getByText(/already been sent to ASFAI, so it cannot be changed from here/)).toBeInTheDocument();
  });

  it("an empty row offers Add, not Edit", () => {
    render(<BriefCard {...props({ answers: { topic: "T", course: "C" } })} />);
    expect(screen.getByRole("button", { name: "Add: Learners should be able to" })).toBeInTheDocument();
  });

  it("shows the ASFAI line as one secondary sentence when the page has one", () => {
    render(<BriefCard {...props({ source: "ASFAI has your answers." })} />);
    expect(screen.getByText("ASFAI has your answers.")).toBeInTheDocument();
  });
});
