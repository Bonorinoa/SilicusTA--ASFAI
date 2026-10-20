/**
 * links.ts — the web pages a teacher added for a course, held in this tab only (like material text).
 *
 * A web page is fetched when Silicus reads the sources, never at add time. The list lives in a module
 * Map so the onboarding wizard can hand its pages to the studio it opens; a reload forgets it, exactly
 * as it forgets file text (materials/session.ts). Nothing here touches storage or the record.
 */
const byCourse = new Map<string, string[]>();

export function linksFor(courseId: string): string[] {
  return [...(byCourse.get(courseId) ?? [])];
}

export function keepLinksForCourse(courseId: string, urls: readonly string[]): void {
  if (urls.length === 0) byCourse.delete(courseId); else byCourse.set(courseId, [...urls]);
}

/**
 * The wizard's last click can ask the studio to start "propose from sources" as soon as it lands on
 * Objectives (R7). One flag per course, taken once: a reload or a second visit never re-sends it.
 */
const proposeOnArrival = new Set<string>();

export function askToProposeOnArrival(courseId: string): void {
  proposeOnArrival.add(courseId);
}

export function takeProposeOnArrival(courseId: string): boolean {
  return proposeOnArrival.delete(courseId);
}
