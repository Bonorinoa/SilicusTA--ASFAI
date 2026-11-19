/**
 * versionDiff.ts — what changed between two PUBLISHED versions of a course.
 *
 * Pure, deterministic, non-AI and read-only: it compares two sealed `PackageVersionView` records
 * that are already in the host view and returns a typed structure. It calls nothing and writes
 * nothing.
 *
 * Honest to the data model, and nothing else:
 *   - the course title and the publish note;
 *   - the objectives (`objectiveRefs`: id, kind, statement, publicId);
 *   - the lesson plan (`lessonPlan`: title, audience, and each activity's title, minutes,
 *     learnerDoes, teacherDoes, cited objective ids, material version ids, evidenceIfAny,
 *     notEvidence).
 * Not compared, on purpose: provenance, owner, publish time (who/when, not what), and the plan's
 * `citations` (unsealed host metadata, not part of the package).
 *
 * Matching is by ID, never by guessing:
 *   - an id present on both sides is the same objective/activity, whatever its wording;
 *   - an id that disappears is "removed", a new id is "added" — even if the wording is similar.
 *     (A re-drafted plan gets fresh activity ids, so its activities show as removed + added.
 *     That is the truth about the records; this module does not pair them by similarity.)
 *
 * `diffVersions(a, b)` reads "from a to b" and does not reorder its arguments.
 * Output order is deterministic: items of `b` in `b`'s order, then removed items in `a`'s order.
 */
import type { ActivityView, LessonPlanView, PackageVersionView } from "../gate/types";

export type ObjectiveStatus = "added" | "removed" | "reworded" | "changed" | "unchanged";
export type ActivityStatus = "added" | "removed" | "changed" | "unchanged";

/** A text field before and after. `null` means "not present on that side". */
export interface TextChange {
  status: "changed" | "unchanged";
  before: string | null;
  after: string | null;
}

export interface ObjectiveSide {
  /** The wording; null for a public objective sealed without one. */
  statement: string | null;
  kind: "public" | "local";
  publicId: string | null;
}

export interface ObjectiveDiff {
  id: string;
  /**
   * reworded = same id, different statement. changed = same id and statement, but its kind or
   * publicId differs (an alignment change).
   */
  status: ObjectiveStatus;
  before: ObjectiveSide | null;
  after: ObjectiveSide | null;
}

/** An objective cited by an activity. `statement` is looked up from the versions' own objectives. */
export interface CitedObjective {
  id: string;
  statement: string | null;
}

export interface ActivitySide {
  title: string;
  minutes: number;
  learnerDoes: string;
  teacherDoes: string;
  evidenceIfAny: string;
  notEvidence: string | null;
  objectiveIds: readonly string[];
  materialVersionIds: readonly string[];
}

export type ActivityValueField = "title" | "minutes" | "learnerDoes" | "teacherDoes" | "evidenceIfAny" | "notEvidence";

export type ActivityFieldChange =
  | { kind: "value"; field: ActivityValueField; before: string | null; after: string | null }
  | { kind: "objectives"; added: CitedObjective[]; removed: CitedObjective[] }
  | { kind: "materials"; added: string[]; removed: string[] };

export interface ActivityDiff {
  id: string;
  status: ActivityStatus;
  /** The title to show: the later side's, or the earlier side's for a removed activity. */
  title: string;
  before: ActivitySide | null;
  after: ActivitySide | null;
  /** Empty unless status is "changed". */
  changes: ActivityFieldChange[];
}

export interface AudienceSide {
  ageRangeStart: number | null;
  ageRangeEnd: number | null;
}

export interface AudienceChange {
  status: "changed" | "unchanged";
  /** null = no audience stated. */
  before: AudienceSide | null;
  after: AudienceSide | null;
}

/** none = neither version has a lesson plan; added/removed = only one side has one. */
export type PlanPresence = "none" | "added" | "removed" | "both";

export interface VersionRef {
  version: number;
  publishedAt: number;
}

export interface VersionDiff {
  from: VersionRef;
  to: VersionRef;
  /** True when `from` has a higher version number than `to` (the caller asked for it backwards). */
  backwards: boolean;
  title: TextChange;
  note: TextChange;
  objectives: ObjectiveDiff[];
  /** The ids both versions share appear in a different relative order. */
  objectivesReordered: boolean;
  planPresence: PlanPresence;
  planTitle: TextChange;
  audience: AudienceChange;
  activities: ActivityDiff[];
  activitiesReordered: boolean;
  /** Both versions have activities but share no activity id (e.g. a re-drafted plan). */
  activityIdsDisjoint: boolean;
  counts: {
    objectives: Record<ObjectiveStatus, number>;
    activities: Record<ActivityStatus, number>;
  };
  /** Nothing at all differs (including order, plan presence, audience, title and note). */
  identical: boolean;
}

