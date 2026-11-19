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
  proposeObjectives: vi.fn(),
  marbleCoverage: vi.fn(),
  marbleSearch: vi.fn(),
  marbleRank: vi.fn(),
  marbleLane: vi.fn(),
  marbleCoverageFor: vi.fn(),
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
  mocks.proposeObjectives.mockResolvedValue({ proposals: [] });
  // Topics per age, shaped like the coverage route: none past 15, as in the pinned snapshot.
  mocks.marbleCoverage.mockImplementation(async (min: number, max: number) => ({
    query: { min, max }, overlapping: min > 15 ? 0 : 1320,
    perAge: Array.from({ length: 23 }, (_, i) => ({ age: i + 3, count: i + 3 > 15 ? 0 : 900 })),
  }));
  mocks.marbleRank.mockResolvedValue({ threads: [], topics: {}, suggestions: [], reason: "WORKER_NOT_CONFIGURED" });
  mocks.marbleCoverageFor.mockResolvedValue({ overlapping: 1599, total: 1912, missingWord: null });
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
  await user.type(await screen.findByLabelText("What should they get out of it?"), "Photosynthesis");
  await user.click(screen.getByRole("button", { name: "+ Add a note about the class" }));
  await user.type(screen.getByLabelText(/Anything else about the class/), "Grade 4");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  // M1: step 2, the skill map. These tests skip it; the M1 tests below anchor and connect.
  await user.click(await screen.findByRole("button", { name: "Skip the map" }));
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

  it("Back at the first step is disabled: it goes to the previous step, never jumps to the welcome", async () => {
    mocks.listCourses.mockResolvedValue({ courses: [{ courseId: "x" }] });
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await screen.findByRole("heading", { name: "Your course and learners" });
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeDisabled();
    await user.click(back).catch(() => {});
    expect(screen.queryByRole("heading", { name: "Let’s set up your course" })).toBeNull();
    // … and from a later step, Back returns to the previous step, not the brief/welcome.
    await user.type(screen.getByLabelText("Course title"), "How plants eat");
    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
    await user.type(await screen.findByLabelText("What should they get out of it?"), "Photosynthesis");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "On the skill map" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip the map" }));
    expect(await screen.findByRole("heading", { name: "Your sources" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "On the skill map" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Your course and learners" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Let’s set up your course" })).toBeNull();
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
    expect(mocks.createCourse).toHaveBeenCalledWith({ title: "How plants eat", owner: "Ada Lovelace", materials: [], objectivesConfirm: "explicit", ages: { min: 8, max: 12 }, lessonMinutes: 45 });
    const answers = mocks.answerIntake.mock.calls[0][1];
    expect(answers.answers).toEqual({ topic: "Photosynthesis", course: "Upper primary, ages 8–12. Grade 4", learning_outcomes: "Explain how a plant makes food", outcomes_from: "materials" });
    expect(answers.text).toBe("Propose the outcomes from my materials.");
    expect(mocks.confirmCheckpoint.mock.calls.map((c) => c[1].id)).toEqual(["files", "outline"]);
    const order = [mocks.createCourse, mocks.answerIntake, mocks.confirmCheckpoint].map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(heldFor(ID).map((h) => h.name)).toEqual(["Leaves catch light."]);
    expect(linksFor(ID)).toEqual([]);
    expect(takeProposeOnArrival(ID)).toBe(true);
    // N1: with sources, the host's source round puts the typed lines on the page; the wizard does not derive twice.
    expect(mocks.proposeObjectives).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(`#/studio/${encodeURIComponent(ID)}`);
  });

  it("N1: typed objectives with no sources become proposals: after the outline, the wizard asks the host to derive them", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await fillCourse(user);
    await user.click(screen.getByRole("button", { name: "Continue without sources" }));
    await user.type(screen.getByLabelText(/Write a few/), "Explain how a plant makes food{enter}Name the parts of a leaf");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" })); // AI check
    await user.click(screen.getByRole("button", { name: /^Confirm and create/ }));
    await waitFor(() => expect(mocks.proposeObjectives).toHaveBeenCalledWith(ID), { timeout: 10_000 });
    expect(mocks.answerIntake.mock.calls[0][1].answers.learning_outcomes).toBe("Explain how a plant makes food\nName the parts of a leaf");
    const order = [mocks.confirmCheckpoint, mocks.proposeObjectives].map((m) => m.mock.invocationCallOrder.at(-1)!);
    expect(order[0]).toBeLessThan(order[1]);
    expect(takeProposeOnArrival(ID)).toBe(false);
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

  it("M1 condensed: one quiet consequence line (AI rule · map topics that fit · one N-minute plan); no histogram strip", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    const begin = await screen.findByRole("button", { name: "Begin" }).catch(() => null);
    if (begin) await user.click(begin);
    expect(await screen.findByText("Choose your learners to see what changes.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
    await waitFor(() => expect(document.querySelector("[data-consequences]")?.textContent).toMatch(/learners use the AI .* · [\d,]+ map topics fit · one 45-minute plan$/));
    expect(document.querySelector('[class*="bars"]')).toBeNull();
    expect(screen.queryByLabelText(/Anything else about the class/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Add a note about the class" }));
    expect(screen.getByLabelText(/Anything else about the class/)).toBeInTheDocument();
  });
});

// K2 (owner, 17 Nov): the teacher sets the lesson length on step 1 ("Course and learners"); the plan fits it.
describe("NewCourseWizard step 1 (K2): How long is the lesson?", () => {
  it("five chips, 45 by default; picking 60 shows on the review and is sent as lessonMinutes", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await user.click(await screen.findByRole("button", { name: "Begin" }));
    const group = await screen.findByRole("radiogroup", { name: "Lesson length" });
    const chips = Array.from(group.querySelectorAll("input[type=radio]")) as HTMLInputElement[];
    expect(chips.map((c) => Number(c.value))).toEqual([20, 30, 45, 60, 90]);
    expect(screen.getByRole("radio", { name: "45 min" })).toBeChecked();
    expect(screen.getByText("How long is the lesson?")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "60 min" }));
    expect(screen.getByRole("radio", { name: "60 min" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "45 min" })).not.toBeChecked();
    await user.type(screen.getByLabelText("Course title"), "How plants eat");
    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
    await user.type(await screen.findByLabelText("What should they get out of it?"), "Photosynthesis");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Skip the map" }));
    await user.click(screen.getByRole("button", { name: /^Continue/ })); // sources: continue without
    await user.type(screen.getByLabelText(/Write a few/), "Explain how a plant makes food");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" })); // AI check
    expect(screen.getByText("60 min lesson")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Confirm and/ }));
    await waitFor(() => expect(mocks.createCourse).toHaveBeenCalledWith(expect.objectContaining({ lessonMinutes: 60 })));
  });
});

