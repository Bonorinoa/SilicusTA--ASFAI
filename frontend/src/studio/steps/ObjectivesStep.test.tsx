/**
 * ObjectivesStep.test.tsx — lane D (R3 UI, R4 UI): writing your own is always there while the objectives are
 * open, before any proposal too; "Propose from my sources" sits next to it; an explicit course ends on the
 * teacher's own "Confirm objectives", held while a proposal waits. The host still decides every one of these.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HostView } from "../../gate/transport";
import type { ObjectivesMode, ProposalView } from "../../gate/types";
import type { HeldFile } from "../../materials/session";
import type { StepProps } from "../CourseStudio";
import { ObjectivesStep } from "./ObjectivesStep";
import { objectivesOffer } from "./objectivesOffer";

const ID = "urn:uuid:11111111-2222-3333-4444-555555555555";
const NOTES: HeldFile = { name: "Leaf notes", kind: "text", text: "Leaves catch light.", chars: 19 };

let n = 0;
const row = (status: ProposalView["status"], source: string | null, by: ProposalView["by"] = "ai"): ProposalView => ({
  id: `urn:uuid:00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`, kind: "local", status, statement: `Objective ${n}`,
  originalStatement: null, source, alignment: null, by,
});

function view(proposals: ProposalView[], mode: ObjectivesMode = "explicit", answers: Record<string, string> = {}, objectives: "pending" | "confirmed" = "pending"): HostView {
  return {
    courseId: ID, objectivesMode: mode, proposals, objectives: [], versions: [], plan: null,
    course: { courseId: ID, owner: "Ada", title: "How plants eat", description: "", materials: [], createdAt: 1 },
    checkpoints: { objectives: { id: "objectives", status: objectives, provenance: null, note: null } },
    intake: { answers },
  } as unknown as HostView;
}

function makeC(sources: HeldFile[] = [], busy = false) {
  return {
    view: null, missing: false, busy, notice: null, problem: null, setNotice: vi.fn(), waiting: null, sources, setSources: vi.fn(), reload: vi.fn(),
    actions: { proposeFromAnswers: vi.fn(), proposeFromSources: vi.fn(), suggestMore: vi.fn(), decide: vi.fn(), confirmObjectives: vi.fn() },
  } as unknown as StepProps["c"];
}

const renderStep = (v: HostView, c = makeC(), links: string[] = []) =>
  render(<ObjectivesStep c={c} view={v} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={links} />);

describe("R3 UI: writing your own objective is always available while they are open", () => {
  it("shows the add form before any proposal, with no sources and no answers", async () => {
    const c = makeC();
    renderStep(view([]), c);
    const input = screen.getByLabelText("Write your own");
    await userEvent.type(input, "Students can explain why leaves are green.");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(c.actions.decide).toHaveBeenCalledWith({ verb: "add", statement: "Students can explain why leaves are green." });
  });

  it("an auto course shows it before any proposal too", () => {
    renderStep(view([], "auto"));
    expect(screen.getByLabelText("Write your own")).toBeInTheDocument();
  });

  it("offers 'Propose from my sources' next to it when the tab holds a source, and says it matches your style", () => {
    const c = makeC([NOTES]);
    renderStep(view([row("added", "your own objective", "teacher")]), c);
    expect(screen.getByLabelText("Add one of your own")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Propose from my sources" });
    expect(btn).toBeEnabled();
    expect(screen.getByText(/matches the style of the 1 objective you already have/)).toBeInTheDocument();
  });

  it("keeps 'Use my answers' when the brief has outcomes", () => {
    renderStep(view([], "explicit", { learning_outcomes: "Explain photosynthesis" }));
    expect(screen.getByRole("button", { name: "Use my answers" })).toBeEnabled();
  });

  it("hides the add form once the objectives are confirmed", () => {
    renderStep(view([row("accepted", "from your answer")], "explicit", {}, "confirmed"));
    expect(screen.queryByLabelText(/one of your own|Write your own/)).toBeNull();
  });
});

describe("R4 UI: an explicit course ends on the teacher's own confirm", () => {
  it("is the one primary, disabled while a proposal waits", () => {
    renderStep(view([row("accepted", "from material: Leaf notes"), row("proposed", "from material: Leaf notes")]), makeC([NOTES]));
    const confirm = screen.getByRole("button", { name: "Confirm objectives" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("data-primary", "true");
    expect(document.querySelectorAll('button[data-primary="true"]').length).toBe(1);
    expect(screen.getByText("1 proposal waiting.")).toBeInTheDocument();
  });

  it("is disabled with nothing decided", () => {
    renderStep(view([]));
    expect(screen.getByRole("button", { name: "Confirm objectives" })).toBeDisabled();
  });

  it("is enabled when at least one is decided and none waits, and sends the confirm intent", async () => {
    const c = makeC();
    renderStep(view([row("added", "your own objective", "teacher"), row("dropped", "from material: Leaf notes")]), c);
    const confirm = screen.getByRole("button", { name: "Confirm objectives" });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(c.actions.confirmObjectives).toHaveBeenCalledTimes(1);
  });

  it("an auto course never shows it", () => {
    renderStep(view([row("accepted", "from your answer"), row("proposed", "from your answer")], "auto"));
    expect(screen.queryByRole("button", { name: "Confirm objectives" })).toBeNull();
  });
});

describe("objectivesOffer (display only; the host still refuses)", () => {
  const base = { mode: "explicit" as const, confirmed: false, sourceCount: 1, hasOutcomes: false, workerConfigured: true };
  it("explicit: a second round from sources is offered once the first is decided", () => {
    expect(objectivesOffer({ ...base, rows: [row("accepted", "from material: A")] }).sources).toEqual({ show: true, heldBy: null });
  });
  it("explicit: not offered while a model-written proposal waits", () => {
    expect(objectivesOffer({ ...base, rows: [row("proposed", "from material: A")] }).sources.show).toBe(false);
  });
  it("explicit: held, with the reason, while an answer-derived proposal waits", () => {
    expect(objectivesOffer({ ...base, rows: [row("proposed", "from your answer")] }).sources).toEqual({ show: true, heldBy: "Decide the 1 proposal waiting first." });
  });
  it("auto: one round only, as the host keeps it", () => {
    expect(objectivesOffer({ ...base, mode: "auto", rows: [row("accepted", "from material: A")] }).sources.show).toBe(false);
  });
  it("no source in the tab: not offered", () => {
    expect(objectivesOffer({ ...base, sourceCount: 0, rows: [] }).sources.show).toBe(false);
  });
});

it("the propose button is held with its reason while an answer-derived proposal waits", () => {
  renderStep(view([row("proposed", "from your answer")]), makeC([NOTES]));
  const card = screen.getByRole("heading", { name: "From your sources" }).parentElement!;
  expect(within(card).getByRole("button", { name: "Propose from my sources" })).toBeDisabled();
  expect(within(card).getByText("Decide the 1 proposal waiting first.")).toBeInTheDocument();
});
