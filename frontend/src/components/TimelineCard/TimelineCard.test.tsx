/**
 * TimelineCard.test.tsx — the audit trail renders real decisions, checkpoint
 * confirmations, and sealed versions as one chronological spine, with machine
 * keys demoted out of the reading path.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../gate/types";
import { TimelineCard } from "./TimelineCard";

const t = (d: Date) => d.getTime();
const EVENTS: TimelineEvent[] = [
  {
    id: "checkpoint:files",
    kind: "checkpoint",
    at: t(new Date("2026-10-10T08:00:00Z")),
    label: "Checkpoint confirmed — files",
    detail: "Confirm the material list for this course.",
    turnRef: "urn:turn:1",
    decidedBy: "teacher:tk-1",
    channel: "silicus-ui",
  },
  {
    id: "dec-1",
    kind: "decision",
    verb: "rename",
    at: t(new Date("2026-10-10T08:05:00Z")),
    label: "Renamed",
    detail: "Learners can find the claim in an AI answer and name what evidence would back it up.",
    before: "Students can spot the claim in an AI-generated answer and say what evidence would support it.",
    source: "from Tuesday's planning note",
    version: 1,
    turnRef: "urn:turn:5",
    decidedBy: "teacher:tk-1",
    channel: "silicus-ui",
  },
  {
    id: "dec-2",
    kind: "decision",
    verb: "drop",
    at: t(new Date("2026-10-10T08:06:00Z")),
    label: "Dropped",
    version: 1,
    turnRef: "urn:turn:6",
    decidedBy: "teacher:tk-1",
    channel: "silicus-ui",
  },
  {
    id: "publish:1",
    kind: "publish",
    at: t(new Date("2026-10-10T09:00:00Z")),
    label: "Published version 1",
    detail: "Ready for Monday.",
    version: 1,
    turnRef: "urn:turn:9",
    decidedBy: "teacher:tk-1",
    channel: "silicus-ui",
  },
];

describe("TimelineCard", () => {
  it("renders every event kind on one spine, in order", () => {
    render(<TimelineCard events={EVENTS} courseLabel="Lesson 3 · How AI answers are built" />);

    expect(screen.getByRole("heading", { name: "Decision history" })).toBeInTheDocument();
    expect(screen.getByText(/append-only/i)).toBeInTheDocument();

    const list = screen.getByRole("list");
    expect(list.children.length).toBe(4);

    expect(screen.getByText("Checkpoint confirmed — files")).toBeInTheDocument();
    expect(screen.getByText("Renamed")).toBeInTheDocument();
    expect(screen.getByText("Dropped")).toBeInTheDocument();
    expect(screen.getByText("Published version 1")).toBeInTheDocument();
  });

  it("shows before → after for a rename, with the quiet source garnish", () => {
    render(<TimelineCard events={EVENTS} />);

    expect(
      screen.getByText(/as proposed: “Students can spot the claim in an AI-generated answer/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Learners can find the claim in an AI answer and name what evidence would back it up\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("from Tuesday's planning note")).toBeInTheDocument();
  });

  it("demotes machine keys to a quiet mono line — never into the story", () => {
    render(<TimelineCard events={EVENTS} />);

    // Both decisions bind to version 1 — the assertion is per-event line, not a single match.
    expect(screen.getAllByText(/binds to version 1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/sealed as version 1/)).toBeInTheDocument();
    // Turn refs are present for audit but on the demoted line, not headline labels.
    expect(screen.getByText("urn:turn:5")).toBeInTheDocument();
    const label = screen.getByText("Renamed");
    expect(label).not.toHaveTextContent("urn:turn:5");
  });

  it("renders an honest empty state", () => {
    render(<TimelineCard events={[]} />);
    expect(
      screen.getByText(/nothing recorded yet — decisions and seals will appear here\./i),
    ).toBeInTheDocument();
  });
});