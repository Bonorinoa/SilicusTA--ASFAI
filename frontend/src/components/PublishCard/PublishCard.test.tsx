/**
 * PublishCard.test.tsx — checkpoint-5 surface: preview the exact export,
 * preview-then-confirm the seal, and render the sealed version record.
 * Every assertion is against real props derived from gate state; the card
 * itself holds no policy (onPublish/onExport are the only channels out).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PackageVersionView, PublishStatusView } from "../../gate/types";
import { PublishCard } from "./PublishCard";

const TITLE = "Seeing the claim: how AI answers are built";

const OBJECTIVES = [
  {
    id: "urn:uuid:a1",
    kind: "local" as const,
    statement: "Students can explain what an algorithm is, in their own words.",
  },
  {
    id: "urn:uuid:a2",
    kind: "public" as const,
    statement: "Learners can find the claim in an AI answer and name what evidence would back it up.",
    publicId: "mt_Qp2Ln0aVn7",
  },
];

const ACTIVITIES = [
  {
    id: "act-1",
    title: "Warm-up: three answers, one question",
    minutes: 8,
    objectiveIds: ["urn:uuid:a1"],
    materialVersionIds: [],
    learnerDoes: "Read three short answers and mark the one that shows its sources.",
    teacherDoes: "Read the answers aloud and ask the room which they would trust.",
    evidenceIfAny: "none" as const,
  },
  {
    id: "act-2",
    title: "Spotting the claim",
    minutes: 15,
    objectiveIds: ["urn:uuid:a2"],
    materialVersionIds: [],
    learnerDoes: "Underline the claim in a short AI-written paragraph.",
    teacherDoes: "Ask two learners to justify an underline out loud.",
    evidenceIfAny: "observation" as const,
  },
];

const PLAN = {
  id: "plan-1",
  courseId: "urn:uuid:course-1",
  courseVersion: 1,
  title: TITLE,
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  status: "confirmed" as const,
  activities: ACTIVITIES,
  proposedBy: "ai" as const,
  proposedAt: 1000,
};

const ready: PublishStatusView = { canPublish: true, blockers: [] };
const blocked: PublishStatusView = {
  canPublish: false,
  blockers: [
    'checkpoint "plan" is not teacher-confirmed',
    "objective urn:uuid:x is not confirmed — unconfirmed objectives must not appear on a published lesson plan",
  ],
};

function publishedVersion(over: Partial<PackageVersionView> = {}): PackageVersionView {
  return {
    courseId: "urn:uuid:course-1",
    version: 2,
    previousVersion: 1,
    title: TITLE,
    owner: "teacher:tk-1",
    status: "published",
    objectiveRefs: OBJECTIVES.map((o) => ({ id: o.id, kind: o.kind, statement: o.statement, publicId: o.publicId })),
    lessonPlan: PLAN,
    publishedAt: new Date("2026-10-10T09:00:00Z").getTime(),
    note: null,
    provenance: {
      turnRef: "urn:turn:9",
      decidedBy: "teacher:tk-1",
      channel: "silicus-ui",
      decidedAt: new Date("2026-10-10T09:00:00Z").getTime(),
    },
    ...over,
  };
}

function baseProps(over: Partial<Parameters<typeof PublishCard>[0]> = {}) {
  return {
    courseLabel: "Lesson 3 · How AI answers are built",
    courseId: "urn:uuid:course-1",
    title: TITLE,
    status: ready,
    objectives: OBJECTIVES,
    activities: ACTIVITIES,
    totalMinutes: 23,
    plan: PLAN,
    published: null,
    onPublish: vi.fn(),
    onExport: vi.fn(),
    ...over,
  };
}

describe("PublishCard", () => {
  it("previews the exact export: the plan sheet with confirmed objectives", () => {
    render(<PublishCard {...baseProps()} />);

    expect(screen.getByRole("heading", { level: 2, name: TITLE })).toBeInTheDocument();
    // The preview embeds the PlanCard sheet itself (same page that prints).
    expect(screen.getByText("Objectives referenced")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /review & publish first version/i }),
    ).toBeInTheDocument();
  });

  it("points to the preview where it is: above the publish bar, not below", () => {
    const { container } = render(<PublishCard {...baseProps()} />);
    const hint = screen.getByText(/publishing can.t be undone/i);
    expect(hint.textContent).not.toMatch(/below/i);
    expect(hint.textContent).toMatch(/preview above/i);
    // The claim is about layout: the preview really does precede the hint in reading order.
    const preview = container.querySelector('[data-print="show"]')!;
    expect(preview.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses singular labels for a one-objective, one-activity, one-minute plan", () => {
    const [objective] = OBJECTIVES;
    const activity = { ...ACTIVITIES[0], minutes: 1 };
    render(
      <PublishCard
        {...baseProps({
          objectives: [objective],
          activities: [activity],
          totalMinutes: 1,
          plan: { ...PLAN, activities: [activity] },
        })}
      />,
    );

    expect(screen.getByText("Ready — 1 objective, 1 activity, 1 minute.")).toBeInTheDocument();
  });

  it("keeps the gate's blocker reasons reachable and never fires publish while blocked", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    render(<PublishCard {...baseProps({ status: blocked, onPublish })} />);

    expect(
      screen.getByText('checkpoint "plan" is not teacher-confirmed'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /objective urn:uuid:x is not confirmed — unconfirmed objectives must not appear on a published lesson plan/,
      ),
    ).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /review & publish/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    // The reason stays reachable: the hint is focusable-adjacent, never a hidden control.
    expect(screen.getByText(/resolve the blockers above/i)).toBeInTheDocument();

    await user.click(button);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("seals never on one tap: a confirm step quotes the version and defaults to Keep editing", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    render(<PublishCard {...baseProps({ onPublish })} />);

    await user.click(screen.getByRole("button", { name: /review & publish first version/i }));

    expect(
      screen.getByText(/2 confirmed objectives and 2 activities in “Seeing the claim/i),
    ).toBeInTheDocument();

    const keep = screen.getByRole("button", { name: /keep editing/i });
    expect(keep).toHaveFocus(); // the safe choice is focused by default
    await user.click(keep);
    expect(onPublish).not.toHaveBeenCalled();

    // Coming back to the flow re-opens the confirm; the acting control is one tap.
    await user.click(screen.getByRole("button", { name: /review & publish first version/i }));
    await user.click(screen.getByRole("button", { name: /publish version 1/i }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("renders the sealed version record with the immutable contract and export action", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<PublishCard {...baseProps({ published: publishedVersion(), onExport })} />);

    expect(screen.getByRole("heading", { name: /published — version 2/i })).toBeInTheDocument();
    expect(screen.getByText("version 1")).toBeInTheDocument(); // previous version
    expect(screen.getByText(/2 objectives · 2 activities/i)).toBeInTheDocument();
    expect(
      screen.getByText(/this version is immutable/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /review & publish/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /export the published version \(json\)/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("offers the next version when unpublished changes exist after a seal", () => {
    render(<PublishCard {...baseProps({ published: publishedVersion(), unpublishedChanges: true })} />);

    expect(
      screen.getByRole("button", { name: /review & publish version 3/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/unpublished changes are ready/i)).toBeInTheDocument();
  });

  it("keeps exactly ONE live region, for its own flashes (the course-level notice is LiveCourse's)", () => {
    render(<PublishCard {...baseProps({})} />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});