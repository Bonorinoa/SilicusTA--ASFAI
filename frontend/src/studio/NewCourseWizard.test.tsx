/**
 * NewCourseWizard.test.tsx — R7: the wizard's one confirm leaves the SAME intents the brief sends, in the
 * same order (create with no names-only materials, answers, files, outline), only from the review step
 * that shows them, and holds file text in the tab for the new course.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { heldFor, forgetEverything } from "../materials/session";
import { briefAnswers, NewCourseWizard } from "./NewCourseWizard";
import { linksFor, takeProposeOnArrival } from "./links";

const ID = "urn:uuid:aaaaaaaa-2222-3333-4444-555555555555";
const mocks = vi.hoisted(() => ({
  listCourses: vi.fn(),
  workerStatus: vi.fn(),
  createCourse: vi.fn(),
  getCourse: vi.fn(),
  answerIntake: vi.fn(),
  confirmCheckpoint: vi.fn(),
}));
vi.mock("../gate/transport", () => ({ host: mocks }));

const QUESTIONS = [{ id: "topic", prompt: "t" }, { id: "course", prompt: "c" }, { id: "learning_outcomes", prompt: "o" }];

beforeEach(() => {
  forgetEverything();
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.listCourses.mockResolvedValue({ courses: [] });
  mocks.workerStatus.mockResolvedValue({ configured: true });
  mocks.createCourse.mockResolvedValue({ courseId: ID });
  mocks.getCourse.mockResolvedValue({ courseId: ID, intake: { questions: QUESTIONS } });
  mocks.answerIntake.mockResolvedValue({});
  mocks.confirmCheckpoint.mockResolvedValue({});
  window.location.hash = "#/studio/new";
});

async function fillCourse(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Begin" }));
  await user.type(screen.getByLabelText("Course title"), "How plants eat");
  await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Topic"), "Photosynthesis");
  await user.type(screen.getByLabelText("Who it’s for"), "Grade 4");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("NewCourseWizard", () => {
  it("first run opens on the welcome, and nothing is recorded while moving through the steps", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    expect(await screen.findByRole("heading", { name: "Let’s set up your course" })).toBeInTheDocument();
    await fillCourse(user);
    expect(screen.getByRole("heading", { name: "Your sources" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Name$/)).toBeNull(); // no source-name field anywhere
    expect(mocks.createCourse).not.toHaveBeenCalled();
    expect(mocks.answerIntake).not.toHaveBeenCalled();
  });

  it("a returning teacher starts at step 1, without the welcome", async () => {
    mocks.listCourses.mockResolvedValue({ courses: [{ courseId: "x" }] });
    render(<NewCourseWizard />);
    expect(await screen.findByRole("heading", { name: "Your course and learners" })).toBeInTheDocument();
  });

  it("the review's confirm sends create (no materials), answers, files, outline — in that order — and lands on the course", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await fillCourse(user);
    // a pasted source: named by its own first line, held in the tab
    await user.type(screen.getByLabelText("Or paste text, or a web page address"), "Leaves catch light.{enter}Roots take up water.");
    await user.click(screen.getByRole("button", { name: "Add text" }));
    expect(screen.getByText("Leaves catch light.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText(/Write a few/), "Explain how a plant makes food");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" })); // AI check
    expect(screen.getByRole("heading", { name: "Review and confirm" })).toBeInTheDocument();
    expect(mocks.createCourse).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Confirm and/ }));
    await waitFor(() => expect(mocks.confirmCheckpoint).toHaveBeenCalledTimes(2));
    expect(mocks.createCourse).toHaveBeenCalledWith({ title: "How plants eat", owner: "Ada Lovelace", materials: [] });
    const answers = mocks.answerIntake.mock.calls[0][1];
    expect(answers.answers).toEqual({ topic: "Photosynthesis", course: "Grade 4", learning_outcomes: "Explain how a plant makes food", outcomes_from: "materials" });
    expect(answers.text).toBe("Propose the outcomes from my materials.");
    expect(mocks.confirmCheckpoint.mock.calls.map((c) => c[1].id)).toEqual(["files", "outline"]);
    const order = [mocks.createCourse, mocks.answerIntake, mocks.confirmCheckpoint].map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(heldFor(ID).map((h) => h.name)).toEqual(["Leaves catch light."]);
    expect(linksFor(ID)).toEqual([]);
    expect(takeProposeOnArrival(ID)).toBe(true);
    expect(window.location.hash).toBe(`#/studio/${encodeURIComponent(ID)}`);
  });

  it("when the host asks questions the wizard did not show, it records the answers it has and confirms nothing", async () => {
    mocks.getCourse.mockResolvedValue({ courseId: ID, intake: { questions: [...QUESTIONS, { id: "prior_knowledge", prompt: "p" }] } });
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await fillCourse(user);
    await user.click(screen.getByRole("button", { name: "Continue without sources" }));
    await user.type(screen.getByLabelText(/Write a few/), "Explain it");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Confirm and create the course" }));
    await waitFor(() => expect(mocks.answerIntake).toHaveBeenCalledTimes(1));
    expect(mocks.confirmCheckpoint).not.toHaveBeenCalled();
  });

  it("objectives need either written ones or sources to propose from", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await fillCourse(user);
    await user.click(screen.getByRole("button", { name: "Continue without sources" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

describe("briefAnswers", () => {
  it("is the brief step's shape: trimmed lines, outcomes_from only when chosen", () => {
    expect(briefAnswers({ title: "t", owner: "o", topic: " T ", audience: " A ", outcomes: " one \n\n two ", fromSources: false }))
      .toEqual({ topic: "T", course: "A", learning_outcomes: "one\ntwo" });
    expect(briefAnswers({ title: "t", owner: "o", topic: "T", audience: "A", outcomes: "", fromSources: true }))
      .toEqual({ topic: "T", course: "A", outcomes_from: "materials" });
  });
});
