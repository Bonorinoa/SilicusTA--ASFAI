/**
 * useCourse.brief-chain.test.tsx — lane A1: the one-click "Confirm the brief" is exactly one action
 * that leaves its steps as SEPARATE host intents, in the host's required order (answers may be
 * recorded any time; the files checkpoint must precede the outline, so files is confirmed before
 * outline), and stops at the first refusal, showing the host's own words.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useCourse } from "./useCourse";
import type { HostView } from "../gate/transport";

const COURSE_ID = "urn:uuid:11111111-2222-3333-4444-555555555555";
const ANSWERS = { topic: "Photosynthesis", course: "Grade 4 science", learning_outcomes: "Explain it" };

const mocks = vi.hoisted(() => ({
  getCourse: vi.fn(),
  answerIntake: vi.fn(),
  confirmCheckpoint: vi.fn(),
}));
vi.mock("../gate/transport", () => ({ host: mocks }));

function Harness({ courseId }: { courseId: string }) {
  const c = useCourse(courseId);
  return (
    <div>
      <button onClick={() => void c.actions.confirmTheBrief(ANSWERS, { sources: true })}>chain</button>
      <button onClick={() => void c.actions.confirmTheBrief(null, { sources: true })}>chain-clean</button>
      <button onClick={() => void c.actions.confirmTheBrief(ANSWERS, { sources: false })}>chain-no-sources</button>
      <span data-testid="notice">{c.problem ? `${c.problem.what} ${c.problem.details}` : c.notice ?? ""}</span>
    </div>
  );
}

const setUp = () => {
  mocks.answerIntake.mockReset();
  mocks.confirmCheckpoint.mockReset();
  mocks.getCourse.mockReset();
  mocks.getCourse.mockResolvedValue({ courseId: COURSE_ID } as unknown as HostView);
  mocks.answerIntake.mockResolvedValue({ outlineAuthorized: true });
  mocks.confirmCheckpoint.mockResolvedValue({ status: "confirmed" });
};

describe("confirmTheBrief", () => {
  it("one click leaves up to three intents, in the host's order: answers, then files, then outline", async () => {
    setUp();
    render(<Harness courseId={COURSE_ID} />);
    await userEvent.click(screen.getByRole("button", { name: "chain" }));
    await waitFor(() => expect(mocks.confirmCheckpoint).toHaveBeenCalledTimes(2));
    expect(mocks.answerIntake).toHaveBeenCalledTimes(1);
    expect(mocks.answerIntake).toHaveBeenCalledWith(COURSE_ID, { text: ANSWERS.topic + "\n" + ANSWERS.course + "\n" + ANSWERS.learning_outcomes, answers: ANSWERS });
    const [files, outline] = mocks.confirmCheckpoint.mock.calls.map((c) => c[1]);
    expect(files).toMatchObject({ id: "files" });
    expect(outline).toMatchObject({ id: "outline" });
    expect(mocks.answerIntake.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirmCheckpoint.mock.invocationCallOrder[0]);
    expect(mocks.confirmCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirmCheckpoint.mock.invocationCallOrder[1]);
  });

  it("an already-saved brief confirms the source list and the outline without re-recording answers", async () => {
    setUp();
    render(<Harness courseId={COURSE_ID} />);
    await userEvent.click(screen.getByRole("button", { name: "chain-clean" }));
    await waitFor(() => expect(mocks.confirmCheckpoint).toHaveBeenCalledTimes(2));
    expect(mocks.answerIntake).not.toHaveBeenCalled();
  });

  it("when the file list is already confirmed the click does not re-confirm it", async () => {
    setUp();
    render(<Harness courseId={COURSE_ID} />);
    await userEvent.click(screen.getByRole("button", { name: "chain-no-sources" }));
    await waitFor(() => expect(mocks.confirmCheckpoint).toHaveBeenCalledTimes(1));
    expect(mocks.confirmCheckpoint).toHaveBeenCalledWith(COURSE_ID, expect.objectContaining({ id: "outline" }));
    expect(mocks.answerIntake).toHaveBeenCalledTimes(1);
  });

  it("stops at the first refusal and shows the host's own words", async () => {
    setUp();
    mocks.answerIntake.mockRejectedValueOnce(new Error("still waiting for the teacher's answer to: learning_outcomes"));
    render(<Harness courseId={COURSE_ID} />);
    await userEvent.click(screen.getByRole("button", { name: "chain" }));
    await waitFor(() => expect(screen.getByTestId("notice")).toHaveTextContent(/still waiting for the teacher's answer/i));
    expect(mocks.confirmCheckpoint).not.toHaveBeenCalled();
    // No gate machine text rides along: the refusal is the host's plain sentence.
    expect(screen.getByTestId("notice")).not.toHaveTextContent(/urn:/);
  });
});