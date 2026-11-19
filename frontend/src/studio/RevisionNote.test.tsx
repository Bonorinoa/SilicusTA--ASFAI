/** K5: the classic RevisionPanel's words, back in the studio while a published course is being revised. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RevisionView } from "../gate/transport";
import { RevisionNote, revisionLines } from "./RevisionNote";

const rev = (over: Partial<RevisionView> = {}): RevisionView => ({
  sealedVersion: 1, nextVersion: 2, drafting: true,
  changes: { objectivesAdded: [{ id: "o3", statement: "Give an example of a bias." }], objectivesRemoved: [], objectivesReworded: [], plan: "invalidated", planStatus: "invalidated" },
  notInPlan: [{ id: "o3", statement: "Give an example of a bias." }],
  ...over,
} as RevisionView);

describe("RevisionNote (K5)", () => {
  it("says the sealed version is unchanged, what students read, and what changed", () => {
    render(<RevisionNote revision={rev()} workerConfigured busy={false} onDraftPlan={() => {}} />);
    expect(screen.getByRole("heading", { name: "Version 1 is published and unchanged; you are drafting version 2." })).toBeInTheDocument();
    expect(screen.getByText(/keep reading it until you publish version 2/)).toBeInTheDocument();
    expect(screen.getByText("Not in the lesson plan yet: “Give an example of a bias.”")).toBeInTheDocument();
    expect(screen.getByText("The lesson plan is invalid: it cites an objective you revoked.")).toBeInTheDocument();
  });

  it("offers one way to draft a new plan when one is needed", () => {
    const draft = vi.fn();
    render(<RevisionNote revision={rev()} workerConfigured busy={false} onDraftPlan={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "Draft a new lesson plan from your confirmed objectives" }));
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it("claims no draft when the record does not differ from the sealed version", () => {
    const { container } = render(<RevisionNote revision={rev({ drafting: false })} workerConfigured busy={false} onDraftPlan={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("adds no role=status region (the studio keeps one status line)", () => {
    const { container } = render(<RevisionNote revision={rev()} workerConfigured busy={false} onDraftPlan={() => {}} />);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it("lists rewords as before and after", () => {
    const lines = revisionLines(rev({ changes: { objectivesAdded: [], objectivesRemoved: [], objectivesReworded: [{ id: "o1", before: "A", after: "B" }], plan: "same", planStatus: "confirmed" } as RevisionView["changes"], notInPlan: [] }));
    expect(lines).toEqual(["Reworded: “A” became “B”"]);
  });
});
