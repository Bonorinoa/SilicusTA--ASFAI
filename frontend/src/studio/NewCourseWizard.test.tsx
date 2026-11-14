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

// userEvent.type walks every key; under a loaded machine the default 5 s is too tight for a five-step walk.
vi.setConfig({ testTimeout: 30_000 });

const ID = "urn:uuid:aaaaaaaa-2222-3333-4444-555555555555";
const mocks = vi.hoisted(() => ({
  listCourses: vi.fn(),
  workerStatus: vi.fn(),
  createCourse: vi.fn(),
  getCourse: vi.fn(),
  answerIntake: vi.fn(),
  confirmCheckpoint: vi.fn(),
  marbleCoverage: vi.fn(),
  marbleSearch: vi.fn(),
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
  // Topics per age, shaped like the coverage route: none past 15, as in the pinned snapshot.
  mocks.marbleCoverage.mockImplementation(async (min: number, max: number) => ({
    query: { min, max }, overlapping: min > 15 ? 0 : 1320,
    perAge: Array.from({ length: 23 }, (_, i) => ({ age: i + 3, count: i + 3 > 15 ? 0 : 900 })),
  }));
  mocks.marbleSearch.mockResolvedValue({ hits: [
    { id: "mt_AzTrT5ySCx", name: "AI in daily life", subject: "Computing", domain: "Artificial Intelligence", ageRangeStart: 8, ageRangeEnd: 10, score: 3 },
  ] });
  window.location.hash = "#/studio/new";
});

async function fillCourse(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Begin" }));
  await user.type(screen.getByLabelText("Course title"), "How plants eat");
  await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
  await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
  await user.type(await screen.findByLabelText("Topic, in your words"), "Photosynthesis");
  await user.type(screen.getByLabelText(/Anything else about the class/), "Grade 4");
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
    await waitFor(() => expect(mocks.confirmCheckpoint).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    expect(mocks.createCourse).toHaveBeenCalledWith({ title: "How plants eat", owner: "Ada Lovelace", materials: [], objectivesConfirm: "explicit", ages: { min: 8, max: 12 } });
    const answers = mocks.answerIntake.mock.calls[0][1];
    expect(answers.answers).toEqual({ topic: "Photosynthesis", course: "Upper primary, ages 8–12. Grade 4", learning_outcomes: "Explain how a plant makes food", outcomes_from: "materials" });
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
    await waitFor(() => expect(mocks.answerIntake).toHaveBeenCalledTimes(1), { timeout: 10_000 });
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

describe("NewCourseWizard step 1 (G2b): learners, skill map, consequences", () => {
  beforeEach(() => { mocks.listCourses.mockResolvedValue({ courses: [{ courseId: "x" }] }); });

  it("the group cards are one radio group; picking one sets the ages, the strip and the three tiles", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    const radios = await screen.findAllByRole("radio", { name: /primary|secondary|adult/ });
    expect(radios).toHaveLength(5);
    expect(screen.getByText("Choose your learners to see the skill map at their ages.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
    expect(screen.getByRole("radio", { name: /Upper primary/ })).toBeChecked();
    // Keyboard: arrows move within the group (native radios), and the ages follow.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Lower secondary/ })).toBeChecked();
    expect(await screen.findByText("Ages 12–15 · 1,320 skill-map topics")).toBeInTheDocument();
    expect(screen.getByText("Stage 3 of 4")).toBeInTheDocument();
    expect(screen.getByText("1,320 skill-map topics fit these ages.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Skill-map topics at each age/ })).toBeInTheDocument();
  });

  it("the steppers refine min and max; the youngest sets the stage", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await user.click(await screen.findByRole("radio", { name: /Upper primary/ }));
    await user.click(screen.getByRole("button", { name: "Youngest age: one year younger" }));
    await user.click(screen.getByRole("button", { name: "Youngest age: one year younger" }));
    expect(screen.getByRole("group", { name: "Youngest age, 6" })).toBeInTheDocument();
    expect(await screen.findByText("Stage 1 of 4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Oldest age: one year older" }));
    expect(screen.getByRole("group", { name: "Oldest age, 13" })).toBeInTheDocument();
    expect(await screen.findByText(/^Ages 6–13 ·/)).toBeInTheDocument();
  });

  it("picking a skill-map topic sets the anchor and fills the topic; clearing drops it; confirm sends it", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await user.type(await screen.findByLabelText("Course title"), "AI around us");
    await user.type(screen.getByLabelText("Your name"), "Ada");
    await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
    await user.type(await screen.findByLabelText("Search the skill map"), "ai daily");
    await user.click(await screen.findByRole("button", { name: /AI in daily life/ }));
    expect(mocks.marbleSearch).toHaveBeenLastCalledWith("ai daily", 8, 12);
    expect(screen.getByLabelText("Topic, in your words")).toHaveValue("AI in daily life");
    expect(screen.getByText(/Marble Skill Taxonomy \(v1\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear the skill-map anchor AI in daily life" }));
    expect(screen.getByLabelText("Search the skill map")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search the skill map"), "ai");
    await user.click(await screen.findByRole("button", { name: /AI in daily life/ }));
    await user.clear(screen.getByLabelText("Topic, in your words"));
    await user.type(screen.getByLabelText("Topic, in your words"), "AI at home");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Continue without sources" }));
    await user.type(await screen.findByLabelText(/Write a few/), "Name one AI at home");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Ages 8–12 · Upper primary · AI stage 2 of 4")).toBeInTheDocument();
    expect(screen.getByText(/AI in daily life/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm and create the course" }));
    await waitFor(() => expect(mocks.createCourse).toHaveBeenCalledWith({
      title: "AI around us", owner: "Ada", materials: [], objectivesConfirm: "explicit", ages: { min: 8, max: 12 }, marbleAnchor: "mt_AzTrT5ySCx",
    }));
  });

  it("ages with no coverage: the skill map says so, the teacher writes their own, no anchor is sent", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await user.click(await screen.findByRole("radio", { name: /University \/ adult/ }));
    expect(await screen.findByText("No suggestions at these ages: you write your own objectives.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Start from the skill map/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^Write your own/ })).toBeChecked();
    expect(screen.getByText("No skill-map topics at these ages. Write your own.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search the skill map")).toBeNull();
    expect(screen.getByLabelText("Your topic")).toBeInTheDocument();
    expect(mocks.marbleSearch).not.toHaveBeenCalled();
  });
});
