/**
 * PlanCard.shape.test.tsx — N5 (C5): the rest of "editable" on the page. A later review's timing and form; the
 * objectives an activity cites (checkboxes over the confirmed objectives only); move up / move down / remove (two
 * clicks) / add an activity. Each sends {path, value} intents only; the host bounds, records and re-runs K2.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildPlanScenario } from "../../gate/demo";
import type { LessonPlanView } from "../../gate/types";
import { PlanCard } from "./PlanCard";

const scenario = buildPlanScenario();
const plan = (): LessonPlanView => ({
  ...scenario.plan,
  status: "draft",
  spacedReviews: [{ afterDays: 7, form: "near-transfer", whatChanges: "a new answer", prompt: "Mark the claim." }],
} as LessonPlanView);
const objectives = scenario.objectives;

describe("N5 C5: the rest of the plan is editable", () => {
  it("a later review's timing and form", async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit later review 1" }));
    const form = screen.getByRole("form", { name: "Edit later review 1" });
    fireEvent.change(within(form).getByLabelText("After (days)"), { target: { value: "14" } });
    fireEvent.change(within(form).getByLabelText("Form"), { target: { value: "far-transfer" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][0]).toEqual([{ path: "spacedReviews.0.afterDays", value: 14 }, { path: "spacedReviews.0.form", value: "far-transfer" }]);
  });

  it("an activity cites objectives chosen from the confirmed ones only", async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit activity 1" }));
    const form = screen.getByRole("form", { name: "Edit activity 1" });
    const group = within(form).getByRole("group", { name: "Cites" });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes).toHaveLength(objectives.length);
    const first = scenario.plan.activities[0].objectiveIds;
    const other = objectives.findIndex((o) => !first.includes(o.id));
    fireEvent.click(boxes[other]);
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][0]).toEqual([{ path: "activities.0.objectiveIds", value: [...first, objectives[other].id] }]);
  });

  it("move up / move down send moveTo; the ends are disabled", async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} />);
    const n = scenario.plan.activities.length;
    expect(screen.getByRole("button", { name: "Move activity 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Move activity ${n} down` })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move activity 2 up" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]).toEqual([[{ path: "activities.1.moveTo", value: 0 }], "Move activity 2 up."]);
  });

  it("remove asks once more before it sends", async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove activity 2" }));
    expect(onEdit).not.toHaveBeenCalled();
    const row = document.querySelector('[data-plan-shape="2"]') as HTMLElement;
    expect(row.textContent).toContain("Remove activity 2?");
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]).toEqual([[{ path: "activities.1.remove", value: true }], "Remove activity 2."]);
  });

  it("add an activity sends one activities.add with the whole new activity", async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Add an activity" }));
    const form = screen.getByRole("form", { name: "Edit a new activity" });
    fireEvent.click(within(form).getByRole("button", { name: "Add activity" }));
    expect(onEdit).not.toHaveBeenCalled(); // the title is required
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Share out" } });
    fireEvent.change(within(form).getByLabelText("Learners"), { target: { value: "Each pair shows one claim." } });
    fireEvent.change(within(form).getByLabelText("Teacher"), { target: { value: "Asks what changed." } });
    fireEvent.click(within(form).getByRole("button", { name: "Add activity" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][0]).toEqual([{ path: "activities.add", value: {
      title: "Share out", minutes: 10, learnerDoes: "Each pair shows one claim.", teacherDoes: "Asks what changed.", evidenceIfAny: "none", objectiveIds: [objectives[0].id],
    } }]);
  });

  it("read-only without onEdit: no shape controls, no add", () => {
    render(<PlanCard plan={plan()} objectives={objectives} />);
    expect(screen.queryByRole("button", { name: /Move activity|Remove activity|Add an activity/ })).toBeNull();
  });
});
