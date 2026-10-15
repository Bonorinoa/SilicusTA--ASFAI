/**
 * RevisionPanel.test.tsx — revising a published course says only what the host's record says.
 * Opening the panel writes nothing; "drafting version N+1" appears only when the record differs
 * from the sealed version; students are told they keep reading the sealed one.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RevisionView } from "../gate/transport";
import { RevisionPanel } from "./RevisionPanel";

const UNCHANGED: RevisionView = {
  sealedVersion: 1, nextVersion: 2, drafting: false,
  changes: { objectivesAdded: [], objectivesRemoved: [], plan: "same", planStatus: "confirmed" }, notInPlan: [],
};
const DRAFTING: RevisionView = {
  sealedVersion: 1, nextVersion: 2, drafting: true,
  changes: {
    objectivesAdded: [{ id: "c", statement: "Students can debug a short program." }],
    objectivesRemoved: [{ id: "b", statement: "Students can sort a list by hand." }],
    plan: "unconfirmed", planStatus: "invalidated",
  },
  notInPlan: [{ id: "c", statement: "Students can debug a short program." }],
};

function setup(revision: RevisionView, { worker = true, onDraftPlan = vi.fn() } = {}) {
  render(<RevisionPanel revision={revision} workerConfigured={worker} busy={false} onDraftPlan={onDraftPlan} />);
  return { onDraftPlan };
}

describe("RevisionPanel", () => {
  it("renders nothing until a version is sealed", () => {
    const { container } = render(
      <RevisionPanel revision={{ sealedVersion: null, nextVersion: 1, drafting: false, changes: null, notInPlan: [] }} workerConfigured busy={false} onDraftPlan={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says plainly that the published version is unchanged, and that students keep reading it", () => {
    setup(UNCHANGED);
    expect(screen.getByRole("status")).toHaveTextContent("Version 1 is published and unchanged.");
    expect(screen.getByRole("status")).not.toHaveTextContent(/drafting/);
    expect(screen.getByText(/read version 1, and keep reading it until you publish version 2/)).toBeInTheDocument();
    expect(screen.getByText(/A draft is never what students see/)).toBeInTheDocument();
    expect(screen.getByText("Opens the revision tools. Nothing changes until you act.")).toBeInTheDocument();
    expect(screen.queryByText(/Revising: what has changed/)).not.toBeInTheDocument();
  });

  it("opens the tools on request, changes nothing in the status, and gives focus a real home both ways", async () => {
    const user = userEvent.setup();
    const { onDraftPlan } = setup(UNCHANGED);
    await user.click(screen.getByRole("button", { name: "Revise this course" }));
    const heading = screen.getByRole("heading", { name: /Revising: what has changed since version 1/ });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/Nothing yet\. Version 1 is still the latest/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Version 1 is published and unchanged.");
    expect(screen.getByRole("status")).not.toHaveTextContent(/drafting/);
    expect(screen.queryByRole("button", { name: /Draft a new lesson plan/ })).not.toBeInTheDocument();
    expect(onDraftPlan).not.toHaveBeenCalled();
    // Be honest about the gap rather than hide it.
    expect(screen.getByText(/cannot be edited in place yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close the revision tools" }));
    expect(screen.getByRole("button", { name: "Revise this course" })).toHaveFocus();
  });

  it("when the record differs it says you are drafting the next version, opens itself, and lists what changed", () => {
    setup(DRAFTING);
    expect(screen.getByRole("status")).toHaveTextContent("Version 1 is published and unchanged; you are drafting version 2.");
    const changes = screen.getByRole("list", { name: "Changes since version 1" });
    expect(within(changes).getByText("Added: “Students can debug a short program.”")).toBeInTheDocument();
    expect(within(changes).getByText("Revoked: “Students can sort a list by hand.”")).toBeInTheDocument();
    expect(within(changes).getByText(/The lesson plan is invalid: it cites an objective you revoked/)).toBeInTheDocument();
    expect(within(changes).getByText("Not in the lesson plan yet: “Students can debug a short program.”")).toBeInTheDocument();
  });

  it("a teacher can close an auto-opened panel, and it stays closed", async () => {
    const user = userEvent.setup();
    setup(DRAFTING);
    await user.click(screen.getByRole("button", { name: "Close the revision tools" }));
    expect(screen.getByRole("button", { name: "Revise this course" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/you are drafting version 2/);
  });

  it("offers a new plan from the confirmed objectives when one is needed, and the AI only drafts", async () => {
    const user = userEvent.setup();
    const { onDraftPlan } = setup(DRAFTING);
    await user.click(screen.getByRole("button", { name: "Draft a new lesson plan from your confirmed objectives" }));
    expect(onDraftPlan).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/you still read and confirm the plan yourself/)).toBeInTheDocument();
  });

  it("with no drafting worker it offers no draft button and says what that means", () => {
    setup(DRAFTING, { worker: false });
    expect(screen.queryByRole("button", { name: /Draft a new lesson plan/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No drafting worker is configured on this host/)).toHaveTextContent(/version 2 cannot be published/);
  });

  it("an added objective with a still-valid plan says it is not in the plan, and publishing is not called blocked", () => {
    const added: RevisionView = {
      sealedVersion: 2, nextVersion: 3, drafting: true,
      changes: { objectivesAdded: [{ id: "c", statement: "Students can debug." }], objectivesRemoved: [], plan: "same", planStatus: "confirmed" },
      notInPlan: [{ id: "c", statement: "Students can debug." }],
    };
    setup(added, { worker: false });
    expect(screen.getByRole("status")).toHaveTextContent("Version 2 is published and unchanged; you are drafting version 3.");
    expect(screen.getByText(/Not in the lesson plan yet: “Students can debug\.”/)).toBeInTheDocument();
    expect(screen.getByText(/No drafting worker is configured/)).not.toHaveTextContent(/cannot be published/);
    expect(screen.getByRole("button", { name: "Close the revision tools" })).toBeInTheDocument();
  });
});