describe("NewCourseWizard step 2 (M1): the skill map", () => {
  const topic = (id: string, name: string) => ({ id, name, subject: "Science", domain: "Light", ageRangeStart: 3, ageRangeEnd: 15, description: `About ${name}.`, evidence: ["Show it"], fits: true });
  const MAP = {
    threads: [
      { name: "Light", chain: [null, "mt_b", "mt_a", null, null], edges: [{ from: 1, to: 2, strength: "hard" }], also: [] },
      { name: "Plants", chain: [null, null, "mt_c", null, null], edges: [], also: [] },
    ],
    topics: { mt_a: topic("mt_a", "Reflecting Light"), mt_b: topic("mt_b", "Seeing in the Dark"), mt_c: topic("mt_c", "What Plants Need") },
    suggestions: [{ id: "mt_a", thread: "Light", why: "[scripted] reflection", rank: 1 }, { id: "mt_c", thread: "Plants", why: "[scripted] needs", rank: 2 }],
    counts: { fit: 1599, total: 1912 }, usage: null, reason: null,
  };
  it("nothing is pre-anchored; anchor + connect from another thread; the map source is on by default; confirm sends both pointers", async () => {
    mocks.marbleRank.mockResolvedValue(MAP);
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await user.click(await screen.findByRole("button", { name: "Begin" }));
    await user.type(screen.getByLabelText("Course title"), "Why is the grass green?");
    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("What should they get out of it?"), "Why leaves are green");
    await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "On the skill map" })).toBeInTheDocument();
    await screen.findByText("Two threads fit your question. Pick the topic your lesson stands on.");
    expect(mocks.marbleRank).toHaveBeenCalledWith({ title: "Why is the grass green?", goal: "Why leaves are green", ages: expect.any(Object) });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Silicus’s suggestion:")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Anchor here" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /What Plants Need/ }));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-marble-credit]")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("checkbox", { name: "Use the skill-map topics as a source" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: /Confirm and/ }));
    await waitFor(() => expect(mocks.createCourse).toHaveBeenCalled());
    expect(mocks.createCourse.mock.calls[0][0]).toMatchObject({ marbleAnchor: "mt_a", marbleConnected: "mt_c" });
  });
  it("zero valid suggestions: the step shows search, no error", async () => {
    const user = userEvent.setup();
    render(<NewCourseWizard />);
    await user.click(await screen.findByRole("button", { name: "Begin" }));
    await user.type(screen.getByLabelText("Course title"), "T");
    await user.type(screen.getByLabelText("Your name"), "A");
    await user.type(screen.getByLabelText("What should they get out of it?"), "G");
    await user.click(screen.getByRole("radio", { name: /Upper primary/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Silicus had no suggestions for this. Search the map, or skip it.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Search topics for ages/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