/* --------------------------------- helpers -------------------------------- */

const textChange = (before: string | null, after: string | null): TextChange => ({
  status: before === after ? "unchanged" : "changed",
  before,
  after,
});

/**
 * Key list for a sequence of items: the id, with a numbered suffix for a repeated id so that the
 * n-th occurrence on one side meets the n-th occurrence on the other (never collapses a duplicate).
 */
function keyed<T extends { id: string }>(items: readonly T[]): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = seen.get(item.id) ?? 0;
    seen.set(item.id, n + 1);
    return { key: n === 0 ? item.id : `${item.id}\u0000${n}`, item };
  });
}

/** True when the keys both sequences share are in a different relative order. */
function reordered(aKeys: readonly string[], bKeys: readonly string[]): boolean {
  const inB = new Set(bKeys);
  const inA = new Set(aKeys);
  const a = aKeys.filter((k) => inB.has(k));
  const b = bKeys.filter((k) => inA.has(k));
  return a.some((k, i) => k !== b[i]);
}

const num = (n: number | undefined): number | null => (n === undefined ? null : n);

function audienceSide(plan: LessonPlanView | null): AudienceSide | null {
  const a = plan?.audience;
  if (!a || (a.ageRangeStart === undefined && a.ageRangeEnd === undefined)) return null;
  return { ageRangeStart: num(a.ageRangeStart), ageRangeEnd: num(a.ageRangeEnd) };
}

function sameAudience(x: AudienceSide | null, y: AudienceSide | null): boolean {
  if (x === null || y === null) return x === y;
  return Object.is(x.ageRangeStart, y.ageRangeStart) && Object.is(x.ageRangeEnd, y.ageRangeEnd);
}

function objectiveSide(o: PackageVersionView["objectiveRefs"][number]): ObjectiveSide {
  return { statement: o.statement ?? null, kind: o.kind, publicId: o.publicId ?? null };
}

function activitySide(a: ActivityView): ActivitySide {
  return {
    title: a.title,
    minutes: a.minutes,
    learnerDoes: a.learnerDoes,
    teacherDoes: a.teacherDoes,
    evidenceIfAny: a.evidenceIfAny,
    notEvidence: a.notEvidence ?? null,
    objectiveIds: [...(a.objectiveIds ?? [])],
    materialVersionIds: [...(a.materialVersionIds ?? [])],
  };
}

