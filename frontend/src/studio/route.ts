/**
 * The studio's routes, kept apart from its screens so the app shell can recognise them without loading the studio.
 *
 *   #/studio               your courses
 *   #/studio/<id>          the course studio: Brief → Objectives → Plan → Publish
 *   #/studio/<id>/rehearse the teacher's student simulator
 *   #/learn/<id>           the student space
 */
export type Route =
  | { page: "home" }
  | { page: "course"; id: string }
  | { page: "rehearse"; id: string }
  | { page: "learn"; id: string };

export function routeOf(hash: string): Route | null {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "learn" && parts[1]) return { page: "learn", id: decodeURIComponent(parts[1]) };
  if (parts[0] !== "studio") return null;
  if (!parts[1]) return { page: "home" };
  const id = decodeURIComponent(parts[1]);
  return parts[2] === "rehearse" ? { page: "rehearse", id } : { page: "course", id };
}

export const href = {
  home: "#/studio",
  course: (id: string) => `#/studio/${encodeURIComponent(id)}`,
  rehearse: (id: string) => `#/studio/${encodeURIComponent(id)}/rehearse`,
  learn: (id: string) => `#/learn/${encodeURIComponent(id)}`,
};
