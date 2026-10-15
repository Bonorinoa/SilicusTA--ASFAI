import { describe, expect, it } from "vitest";
import type { ActivityView, PackageVersionView } from "../gate/types";
import { diffVersions } from "./versionDiff";

const act = (over: Partial<ActivityView> = {}): ActivityView => ({
  id: "a1", title: "Spot the claim", minutes: 20, objectiveIds: ["o1"], materialVersionIds: [],
  learnerDoes: "Mark the claim.", teacherDoes: "Circulate.", evidenceIfAny: "observation", ...over,
});

const version = (over: Partial<PackageVersionView> = {}): PackageVersionView => ({
  courseId: "urn:uuid:c", version: 1, previousVersion: null, title: "AI literacy", owner: "Ada", status: "published",
  objectiveRefs: [
    { id: "o1", kind: "local", statement: "Explain what an algorithm is." },
    { id: "o2", kind: "local", statement: "Spot a claim in an answer." },
  ],
  lessonPlan: {
    id: "p", courseId: "urn:uuid:c", courseVersion: 1, title: "Plan", status: "confirmed", proposedBy: "ai", proposedAt: 1,
    audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: [act(), act({ id: "a2", title: "Debrief", objectiveIds: ["o1", "o2"] })],
  },
  publishedAt: 1000, note: null, provenance: { turnRef: "t", decidedBy: "Ada", channel: "ui", decidedAt: 1 },
  ...over,
});

const withPlan = (v: PackageVersionView, patch: Partial<NonNullable<PackageVersionView["lessonPlan"]>>): PackageVersionView =>
  ({ ...v, lessonPlan: { ...v.lessonPlan!, ...patch } });