/** Elements of `x` not in `y`, in `x`'s order, each once. */
function without(x: readonly string[], y: readonly string[]): string[] {
  const inY = new Set(y);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of x) {
    if (inY.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

const VALUE_FIELDS: ActivityValueField[] = ["title", "minutes", "learnerDoes", "teacherDoes", "evidenceIfAny", "notEvidence"];

const asText = (v: string | number | null): string | null => (v === null ? null : String(v));

function activityChanges(
  a: ActivitySide,
  b: ActivitySide,
  addedStatement: (id: string) => string | null,
  removedStatement: (id: string) => string | null,
): ActivityFieldChange[] {
  const out: ActivityFieldChange[] = [];
  for (const field of VALUE_FIELDS) {
    const x = a[field];
    const y = b[field];
    if (!Object.is(x, y)) out.push({ kind: "value", field, before: asText(x), after: asText(y) });
  }
  const objAdded = without(b.objectiveIds, a.objectiveIds);
  const objRemoved = without(a.objectiveIds, b.objectiveIds);
  if (objAdded.length || objRemoved.length) {
    out.push({
      kind: "objectives",
      added: objAdded.map((id) => ({ id, statement: addedStatement(id) })),
      removed: objRemoved.map((id) => ({ id, statement: removedStatement(id) })),
    });
  }
  const matAdded = without(b.materialVersionIds, a.materialVersionIds);
  const matRemoved = without(a.materialVersionIds, b.materialVersionIds);
  if (matAdded.length || matRemoved.length) out.push({ kind: "materials", added: matAdded, removed: matRemoved });
  return out;
}

/* ---------------------------------- diff ---------------------------------- */

export function diffVersions(a: PackageVersionView, b: PackageVersionView): VersionDiff {
  // Sealed records arrive as JSON: tolerate a missing list rather than throw on a partial record.
  const aRefs = a.objectiveRefs ?? [];
  const bRefs = b.objectiveRefs ?? [];

  // Wording lookup for cited objective ids, as of the side the citation belongs to: a citation the
  // activity gained reads from the later version, one it lost reads from the earlier version.
  const statementIn = (refs: PackageVersionView["objectiveRefs"], other: PackageVersionView["objectiveRefs"]) =>
    (id: string): string | null => (refs.find((o) => o.id === id) ?? other.find((o) => o.id === id))?.statement ?? null;
  const addedStatement = statementIn(bRefs, aRefs);
  const removedStatement = statementIn(aRefs, bRefs);

  /* objectives */
  const aObj = keyed(aRefs);
  const bObj = keyed(bRefs);
  const aObjByKey = new Map(aObj.map((e) => [e.key, e.item]));
  const bObjKeys = new Set(bObj.map((e) => e.key));
  const objectives: ObjectiveDiff[] = [];
  for (const { key, item } of bObj) {
    const prev = aObjByKey.get(key);
    const after = objectiveSide(item);
    if (!prev) {
      objectives.push({ id: item.id, status: "added", before: null, after });
      continue;
    }
    const before = objectiveSide(prev);
    const status: ObjectiveStatus =
      before.statement !== after.statement ? "reworded"
        : before.kind !== after.kind || before.publicId !== after.publicId ? "changed"
          : "unchanged";
    objectives.push({ id: item.id, status, before, after });
  }
  for (const { key, item } of aObj) {
    if (!bObjKeys.has(key)) objectives.push({ id: item.id, status: "removed", before: objectiveSide(item), after: null });
  }

  /* plan */
  const aPlan = a.lessonPlan ?? null;
  const bPlan = b.lessonPlan ?? null;
  const planPresence: PlanPresence = aPlan && bPlan ? "both" : bPlan ? "added" : aPlan ? "removed" : "none";
  const planTitle = textChange(aPlan?.title ?? null, bPlan?.title ?? null);
  const audBefore = audienceSide(aPlan);
  const audAfter = audienceSide(bPlan);
  const audience: AudienceChange = {
    status: sameAudience(audBefore, audAfter) ? "unchanged" : "changed",
    before: audBefore,
    after: audAfter,
  };

  /* activities */
  const aAct = keyed(aPlan?.activities ?? []);
  const bAct = keyed(bPlan?.activities ?? []);
  const aActByKey = new Map(aAct.map((e) => [e.key, e.item]));
  const bActKeys = new Set(bAct.map((e) => e.key));
  const activities: ActivityDiff[] = [];
  for (const { key, item } of bAct) {
    const prev = aActByKey.get(key);
    const after = activitySide(item);
    if (!prev) {
      activities.push({ id: item.id, status: "added", title: after.title, before: null, after, changes: [] });
      continue;
    }
    const before = activitySide(prev);
    const changes = activityChanges(before, after, addedStatement, removedStatement);
    activities.push({
      id: item.id, status: changes.length ? "changed" : "unchanged", title: after.title, before, after, changes,
    });
  }
  for (const { key, item } of aAct) {
    if (bActKeys.has(key)) continue;
    const before = activitySide(item);
    activities.push({ id: item.id, status: "removed", title: before.title, before, after: null, changes: [] });
  }

  const counts = {
    objectives: { added: 0, removed: 0, reworded: 0, changed: 0, unchanged: 0 } as Record<ObjectiveStatus, number>,
    activities: { added: 0, removed: 0, changed: 0, unchanged: 0 } as Record<ActivityStatus, number>,
  };
  for (const o of objectives) counts.objectives[o.status] += 1;
  for (const x of activities) counts.activities[x.status] += 1;

  const title = textChange(a.title ?? null, b.title ?? null);
  const note = textChange(a.note ?? null, b.note ?? null);
  const objectivesReordered = reordered(aObj.map((e) => e.key), bObj.map((e) => e.key));
  const activitiesReordered = reordered(aAct.map((e) => e.key), bAct.map((e) => e.key));
  const activityIdsDisjoint = aAct.length > 0 && bAct.length > 0 && !aAct.some((e) => bActKeys.has(e.key));

  const identical =
    title.status === "unchanged" && note.status === "unchanged" && planTitle.status === "unchanged" &&
    audience.status === "unchanged" && planPresence !== "added" && planPresence !== "removed" &&
    !objectivesReordered && !activitiesReordered &&
    objectives.every((o) => o.status === "unchanged") && activities.every((x) => x.status === "unchanged");

  return {
    from: { version: a.version, publishedAt: a.publishedAt },
    to: { version: b.version, publishedAt: b.publishedAt },
    backwards: a.version > b.version,
    title, note, objectives, objectivesReordered,
    planPresence, planTitle, audience, activities, activitiesReordered, activityIdsDisjoint,
    counts, identical,
  };
}

/** Human labels for each status. Text, so a status is never conveyed by color alone. */
export const STATUS_LABEL: Record<ObjectiveStatus | ActivityStatus, string> = {
  added: "Added", removed: "Removed", reworded: "Reworded", changed: "Changed", unchanged: "Unchanged",
};
