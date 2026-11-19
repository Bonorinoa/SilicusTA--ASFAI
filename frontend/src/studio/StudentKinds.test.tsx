/**
 * StudentKinds.test.tsx — K3: Rehearse and the student preview render the new reply kinds the host composes
 * (clarify, about_helper, the off_topic redirect), and the trace says which kind it was.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudentAnswer } from "../gate/transport";
import { Learn } from "./Learn";
import { Rehearse } from "./Rehearse";

const { COURSE_ID, state } = vi.hoisted(() => ({
  COURSE_ID: "urn:uuid:11111111-2222-3333-4444-555555555555",
  state: { replies: [] as unknown[], asked: [] as string[] },
}));

vi.mock("../gate/transport", async (orig) => {
  const real = await orig<typeof import("../gate/transport")>();
  const view = {
    course: { courseId: COURSE_ID, owner: "Ms. Lovelace", title: "Why is the grass green" },
    versions: [{ version: 1, owner: "Ms. Lovelace", title: "Why is the grass green", objectiveRefs: [{ id: "o-1", statement: "Students can explain why grass is green." }] }],
    timeline: [], ledger: [], integrity: { events: 1, head: "h" },
  };
  const host = {
    getCourse: async () => view,
    workerStatus: async () => ({ configured: true }),
    askStudent: async (_id: string, b: { question: string }) => { state.asked.push(b.question); return state.replies.shift(); },
  };
  return { ...real, host: host as unknown as typeof real.host };
});

const CLARIFY: StudentAnswer = {
  answer: "What would you like to know? I can help with: Explain why grass is green · Leaf hunt.",
  grounded: false, cites: [{ id: "objective:1", label: "Objective 1" }, { id: "activity:1", label: "Activity 1: Leaf hunt" }],
  note: "Asking questions here is not evidence of learning.", kind: "clarify",
  offers: [{ id: "objective:1", topic: "Explain why grass is green" }, { id: "activity:1", topic: "Leaf hunt" }],
};
const ABOUT: StudentAnswer = { answer: "I'm Silicus, a helper for today's lesson: Why is the grass green. Ask me about it.", grounded: false, cites: [], note: "", kind: "about_helper" };
const REDIRECT: StudentAnswer = {
  answer: "That isn't part of today's lesson. I can help with: Explain why grass is green. Or ask your teacher.",
  grounded: false, cites: [], note: "", refusal: "off_topic", kind: "off_topic", offers: [{ id: "objective:1", topic: "Explain why grass is green" }],
};
const ANSWER: StudentAnswer = { answer: "Leaves hold a green colour.", grounded: true, cites: [{ id: "objective:1", label: "Objective 1" }], note: "", basis: "plan", kind: "answer" };

afterEach(() => { cleanup(); state.replies = []; state.asked = []; });

describe("K3 · student preview (Learn)", () => {
  it("a clarify reply offers the lesson's items as buttons, and tapping one asks about it", async () => {
    state.replies = [CLARIFY, ANSWER];
    render(<Learn courseId={COURSE_ID} />);
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText("Ask about today’s lesson"), "grass");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(CLARIFY.answer);
    const group = screen.getByRole("group", { name: "Ask about" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Explain why grass is green", "Leaf hunt"]);
    expect(screen.queryByText(/From the lesson/u)).not.toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "Leaf hunt" }));
    await screen.findByText(ANSWER.answer);
    expect(state.asked).toEqual(["grass", "Leaf hunt"]);
  });

  it("about_helper and the redirect read as the host wrote them; the redirect offers the objectives", async () => {
    state.replies = [ABOUT, REDIRECT];
    render(<Learn courseId={COURSE_ID} />);
    const user = userEvent.setup();
    const box = await screen.findByPlaceholderText("Ask about today’s lesson");
    await user.type(box, "what is your name");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(ABOUT.answer);
    expect(screen.queryByRole("group", { name: "Ask about" })).not.toBeInTheDocument();
    await user.type(box, "sky");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(REDIRECT.answer);
    expect(within(screen.getByRole("group", { name: "Ask about" })).getByRole("button", { name: "Explain why grass is green" })).toBeInTheDocument();
  });
});

describe("K3 · Rehearse names the kind in the trace", () => {
  it("clarify, about_helper and the redirect each get their own label and trace", async () => {
    state.replies = [CLARIFY, ABOUT, REDIRECT];
    render(<Rehearse courseId={COURSE_ID} />);
    const user = userEvent.setup();
    const box = await screen.findByPlaceholderText("Type as a student would…");
    await user.type(box, "grass");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findAllByText("Asked what they meant · fixed text listing your plan’s items")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/the question was too vague, so the helper asked which of these the student meant/u)).toBeInTheDocument();

    await user.type(box, "who are you");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findAllByText("Introduced itself · fixed text")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/the helper introduced itself in fixed words/u)).toBeInTheDocument();

    await user.type(box, "sky");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findAllByText("Refused · not in the published version · pointed back to your objectives")).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll("[data-kind]").length).toBeGreaterThanOrEqual(3);
  });

  it("the 'Asks the helper's name' probe passes only on about_helper", async () => {
    state.replies = [ABOUT];
    render(<Rehearse courseId={COURSE_ID} />);
    const user = userEvent.setup();
    const item = (await screen.findByText("Asks the helper’s name")).closest("li") as HTMLElement;
    expect(within(item).getByText("Should introduce itself, then point to the lesson")).toBeInTheDocument();
    await user.click(within(item).getByRole("button", { name: "Run" }));
    expect(await within(item).findByText("As expected ✓")).toBeInTheDocument();
    expect(state.asked).toEqual(["What is your name?"]);
  });
});
