/**
 * OnboardingChat.files.test.tsx — "Add files" beside the typed names at the materials question.
 * The file NAMES are recorded exactly as typed names are; the TEXT stays in tab memory for the later proposal.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostView } from "../gate/transport";
import { ACCEPTED_FILE_TYPES } from "../materials/extract.types";
import { adoptForCourse, forgetEverything, heldFor } from "../materials/session";
import { OnboardingChat } from "./OnboardingChat";

afterEach(() => forgetEverything());

const intake = (onCreate = vi.fn()) => {
  const noop = vi.fn();
  render(<OnboardingChat view={null} asfai={null} busy={false} onCreate={onCreate} onConfirmFiles={noop} onAsk={noop}
    onAnswer={noop} onSendToAsfai={noop} onConnect={noop} onRefresh={noop} />);
  return onCreate;
};
async function toMaterialsStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/what should we call this course/i), "How plants eat");
  await user.click(screen.getByRole("button", { name: /record the course title/i }));
  await user.type(await screen.findByLabelText(/what name should this course show for you/i), "Ada");
  await user.click(screen.getByRole("button", { name: /record this name/i }));
  return (await screen.findByLabelText(/what is this course built from/i)) as HTMLTextAreaElement;
}
const adder = () => screen.getByLabelText(/add files/i) as HTMLInputElement;

describe("Add files at the materials question", () => {
  it("is offered only at the materials step, with the contract's types", async () => {
    intake();
    expect(screen.queryByLabelText(/add files/i)).toBeNull();
    await toMaterialsStep(userEvent.setup());
    expect(adder().accept).toBe(ACCEPTED_FILE_TYPES);
  });

  it("puts a chosen file's name on its own line beside the typed names, and shows what was read", async () => {
    intake();
    const user = userEvent.setup();
    const box = await toMaterialsStep(user);
    await user.type(box, "Textbook ch. 3");
    await user.upload(adder(), new File(["Plants make food."], "Lesson notes.txt"));
    expect(await screen.findByText("Lesson notes.txt · Text · 17 characters")).toBeInTheDocument();
    expect(box.value).toBe("Textbook ch. 3\nLesson notes.txt");
  });

  it("records the course with the file NAMES only, exactly as typed names are, and keeps the text in the tab", async () => {
    const onCreate = intake();
    const user = userEvent.setup();
    await toMaterialsStep(user);
    await user.upload(adder(), new File(["MARKER-ONBOARD-TEXT"], "Lesson notes.txt"));
    await screen.findByText(/Lesson notes\.txt · Text/);
    await user.click(screen.getByRole("button", { name: /record these names/i }));
    expect(onCreate).toHaveBeenCalledWith({ owner: "Ada", title: "How plants eat", materials: [{ name: "Lesson notes.txt" }] });
    expect(JSON.stringify(onCreate.mock.calls)).not.toContain("MARKER-ONBOARD-TEXT");
    // The tab holds the text for the course once it exists.
    expect(adoptForCourse({ courseId: "c1", title: "How plants eat", owner: "Ada" })).toBe(true);
    expect(heldFor("c1")).toEqual([expect.objectContaining({ name: "Lesson notes.txt", text: "MARKER-ONBOARD-TEXT" })]);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("MARKER-ONBOARD-TEXT");
  });

  it("keeps no text for a file whose name the teacher then deleted from the list", async () => {
    const onCreate = intake();
    const user = userEvent.setup();
    const box = await toMaterialsStep(user);
    await user.upload(adder(), new File(["x"], "gone.txt"));
    await screen.findByText(/gone\.txt · Text/);
    await user.clear(box);
    await user.type(box, "Only this one");
    await user.click(screen.getByRole("button", { name: /record these names/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ materials: [{ name: "Only this one" }] }));
    expect(adoptForCourse({ courseId: "c1", title: "How plants eat", owner: "Ada" })).toBe(false);
  });

  it("choosing No materials keeps no files", async () => {
    const onCreate = intake();
    const user = userEvent.setup();
    await toMaterialsStep(user);
    await user.upload(adder(), new File(["x"], "a.txt"));
    await screen.findByText(/a\.txt · Text/);
    await user.click(screen.getByRole("button", { name: /no materials/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ materials: [] }));
    expect(adoptForCourse({ courseId: "c1", title: "How plants eat", owner: "Ada" })).toBe(false);
  });

  it("says plainly why an unusable file was not added, and does not add its name", async () => {
    intake();
    const user = userEvent.setup({ applyAccept: false });
    const box = await toMaterialsStep(user);
    await user.upload(adder(), new File(["x"], "old.doc"));
    expect(await screen.findByText(/old\.doc.*\.docx/s)).toBeInTheDocument();
    expect(box.value).toBe("");
  });
});

describe("once the course exists", () => {
  it("hands the held files to the course the teacher just recorded", async () => {
    const onCreate = intake();
    const user = userEvent.setup();
    await toMaterialsStep(user);
    await user.upload(adder(), new File(["TEXT"], "a.txt"));
    await screen.findByText(/a\.txt · Text/);
    await user.click(screen.getByRole("button", { name: /record these names/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    // The page now shows the recorded course; a fresh OnboardingChat (the intake stage) claims the files for its id.
    const view = { course: { courseId: "c9", title: "How plants eat", owner: "Ada", materials: [{ name: "a.txt" }] },
      checkpoints: { files: { status: "pending" } }, intake: { questions: [], answers: {} }, proposals: [] } as unknown as HostView;
    const noop = vi.fn();
    render(<OnboardingChat view={view} asfai={null} busy={false} onCreate={noop} onConfirmFiles={noop} onAsk={noop}
      onAnswer={noop} onSendToAsfai={noop} onConnect={noop} onRefresh={noop} />);
    expect(heldFor("c9").map((f) => f.name)).toEqual(["a.txt"]);
  });
});
