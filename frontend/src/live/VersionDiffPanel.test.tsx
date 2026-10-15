import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ActivityView, PackageVersionView } from "../gate/types";
import { VersionDiffPanel } from "./VersionDiffPanel";

const act = (over: Partial<ActivityView> = {}): ActivityView => ({
  id: "a1", title: "Spot the claim", minutes: 20, objectiveIds: ["o1"], materialVersionIds: [],
  learnerDoes: "Mark the claim.", teacherDoes: "Circulate.", evidenceIfAny: "observation", ...over,
});

const ver = (n: number, over: Partial<PackageVersionView> = {}): PackageVersionView => ({
  courseId: "urn:uuid:c", version: n, previousVersion: n > 1 ? n - 1 : null, title: "AI literacy", owner: "Ada", status: "published",
  objectiveRefs: [
    { id: "o1", kind: "local", statement: "Explain what an algorithm is." },
    { id: "o2", kind: "local", statement: "Spot a claim in an answer." },
  ],
  lessonPlan: {
    id: "p", courseId: "urn:uuid:c", courseVersion: n, title: "Plan", status: "confirmed", proposedBy: "ai", proposedAt: 1,
    audience: { ageRangeStart: 8, ageRangeEnd: 10 }, activities: [act()],
  },
  publishedAt: Date.UTC(2026, 9, n), note: null,
  provenance: { turnRef: "t", decidedBy: "Ada", channel: "ui", decidedAt: 1 },
  ...over,
});

const v1 = ver(1);
const v2 = ver(2, {
  note: "Reworded the first objective",
  objectiveRefs: [
    { id: "o1", kind: "local", statement: "Explain, in your own words, what an algorithm is." },
    { id: "o3", kind: "local", statement: "Give an example of a bias." },
  ],
  lessonPlan: {
    ...v1.lessonPlan!, courseVersion: 2,
    activities: [act({ minutes: 25, objectiveIds: ["o3"] }), act({ id: "a9", title: "Exit ticket" })],
  },
});

