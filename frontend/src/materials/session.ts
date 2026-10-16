/**
 * session.ts — the text of a teacher's files, held in this tab's memory and nowhere else.
 *
 * A module-level Map keyed by course id. It is never written to IndexedDB, localStorage, sessionStorage or the host
 * record: material text lives in the tab and in the one request that uses it. Reloading the page empties it, and the
 * panel says so. The file NAMES are a different thing: they are recorded on the course exactly as typed names are.
 *
 * Files are chosen at the naming question, before the course (and so its id) exists. They wait in a single
 * "for the course being recorded" slot, tagged with the words the teacher typed for it, and the first view of a
 * course with those same words claims them.
 */
import type { ExtractedKind } from "./extract.types";

export interface HeldFile { name: string; kind: ExtractedKind; text: string; chars: number }

const byCourse = new Map<string, HeldFile[]>();
let waiting: { title: string; owner: string; files: HeldFile[] } | null = null;
let active: string | null = null;

const copy = (files: HeldFile[]): HeldFile[] => files.map((f) => ({ ...f }));
const same = (a: string, b: string) => a.trim() === b.trim();

/** Replace what this tab holds for a course (an empty list forgets it). */
export function keepForCourse(courseId: string, files: HeldFile[]): void {
  if (files.length === 0) byCourse.delete(courseId); else byCourse.set(courseId, copy(files));
  active = courseId;
}

/** What this tab holds for a course. A copy: callers cannot change the store. */
export function heldFor(courseId: string): HeldFile[] {
  return copy(byCourse.get(courseId) ?? []);
}

/** Files chosen while naming a new course. An empty list clears an earlier, unclaimed one. */
export function holdForNewCourse(course: { title: string; owner: string }, files: HeldFile[]): void {
  waiting = files.length === 0 ? null : { title: course.title, owner: course.owner, files: copy(files) };
}

/** A course view appeared: if it is the one just recorded (same title, same name), it takes the waiting files, once. */
export function adoptForCourse(course: { courseId: string; title: string; owner: string }): boolean {
  if (!waiting || !same(waiting.title, course.title) || !same(waiting.owner, course.owner)) return false;
  byCourse.set(course.courseId, waiting.files);
  waiting = null;
  active = course.courseId;
  return true;
}

/** The course whose files were last kept or claimed in this tab: for a panel that is not told which course it is in. */
export function activeCourseId(): string | null {
  return active;
}

/** Everything, now (tests, and anywhere the app wants to say it forgot). */
export function forgetEverything(): void {
  byCourse.clear();
  waiting = null;
  active = null;
}
