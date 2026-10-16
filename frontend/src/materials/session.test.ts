/**
 * session.test.ts — the text of a teacher's files lives in this tab's memory, keyed by course, and nowhere else.
 */
import { afterEach, describe, expect, it } from "vitest";
import { activeCourseId, adoptForCourse, forgetEverything, heldFor, holdForNewCourse, keepForCourse } from "./session";

const file = (name: string, text = "Plants make food.") => ({ name, kind: "text" as const, text, chars: text.length });
afterEach(() => forgetEverything());

describe("the tab-memory store for uploaded text", () => {
  it("holds nothing until something is kept, and keeps per course", () => {
    expect(heldFor("c1")).toEqual([]);
    keepForCourse("c1", [file("a.txt")]);
    keepForCourse("c2", [file("b.txt")]);
    expect(heldFor("c1").map((f) => f.name)).toEqual(["a.txt"]);
    expect(heldFor("c2").map((f) => f.name)).toEqual(["b.txt"]);
  });

  it("keeping an empty list forgets the course's files", () => {
    keepForCourse("c1", [file("a.txt")]);
    keepForCourse("c1", []);
    expect(heldFor("c1")).toEqual([]);
  });

  it("files chosen while naming a course belong to the course that is then recorded, matched by title and name", () => {
    holdForNewCourse({ title: "How plants eat", owner: "Ada" }, [file("a.txt")]);
    // Another course opening first does not take them.
    expect(adoptForCourse({ courseId: "other", title: "Fractions", owner: "Ada" })).toBe(false);
    expect(heldFor("other")).toEqual([]);
    expect(adoptForCourse({ courseId: "c1", title: "How plants eat", owner: "Ada" })).toBe(true);
    expect(heldFor("c1").map((f) => f.name)).toEqual(["a.txt"]);
    expect(activeCourseId()).toBe("c1");
    // Taken once: a second course with the same words does not get them again.
    expect(adoptForCourse({ courseId: "c2", title: "How plants eat", owner: "Ada" })).toBe(false);
  });

  it("holding an empty list for a new course clears an earlier, unclaimed one", () => {
    holdForNewCourse({ title: "T", owner: "O" }, [file("a.txt")]);
    holdForNewCourse({ title: "T", owner: "O" }, []);
    expect(adoptForCourse({ courseId: "c1", title: "T", owner: "O" })).toBe(false);
  });

  it("never writes to web storage", () => {
    keepForCourse("c1", [file("a.txt", "MARKER-SESSION-1")]);
    holdForNewCourse({ title: "T", owner: "O" }, [file("b.txt", "MARKER-SESSION-2")]);
    expect(JSON.stringify({ ...localStorage })).not.toContain("MARKER-SESSION");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("MARKER-SESSION");
  });

  it("hands out copies, so a caller cannot change what is held", () => {
    keepForCourse("c1", [file("a.txt")]);
    heldFor("c1").pop();
    expect(heldFor("c1")).toHaveLength(1);
  });
});
