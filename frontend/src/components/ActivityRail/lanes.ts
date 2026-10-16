/**
 * lanes.ts — the four named lanes of "Behind the scenes", in order, with their wording.
 *
 * The lane is the ACTOR (who did it), not the artifact (what it touched). The blurbs are the product's own
 * promise about each component, so they are written once, here, and reused by the rail and the first-run tour.
 */
import type { ActivityActor } from "../../gate/types";

export interface Lane {
  actor: ActivityActor;
  /** The name the teacher reads. */
  name: string;
  /** What this component does, in a clause. */
  blurb: string;
}

export const LANES: readonly Lane[] = [
  { actor: "teacher", name: "You", blurb: "your decisions" },
  { actor: "silicus", name: "Silicus", blurb: "keeps the record and the rules" },
  { actor: "worker", name: "Drafting model", blurb: "proposes and drafts, never decides" },
  { actor: "asfai", name: "ASFAI", blurb: "asks questions, checks format; local app only" },
];

/** The lanes to draw. ASFAI exists only in the local app; online its lane is not drawn at all. */
export const lanesFor = (asfaiAvailable: boolean): readonly Lane[] => LANES.filter((l) => l.actor !== "asfai" || asfaiAvailable);

export const laneOf = (actor: ActivityActor): Lane => LANES.find((l) => l.actor === actor) ?? LANES[1];
