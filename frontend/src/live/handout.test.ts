import { describe, expect, it } from "vitest";
import type { PackageVersionView } from "../gate/types";
import { buildHandoutHtml, handoutFilename } from "./handout";

const version = (over: Partial<PackageVersionView> = {}): PackageVersionView => ({
  courseId: "urn:uuid:c", version: 2, previousVersion: 1, title: "AI literacy: <b>claims</b>", owner: "Ada", status: "published",
  objectiveRefs: [
    { id: "o1", kind: "local", statement: "Students can explain what an algorithm is." },
    { id: "o2", kind: "local", statement: 'Learners can spot <script>alert("x")</script> in an answer.' },
  ],
  lessonPlan: {
    id: "p", courseId: "urn:uuid:c", courseVersion: 2, title: "t", status: "confirmed", proposedBy: "ai", proposedAt: 1,
    audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: [{ id: "a1", title: "Spot the claim", minutes: 20, objectiveIds: ["o1"], materialVersionIds: [], learnerDoes: "Mark the sentence that makes a claim.", teacherDoes: "SECRET teacher note: hand out the answer key.", evidenceIfAny: "observation", notEvidence: "SECRET not-evidence note" }],
  },
  publishedAt: Date.UTC(2026, 9, 14), note: null, provenance: { turnRef: "urn:turn:1", decidedBy: "Ada", channel: "silicus-ui", decidedAt: 1 },
  ...over,
});

describe("the student handout", () => {
  it("carries the confirmed objectives and what learners do, with ages, minutes and the honesty line", () => {
    const html = buildHandoutHtml(version());
    expect(html).toContain("Students can explain what an algorithm is.");
    expect(html).toContain("Spot the claim");
    expect(html).toContain("20 min");
    expect(html).toContain("Mark the sentence that makes a claim.");
    expect(html).toContain("Ages 8–10");
    expect(html).toContain("not evidence of learning");
    expect(html).toContain("2026-10-14");
  });

  it("leaves out everything a student should not see: teacher moves and notes", () => {
    const html = buildHandoutHtml(version());
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("answer key");
  });

  it("escapes every string and contains no script, and forbids one by policy", () => {
    const html = buildHandoutHtml(version());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<b>claims</b>");
    expect(html).toContain("AI literacy: &lt;b&gt;claims&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("default-src 'none'");
  });

  it("still makes a page when the plan is missing, and names the file safely", () => {
    const html = buildHandoutHtml(version({ lessonPlan: null }));
    expect(html).toContain("Your teacher will share the activities.");
    expect(handoutFilename(version())).toBe("silicus-handout-ai-literacy-b-claims-b-v2.html");
    expect(handoutFilename(version({ title: "???" }))).toBe("silicus-handout-course-v2.html");
  });
});