describe("VersionDiffPanel", () => {
  it("renders nothing with no versions", () => {
    const { container } = render(<VersionDiffPanel versions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says honestly that there is nothing to compare when there is one version", () => {
    render(<VersionDiffPanel versions={[v1]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing to compare yet: this is version 1.");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Unchanged")).toBeNull();
  });

  it("defaults to the latest version against the one before it, however the list is ordered", () => {
    const v3 = ver(3);
    render(<VersionDiffPanel versions={[v3, v1, v2]} />);
    expect(screen.getByLabelText("Compare version")).toHaveDisplayValue(/Version 2/);
    expect(screen.getByLabelText("With version")).toHaveDisplayValue(/Version 3 .*\(latest\)/);
    expect(screen.getByText(/Version 2 → to version 3|Version 2.*version 3/)).toBeInTheDocument();
  });

  it("labels every change in words: Added, Removed, Reworded, Changed", () => {
    render(<VersionDiffPanel versions={[v1, v2]} />);
    const objectives = screen.getByRole("list", { name: "Objectives that differ" });
    expect(within(objectives).getByText("Reworded")).toBeInTheDocument();
    expect(within(objectives).getByText("Added")).toBeInTheDocument();
    expect(within(objectives).getByText("Removed")).toBeInTheDocument();
    // reworded shows before and after
    expect(within(objectives).getByText("Explain what an algorithm is.")).toBeInTheDocument();
    expect(within(objectives).getByText("Explain, in your own words, what an algorithm is.")).toBeInTheDocument();
    expect(within(objectives).getByText(/Before \(version 1\)/)).toBeInTheDocument();
    expect(within(objectives).getByText(/After \(version 2\)/)).toBeInTheDocument();

    const activities = screen.getByRole("list", { name: "Activities that differ" });
    expect(within(activities).getByText("Changed")).toBeInTheDocument();
    expect(within(activities).getByText("Added")).toBeInTheDocument();
    expect(within(activities).getByText("20 min")).toBeInTheDocument();
    expect(within(activities).getByText("25 min")).toBeInTheDocument();
    // cited objective change shows wording, not just ids
    expect(within(activities).getByText("Give an example of a bias.")).toBeInTheDocument();
    expect(within(activities).getByText("Explain what an algorithm is.")).toBeInTheDocument();
  });

  it("shows the publish note and unchanged details as text", () => {
    render(<VersionDiffPanel versions={[v1, v2]} />);
    const details = screen.getByRole("list", { name: "Course details" });
    expect(within(details).getByText("Reworded the first objective")).toBeInTheDocument();
    expect(within(details).getByText("(no note)")).toBeInTheDocument();
    expect(within(details).getAllByText("Unchanged").length).toBeGreaterThanOrEqual(3); // title, plan title, audience
    expect(within(details).getByText("Ages 8–10")).toBeInTheDocument();
  });

  it("says when two versions are identical", () => {
    render(<VersionDiffPanel versions={[v1, ver(2)]} />);
    expect(screen.getByText(/No differences: these two versions say the same thing\./)).toBeInTheDocument();
    expect(screen.getByText("Unchanged objectives (2)")).toBeInTheDocument();
  });

  it("lets the teacher choose any two versions with labelled selects, and shows oldest first when reversed", async () => {
    const user = userEvent.setup();
    const v3 = ver(3, { title: "AI literacy, revised" });
    render(<VersionDiffPanel versions={[v1, v2, v3]} />);
    await user.selectOptions(screen.getByLabelText("Compare version"), "0");
    expect(screen.getByLabelText("Compare version")).toHaveDisplayValue(/Version 1/);
    expect(screen.getByText(/Version 1.*version 3/)).toBeInTheDocument();
    expect(screen.getByText("AI literacy, revised")).toBeInTheDocument();
    // reverse: 'compare' later than 'with'
    await user.selectOptions(screen.getByLabelText("Compare version"), "2");
    await user.selectOptions(screen.getByLabelText("With version"), "1");
    expect(screen.getByText(/shown oldest first/)).toBeInTheDocument();
    expect(screen.getByText(/Version 2.*version 3/)).toBeInTheDocument();
  });

  it("asks for two different versions when the same one is picked twice", async () => {
    const user = userEvent.setup();
    render(<VersionDiffPanel versions={[v1, v2]} />);
    await user.selectOptions(screen.getByLabelText("With version"), "0");
    expect(screen.getByRole("status")).toHaveTextContent("Pick two different versions");
  });

  it("is keyboard accessible: the selects are focusable and change with the keyboard", async () => {
    const user = userEvent.setup();
    render(<VersionDiffPanel versions={[v1, v2, ver(3)]} />);
    await user.tab();
    const first = screen.getByLabelText("Compare version");
    expect(first).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("With version")).toHaveFocus();
  });

  it("resets to the new default when a newer version is published", () => {
    const { rerender } = render(<VersionDiffPanel versions={[v1, v2]} courseId="c" />);
    rerender(<VersionDiffPanel versions={[v1, v2, ver(3)]} courseId="c" />);
    expect(screen.getByLabelText("Compare version")).toHaveDisplayValue(/Version 2/);
    expect(screen.getByLabelText("With version")).toHaveDisplayValue(/Version 3/);
  });

  it("explains a re-drafted plan instead of pairing activities by similarity", () => {
    const b = ver(2, { lessonPlan: { ...v1.lessonPlan!, activities: [act({ id: "zzz" })] } });
    render(<VersionDiffPanel versions={[v1, b]} />);
    expect(screen.getByText(/share no activity, so every activity shows as removed and added/)).toBeInTheDocument();
  });

  it("says when a version has no lesson plan", () => {
    render(<VersionDiffPanel versions={[ver(1, { lessonPlan: null }), v1]} />);
    expect(screen.getByText("Version 1 had no lesson plan.")).toBeInTheDocument();
    expect(screen.getByText("No audience stated")).toBeInTheDocument();
  });

  it("renders teacher/model words as inert text, never as HTML", () => {
    const evil = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>`;
    const a = ver(1, { title: evil, note: evil });
    const b = ver(2, {
      title: `${evil}!`, note: evil + "2",
      objectiveRefs: [{ id: "o1", kind: "local", statement: evil }],
      lessonPlan: { ...v1.lessonPlan!, title: evil, activities: [act({ title: evil, learnerDoes: evil, id: "x" })] },
    });
    const { container } = render(<VersionDiffPanel versions={[a, b]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("<img");
  });

  it("does not write or store anything", () => {
    render(<VersionDiffPanel versions={[v1, v2]} />);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("copes with an invalid publish date and a partial record", () => {
    const odd = { ...ver(2), publishedAt: Number.NaN };
    render(<VersionDiffPanel versions={[v1, odd]} />);
    expect(screen.getAllByText(/date unknown/).length).toBeGreaterThan(0);
  });
});