describe("diffVersions", () => {
  it("reports identical versions as identical, everything unchanged", () => {
    const d = diffVersions(version(), version({ version: 2, previousVersion: 1, publishedAt: 2000 }));
    expect(d.identical).toBe(true);
    expect(d.objectives.map((o) => o.status)).toEqual(["unchanged", "unchanged"]);
    expect(d.activities.map((x) => x.status)).toEqual(["unchanged", "unchanged"]);
    expect(d.counts.objectives.unchanged).toBe(2);
    expect(d.from).toEqual({ version: 1, publishedAt: 1000 });
    expect(d.to).toEqual({ version: 2, publishedAt: 2000 });
    expect(d.backwards).toBe(false);
  });

  it("does not compare provenance, owner or publish time", () => {
    const d = diffVersions(version(), version({ owner: "Someone else", publishedAt: 9, provenance: { turnRef: "x", decidedBy: "Y", channel: "z", decidedAt: 9 } }));
    expect(d.identical).toBe(true);
  });

  it("marks an objective added and one removed by id, never as reworded by similarity", () => {
    const a = version();
    const b = version({
      objectiveRefs: [
        { id: "o1", kind: "local", statement: "Explain what an algorithm is." },
        // o2 gone; o3 has almost the same words but a new id
        { id: "o3", kind: "local", statement: "Spot a claim in an answer!" },
      ],
    });
    const d = diffVersions(a, b);
    expect(d.objectives.map((o) => [o.id, o.status])).toEqual([["o1", "unchanged"], ["o3", "added"], ["o2", "removed"]]);
    expect(d.objectives.find((o) => o.id === "o3")).toMatchObject({ before: null, after: { statement: "Spot a claim in an answer!" } });
    expect(d.objectives.find((o) => o.id === "o2")).toMatchObject({ after: null, before: { statement: "Spot a claim in an answer." } });
    expect(d.counts.objectives).toEqual({ added: 1, removed: 1, reworded: 0, changed: 0, unchanged: 1 });
    expect(d.identical).toBe(false);
  });

  it("marks the same id with a different statement as reworded, with before and after", () => {
    const b = version({
      objectiveRefs: [
        { id: "o1", kind: "local", statement: "Explain, in your own words, what an algorithm is." },
        { id: "o2", kind: "local", statement: "Spot a claim in an answer." },
      ],
    });
    const d = diffVersions(version(), b);
    expect(d.objectives[0]).toMatchObject({
      id: "o1", status: "reworded",
      before: { statement: "Explain what an algorithm is." },
      after: { statement: "Explain, in your own words, what an algorithm is." },
    });
    expect(d.objectives[1].status).toBe("unchanged");
  });

  it("treats a whitespace-only wording change as reworded (exact comparison, no normalising)", () => {
    const b = version({ objectiveRefs: [{ id: "o1", kind: "local", statement: "Explain what an algorithm is. " }, { id: "o2", kind: "local", statement: "Spot a claim in an answer." }] });
    expect(diffVersions(version(), b).objectives[0].status).toBe("reworded");
  });

  it("marks a kind/publicId change with the same wording as changed, not reworded", () => {
    const a = version({ objectiveRefs: [{ id: "o1", kind: "local", statement: "S" }] });
    const b = version({ objectiveRefs: [{ id: "o1", kind: "public", statement: "S", publicId: "mt_1" }] });
    const d = diffVersions(a, b);
    expect(d.objectives[0]).toMatchObject({ status: "changed", before: { kind: "local", publicId: null }, after: { kind: "public", publicId: "mt_1" } });
  });

  it("handles objectives without a statement (public, unworded)", () => {
    const a = version({ objectiveRefs: [{ id: "o1", kind: "public", publicId: "mt_1" }] });
    const same = diffVersions(a, a);
    expect(same.objectives[0]).toMatchObject({ status: "unchanged", after: { statement: null, publicId: "mt_1" } });
    const worded = diffVersions(a, version({ objectiveRefs: [{ id: "o1", kind: "public", publicId: "mt_1", statement: "Now worded" }] }));
    expect(worded.objectives[0]).toMatchObject({ status: "reworded", before: { statement: null }, after: { statement: "Now worded" } });
  });

  it("orders output: the later version's items in its own order, then removed items in the earlier order", () => {
    const a = version({ objectiveRefs: ["a", "b", "c", "d"].map((id) => ({ id, kind: "local" as const, statement: id })) });
    const b = version({ objectiveRefs: ["e", "c", "a"].map((id) => ({ id, kind: "local" as const, statement: id })) });
    const d = diffVersions(a, b);
    expect(d.objectives.map((o) => `${o.id}:${o.status}`)).toEqual(["e:added", "c:unchanged", "a:unchanged", "b:removed", "d:removed"]);
    expect(d.objectivesReordered).toBe(true); // c and a swapped relative order
  });

  it("is not 'reordered' when only additions/removals change the sequence", () => {
    const a = version({ objectiveRefs: ["a", "b", "c"].map((id) => ({ id, kind: "local" as const, statement: id })) });
    const b = version({ objectiveRefs: ["a", "x", "c"].map((id) => ({ id, kind: "local" as const, statement: id })) });
    expect(diffVersions(a, b).objectivesReordered).toBe(false);
  });

  it("a pure reorder is not identical", () => {
    const refs = ["a", "b"].map((id) => ({ id, kind: "local" as const, statement: id }));
    const d = diffVersions(version({ objectiveRefs: refs }), version({ objectiveRefs: [...refs].reverse() }));
    expect(d.objectivesReordered).toBe(true);
    expect(d.identical).toBe(false);
    expect(d.objectives.every((o) => o.status === "unchanged")).toBe(true);
  });

  it("does not collapse repeated ids: the n-th occurrence meets the n-th occurrence", () => {
    const a = version({ objectiveRefs: [{ id: "d", kind: "local", statement: "one" }, { id: "d", kind: "local", statement: "two" }] });
    const b = version({ objectiveRefs: [{ id: "d", kind: "local", statement: "one" }] });
    const d = diffVersions(a, b);
    expect(d.objectives.map((o) => o.status)).toEqual(["unchanged", "removed"]);
  });

  it("reports added, removed and changed activities by id", () => {
    const a = version();
    const b = withPlan(version(), {
      activities: [
        act({ title: "Spot the claim, in pairs", minutes: 25 }), // a1 changed
        act({ id: "a3", title: "Exit ticket" }), // new; a2 gone
      ],
    });
    const d = diffVersions(a, b);
    expect(d.activities.map((x) => `${x.id}:${x.status}`)).toEqual(["a1:changed", "a3:added", "a2:removed"]);
    expect(d.activities[0].changes).toEqual([
      { kind: "value", field: "title", before: "Spot the claim", after: "Spot the claim, in pairs" },
      { kind: "value", field: "minutes", before: "20", after: "25" },
    ]);
    expect(d.activities[0].title).toBe("Spot the claim, in pairs");
    expect(d.activities[2].title).toBe("Debrief");
    expect(d.counts.activities).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 0 });
  });

  it("reports learnerDoes, teacherDoes, evidence and notEvidence changes as value changes", () => {
    const a = version();
    const b = withPlan(version(), {
      activities: [act({ learnerDoes: "Underline it.", teacherDoes: "Model one.", evidenceIfAny: "work-product", notEvidence: "A chat answer" }), act({ id: "a2", title: "Debrief", objectiveIds: ["o1", "o2"] })],
    });
    const x = diffVersions(a, b).activities[0];
    expect(x.status).toBe("changed");
    expect(x.changes).toEqual([
      { kind: "value", field: "learnerDoes", before: "Mark the claim.", after: "Underline it." },
      { kind: "value", field: "teacherDoes", before: "Circulate.", after: "Model one." },
      { kind: "value", field: "evidenceIfAny", before: "observation", after: "work-product" },
      { kind: "value", field: "notEvidence", before: null, after: "A chat answer" },
    ]);
  });

  it("reports cited-objective changes with their wording, resolved from the versions' own objectives", () => {
    const a = version();
    const b = withPlan(version(), {
      activities: [act({ objectiveIds: ["o2"] }), act({ id: "a2", title: "Debrief", objectiveIds: ["o1", "o2"] })],
    });
    const x = diffVersions(a, b).activities[0];
    expect(x.status).toBe("changed");
    expect(x.changes).toEqual([
      {
        kind: "objectives",
        added: [{ id: "o2", statement: "Spot a claim in an answer." }],
        removed: [{ id: "o1", statement: "Explain what an algorithm is." }],
      },
    ]);
  });

  it("reads a gained citation's wording from the later version and a lost one's from the earlier", () => {
    const a = version({ objectiveRefs: [{ id: "o1", kind: "local", statement: "old words" }, { id: "o2", kind: "local", statement: "two old" }] });
    const b = version({
      objectiveRefs: [{ id: "o1", kind: "local", statement: "new words" }, { id: "o2", kind: "local", statement: "two new" }],
      lessonPlan: { ...version().lessonPlan!, activities: [act({ objectiveIds: ["o2"] })] },
    });
    const a2 = { ...a, lessonPlan: { ...version().lessonPlan!, activities: [act({ objectiveIds: ["o1"] })] } };
    expect(diffVersions(a2, b).activities[0].changes).toEqual([
      { kind: "objectives", added: [{ id: "o2", statement: "two new" }], removed: [{ id: "o1", statement: "old words" }] },
    ]);
  });

  it("falls back to a null statement for a cited id that neither version lists", () => {
    const b = withPlan(version(), { activities: [act({ objectiveIds: ["o1", "ghost"] })] });
    const x = diffVersions(version(), b).activities.find((y) => y.id === "a1")!;
    expect(x.changes).toEqual([{ kind: "objectives", added: [{ id: "ghost", statement: null }], removed: [] }]);
  });

  it("citing the same objectives in a different order is not a change", () => {
    const b = withPlan(version(), { activities: [act(), act({ id: "a2", title: "Debrief", objectiveIds: ["o2", "o1"] })] });
    const d = diffVersions(version(), b);
    expect(d.activities.map((x) => x.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("reports material version id changes", () => {
    const a = withPlan(version(), { activities: [act({ materialVersionIds: ["m1", "m2"] })] });
    const b = withPlan(version(), { activities: [act({ materialVersionIds: ["m2", "m3"] })] });
    expect(diffVersions(a, b).activities[0].changes).toEqual([{ kind: "materials", added: ["m3"], removed: ["m1"] }]);
  });

  it("detects reordered activities", () => {
    const base = version();
    const [x, y] = base.lessonPlan!.activities;
    const d = diffVersions(base, withPlan(base, { activities: [y, x] }));
    expect(d.activitiesReordered).toBe(true);
    expect(d.identical).toBe(false);
  });

  it("flags disjoint activity ids (a re-drafted plan) instead of pairing by similarity", () => {
    const b = withPlan(version(), { activities: [act({ id: "new1" }), act({ id: "new2", title: "Debrief" })] });
    const d = diffVersions(version(), b);
    expect(d.activityIdsDisjoint).toBe(true);
    expect(d.activities.map((x) => x.status)).toEqual(["added", "added", "removed", "removed"]);
    expect(diffVersions(version(), version()).activityIdsDisjoint).toBe(false);
  });

  describe("lesson plan null on either side", () => {
    it("plan added: every activity is added, presence says so", () => {
      const d = diffVersions(version({ lessonPlan: null }), version());
      expect(d.planPresence).toBe("added");
      expect(d.activities.map((x) => x.status)).toEqual(["added", "added"]);
      expect(d.planTitle).toEqual({ status: "changed", before: null, after: "Plan" });
      expect(d.audience.status).toBe("changed");
      expect(d.audience.before).toBeNull();
      expect(d.identical).toBe(false);
      expect(d.activityIdsDisjoint).toBe(false);
    });
    it("plan removed: every activity is removed", () => {
      const d = diffVersions(version(), version({ lessonPlan: null }));
      expect(d.planPresence).toBe("removed");
      expect(d.activities.map((x) => x.status)).toEqual(["removed", "removed"]);
      expect(d.audience.after).toBeNull();
    });
    it("no plan on either side: nothing plan-related, and still identical if the rest matches", () => {
      const d = diffVersions(version({ lessonPlan: null }), version({ lessonPlan: null }));
      expect(d.planPresence).toBe("none");
      expect(d.activities).toEqual([]);
      expect(d.audience.status).toBe("unchanged");
      expect(d.identical).toBe(true);
    });
  });

  it("reports title, plan title, audience and note changes", () => {
    const a = version({ note: "First release" });
    const b = withPlan(version({ title: "AI literacy, revised", note: "Reworded two objectives" }), {
      title: "Plan v2", audience: { ageRangeStart: 9 },
    });
    const d = diffVersions(a, b);
    expect(d.title).toEqual({ status: "changed", before: "AI literacy", after: "AI literacy, revised" });
    expect(d.planTitle).toEqual({ status: "changed", before: "Plan", after: "Plan v2" });
    expect(d.note).toEqual({ status: "changed", before: "First release", after: "Reworded two objectives" });
    expect(d.audience).toEqual({
      status: "changed",
      before: { ageRangeStart: 8, ageRangeEnd: 10 },
      after: { ageRangeStart: 9, ageRangeEnd: null },
    });
  });

  it("a note appearing or disappearing is a change; null vs empty string is distinct", () => {
    expect(diffVersions(version(), version({ note: "hi" })).note).toEqual({ status: "changed", before: null, after: "hi" });
    expect(diffVersions(version({ note: "hi" }), version()).note).toEqual({ status: "changed", before: "hi", after: null });
    expect(diffVersions(version(), version({ note: "" })).note.status).toBe("changed");
  });

  it("treats an empty audience object the same as no audience", () => {
    const d = diffVersions(version(), withPlan(version(), { audience: {} }));
    expect(d.audience.after).toBeNull();
    expect(d.audience.status).toBe("changed"); // 8-10 -> none
    const e = diffVersions(withPlan(version(), { audience: undefined }), withPlan(version(), { audience: {} }));
    expect(e.audience.status).toBe("unchanged");
  });

  it("diffs exactly as asked when version numbers are out of order (never swaps or sorts)", () => {
    const v1 = version({ version: 1, note: "first" });
    const v3 = version({ version: 3, previousVersion: 1, note: "third" });
    const fwd = diffVersions(v1, v3);
    const back = diffVersions(v3, v1);
    expect(fwd.backwards).toBe(false);
    expect(back.backwards).toBe(true);
    expect(back.from.version).toBe(3);
    expect(back.to.version).toBe(1);
    expect(back.note).toEqual({ status: "changed", before: "third", after: "first" });
  });

  it("diffing a version with itself is identical", () => {
    const v = version();
    expect(diffVersions(v, v).identical).toBe(true);
  });

  it("keeps hostile strings as inert data and survives prototype-ish ids", () => {
    const evil = `<img src=x onerror=alert(1)> </script> '"& {{x}} ${"\u202e"}`;
    const a = version({
      objectiveRefs: [{ id: "__proto__", kind: "local", statement: evil }, { id: "constructor", kind: "local", statement: "c" }, { id: "toString", kind: "local", statement: "t" }],
      lessonPlan: null,
    });
    const b = version({
      objectiveRefs: [{ id: "__proto__", kind: "local", statement: evil + "!" }, { id: "hasOwnProperty", kind: "local", statement: "h" }],
      title: evil, note: evil, lessonPlan: null,
    });
    const d = diffVersions(a, b);
    expect(d.objectives.map((o) => `${o.id}:${o.status}`)).toEqual(["__proto__:reworded", "hasOwnProperty:added", "constructor:removed", "toString:removed"]);
    expect(d.objectives[0].before!.statement).toBe(evil);
    expect(d.objectives[0].after!.statement).toBe(evil + "!");
    expect(d.title.after).toBe(evil);
    expect(d.note.after).toBe(evil);
    expect(Object.keys({}).length).toBe(0); // no prototype pollution
  });

  it("does not mutate its inputs", () => {
    const a = version(); const b = withPlan(version(), { activities: [act({ title: "x" })] });
    const sa = JSON.stringify(a); const sb = JSON.stringify(b);
    diffVersions(a, b);
    expect(JSON.stringify(a)).toBe(sa);
    expect(JSON.stringify(b)).toBe(sb);
  });

  it("tolerates a partial record (no objectiveRefs) without throwing", () => {
    const partial = { version: 1 } as unknown as PackageVersionView;
    const d = diffVersions(partial, version());
    expect(d.objectives.every((o) => o.status === "added")).toBe(true);
  });

  it("is deterministic: the same inputs give deep-equal results", () => {
    const b = withPlan(version(), { activities: [act({ minutes: 5 })] });
    expect(diffVersions(version(), b)).toEqual(diffVersions(version(), b));
  });
});
