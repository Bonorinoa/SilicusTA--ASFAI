/**
 * MaterialsPanel.test.tsx — real files in the material panel: each shows name, kind and characters (or its plain
 * failure sentence) BEFORE anything is sent; files kept for this tab are offered back; nothing is written to storage.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCEPTED_FILE_TYPES } from "../materials/extract.types";
import { adoptForCourse, forgetEverything, heldFor, holdForNewCourse, keepForCourse } from "../materials/session";
import { MaterialsPanel } from "./MaterialsPanel";

afterEach(() => forgetEverything());
const panel = (props: Partial<React.ComponentProps<typeof MaterialsPanel>> = {}) => {
  const onPropose = vi.fn();
  render(<MaterialsPanel busy={false} zdr={false} onPropose={onPropose} {...props} />);
  return onPropose;
};
const chooser = () => screen.getByLabelText(/choose a file/i) as HTMLInputElement;

describe("choosing files", () => {
  it("accepts exactly the contract's types", () => {
    panel();
    expect(chooser().accept).toBe(ACCEPTED_FILE_TYPES);
    expect(chooser().multiple).toBe(true);
  });

  it("shows each file's name, kind and characters, and sends nothing yet", async () => {
    const onPropose = panel();
    const user = userEvent.setup();
    await user.upload(chooser(), [new File(["Plants make food."], "Lesson notes.txt", { type: "text/plain" }), new File(["Leaves."], "leaves.md")]);
    const list = await screen.findByRole("list", { name: /material added/i });
    expect(within(list).getByText("Lesson notes.txt · Text · 17 characters")).toBeInTheDocument();
    expect(within(list).getByText("leaves.md · Text · 7 characters")).toBeInTheDocument();
    expect(onPropose).not.toHaveBeenCalled();
  });

  it("says in one plain sentence why a file cannot be used, and adds nothing", async () => {
    const onPropose = panel();
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(chooser(), new File(["x"], "old.doc"));
    expect(await screen.findByRole("status")).toHaveTextContent(/old\.doc.*\.docx/s);
    expect(screen.queryByRole("list", { name: /material added/i })).toBeNull();
    expect(screen.getByRole("button", { name: /propose objectives from my materials/i })).toBeDisabled();
    expect(onPropose).not.toHaveBeenCalled();
  });

  it("proposes from the chosen files as {name, text}", async () => {
    const onPropose = panel();
    const user = userEvent.setup();
    await user.upload(chooser(), new File(["Plants make food."], "notes.txt"));
    await screen.findByRole("list", { name: /material added/i });
    await user.click(screen.getByRole("button", { name: /propose objectives from my materials/i }));
    expect(onPropose).toHaveBeenCalledWith([{ name: "notes.txt", text: "Plants make food." }]);
  });

  it("tells a teacher what a reload does to their files", () => {
    panel();
    expect(screen.getByText(/Add the file again to use its text\. Silicus does not keep your files\./)).toBeInTheDocument();
  });

  it("says a file over the host's reading limit is read only in part", async () => {
    panel();
    const user = userEvent.setup();
    await user.upload(chooser(), new File(["a".repeat(70_000)], "long.txt"));
    expect(await screen.findByText(/first 60,000 characters/i)).toBeInTheDocument();
  });
});

describe("files kept for this tab", () => {
  it("offers the files chosen earlier for THIS course, with no second upload", async () => {
    keepForCourse("c1", [{ name: "Syllabus.pdf", kind: "pdf", text: "Fractions are parts of a whole.", chars: 31 }]);
    const onPropose = panel({ courseId: "c1" });
    expect(screen.getByText("Syllabus.pdf · PDF · 31 characters")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /propose objectives from my materials/i }));
    expect(onPropose).toHaveBeenCalledWith([{ name: "Syllabus.pdf", text: "Fractions are parts of a whole." }]);
  });

  it("does not offer another course's files", () => {
    keepForCourse("c1", [{ name: "Syllabus.pdf", kind: "pdf", text: "x", chars: 1 }]);
    panel({ courseId: "c2" });
    expect(screen.queryByText(/Syllabus\.pdf/)).toBeNull();
  });

  it("without a course id, offers the files of the course just recorded in this tab", () => {
    holdForNewCourse({ title: "T", owner: "O" }, [{ name: "Deck.pptx", kind: "pptx", text: "Slide text", chars: 10 }]);
    adoptForCourse({ courseId: "c1", title: "T", owner: "O" });
    panel();
    expect(screen.getByText("Deck.pptx · PowerPoint · 10 characters")).toBeInTheDocument();
  });

  it("removing a file also removes it from what the tab holds; pasted text is never held", async () => {
    keepForCourse("c1", [{ name: "a.docx", kind: "docx", text: "A", chars: 1 }]);
    panel({ courseId: "c1" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /remove a\.docx/i }));
    expect(heldFor("c1")).toEqual([]);
    await user.type(screen.getByPlaceholderText(/a name, for example/i), "Pasted");
    await user.type(screen.getByLabelText(/pasted text/i), "MARKER-PASTE");
    await user.click(screen.getByRole("button", { name: /add this text/i }));
    expect(heldFor("c1")).toEqual([]);
  });

  it("writes the text of a file to no web storage", async () => {
    panel({ courseId: "c1" });
    await userEvent.setup().upload(chooser(), new File(["MARKER-PANEL-TEXT"], "m.txt"));
    await screen.findByRole("list", { name: /material added/i });
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("MARKER-PANEL-TEXT");
  });
});
