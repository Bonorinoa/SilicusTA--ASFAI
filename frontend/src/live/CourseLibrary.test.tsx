/**
 * CourseLibrary.test.tsx — "Your courses" is a real menu button, not an input lookalike.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CourseSummary } from "../gate/transport";
import { CourseLibrary } from "./CourseLibrary";

const courses: CourseSummary[] = [
  { courseId: "c1", owner: "Ada", title: "How plants eat", createdAt: 1, progress: { confirmed: 2, total: 5, versions: 0 } },
  { courseId: "c2", owner: "Ada", title: "Fractions, grade 3", createdAt: 2, progress: { confirmed: 5, total: 5, versions: 1 } },
];
const setup = (over: Partial<Parameters<typeof CourseLibrary>[0]> = {}) => {
  const onOpen = vi.fn(); const onNew = vi.fn();
  const utils = render(<CourseLibrary courses={courses} currentId="c1" busy={false} onOpen={onOpen} onNew={onNew} {...over} />);
  return { onOpen, onNew, ...utils };
};

describe("CourseLibrary as a menu", () => {
  it("with a course open it is one button named after that course, closed, with a chevron and no list on the page", () => {
    setup();
    const b = screen.getByRole("button", { name: /How plants eat/ });
    expect(b).toHaveAttribute("aria-haspopup", "menu");
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on press, lists every course with where it stands, and the open one is marked", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /How plants eat/ }));
    const menu = screen.getByRole("menu", { name: "Your courses" });
    expect(screen.getByRole("button", { name: /How plants eat/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByText(/2 of 5 checkpoints confirmed/)).toBeInTheDocument();
    expect(within(menu).getByText(/published, version 1/)).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "How plants eat is open" })).toBeDisabled();
    expect(screen.getByText("Your courses (2)")).toBeInTheDocument();
  });

  it("focus lands in the menu; arrows move; Escape closes and gives focus back to the button", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: /How plants eat/ });
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Open Fractions, grade 3" })).toHaveFocus(); // the first one that can be pressed
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Start a new course" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Open Fractions, grade 3" })).toHaveFocus(); // wraps
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("choosing a course opens it and closes the menu; so does starting a new one; a click outside closes it", async () => {
    const user = userEvent.setup();
    const { onOpen, onNew } = setup();
    await user.click(screen.getByRole("button", { name: /How plants eat/ }));
    await user.click(screen.getByRole("menuitem", { name: "Open Fractions, grade 3" }));
    expect(onOpen).toHaveBeenCalledWith("c2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /How plants eat/ }));
    await user.click(screen.getByRole("menuitem", { name: "Start a new course" }));
    expect(onNew).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /How plants eat/ }));
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("flags a course whose record does not verify, and never hides it", async () => {
    const user = userEvent.setup();
    setup({ courses: [...courses, { courseId: "bad", owner: "Ada", title: "Damaged", createdAt: 0, progress: { error: "LOG_INTEGRITY" } }] });
    await user.click(screen.getByRole("button", { name: /How plants eat/ }));
    expect(screen.getByText(/needs attention: its record does not verify/)).toBeInTheDocument();
  });

  it("with no course open it is a plain list under a heading, with no menu to open", () => {
    setup({ currentId: null });
    expect(screen.getByRole("heading", { name: "Your courses (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open How plants eat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a new course" })).toBeInTheDocument();
  });

  it("renders nothing without courses", () => {
    const { container } = setup({ courses: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
