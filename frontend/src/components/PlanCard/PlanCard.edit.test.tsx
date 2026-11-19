/**
 * PlanCard.edit.test.tsx — N3: everything generated is editable. Each activity and plan section has an Edit
 * button (keyboard reachable); the inline form sends only the changed fields as {path, value} intents with a
 * plain teacher message; minutes stay whole numbers; Escape cancels and focus goes back to Edit; a teacher's AI
 * status against the rule is marked on the page. Without onEdit the page is read-only, exactly as before.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildPlanScenario } from "../../gate/demo";
import type { LessonPlanView } from "../../gate/types";
import { PlanCard, overrideLine } from "./PlanCard";

const scenario = buildPlanScenario();
function plan(over: Partial<LessonPlanView> = {}): LessonPlanView {
  return {
    ...scenario.plan,
    status: "draft",
    sessions: [{ session: 1, evidence: { kind: "work-product", whatLearnerProduces: "A marked transcript." } }],
    spacedReviews: [{ afterDays: 7, form: "near-transfer", whatChanges: "a new answer", prompt: "Mark the claim." }],
    activities: scenario.plan.activities.map((a, i) => ({ ...a, phase: 1, aiStatus: "forbidden" as const, decisionAfterHelp: i === 2 ? "Keep or change it." : undefined })),
    ...over,
  } as LessonPlanView;
}
const objectives = scenario.objectives;

describe("N3: the plan is edited in place", () => {
  it("no onEdit: no Edit button anywhere (the published and look-back views stay read-only)", () => {
    render(<PlanCard plan={plan()} objectives={objectives} />);
    expect(screen.queryAllByRole("button", { name: /^Edit / })).toHaveLength(0);
  });

  it("every activity, the plan title and each later review has an Edit button", () => {
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={vi.fn()} aiEditable />);
    const names = screen.getAllByRole("button", { name: /^Edit / }).map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Edit the plan title", "Edit activity 1", "Edit activity 2", "Edit activity 3", "Edit later review 1"]);
  });

  it("Save sends only the changed field, with a plain message; the trace wording comes from the host", async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} aiEditable />);
    fireEvent.click(screen.getByRole("button", { name: "Edit activity 3" }));
    const form = screen.getByRole("form", { name: "Edit activity 3" });
    expect(document.activeElement).toBe(within(form).getByLabelText("Title"));
    fireEvent.change(within(form).getByLabelText("Then they decide"), { target: { value: "Each learner keeps one claim." } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith([{ path: "activities.2.decisionAfterHelp", value: "Each learner keeps one claim." }], "Edit activity 3: then they decide.");
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });

  it("minutes stay a whole number: anything else is stopped in the form and nothing is sent", () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit activity 1" }));
    const form = screen.getByRole("form", { name: "Edit activity 1" });
    const minutes = within(form).getByLabelText("Minutes") as HTMLInputElement;
    expect(minutes.type).toBe("number");
    fireEvent.change(minutes, { target: { value: "12.5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(within(form).getByRole("alert").textContent).toMatch(/whole number/);
    // No AI status on a course without ages.
    expect(within(form).queryByLabelText("AI status")).toBeNull();
  });

  it("a refused save keeps the form open; Escape cancels and focus returns to Edit", async () => {
    const onEdit = vi.fn().mockResolvedValue(false);
    render(<PlanCard plan={plan()} objectives={objectives} onEdit={onEdit} />);
    const edit = screen.getByRole("button", { name: "Edit the plan title" });
    fireEvent.click(edit);
    const form = screen.getByRole("form", { name: "Edit the plan title" });
    fireEvent.change(within(form).getByLabelText("Plan title"), { target: { value: "My title" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ path: "title", value: "My title" }], "Edit the plan: plan title."));
    expect(screen.getByRole("form", { name: "Edit the plan title" })).toBeTruthy();
    fireEvent.keyDown(within(form).getByLabelText("Plan title"), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Edit the plan title"));
  });

  it("a teacher override is said on the activity, in the owner's words", () => {
    const p = plan();
    const acts = p.activities.map((a, i) => i === 0 ? { ...a, aiStatus: "permitted" as const, aiStatusBy: "teacher" as const,
      teacherOverride: { aiStatus: "permitted" as const, rule: "forbidden" as const, ages: { min: 4, max: 10 } } } : a);
    render(<PlanCard plan={{ ...p, activities: acts, editedByTeacher: true }} objectives={objectives} />);
    const line = document.querySelector("[data-teacher-override]");
    expect(line?.textContent).toBe("Teacher override: AI permitted for ages 4–10 (the rule says forbidden)");
    expect(overrideLine({ aiStatus: "required", rule: "permitted" })).toBe("Teacher override: AI required (the rule says permitted)");
    expect(screen.getByText("Draft · edited by you")).toBeTruthy();
  });

  it("an invalidated plan offers no Edit (a new draft is the way forward)", () => {
    render(<PlanCard plan={plan({ status: "invalidated" })} objectives={objectives} onEdit={vi.fn()} />);
    expect(screen.queryAllByRole("button", { name: /^Edit / })).toHaveLength(0);
  });
});
