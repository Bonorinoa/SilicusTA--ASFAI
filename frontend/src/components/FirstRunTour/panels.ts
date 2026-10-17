/**
 * panels.ts — the four panels of the first-run tour, as data. Every sentence is written to keep the locks:
 * the AI proposes and the teacher decides; the record is evidence of what was decided, not proof of who decided
 * it; asking a question is never evidence of learning. No panel mentions retention, a model, or a measure of progress.
 */
import type { ActivityActor } from "../../gate/types";

export interface TourPanel {
  title: string;
  /** Sentences, one paragraph each. */
  body: readonly string[];
  /** Only shown when ASFAI is available (the local app). */
  asfai?: string;
  /** Who is on stage in this panel (drawn quietly under the words, tying the tour to the rail). */
  actors: readonly ActivityActor[];
}

export const PANELS: readonly TourPanel[] = [
  {
    title: "You bring the course.",
    body: ["A title, your name for your copy, and the names of your material. That is all it takes to begin."],
    actors: ["teacher"],
  },
  {
    title: "The AI proposes, you decide.",
    body: [
      "A drafting model proposes objectives and drafts a plan. Nothing counts until you accept, rename, drop or add.",
      "You can always see what it was sent.",
    ],
    asfai: "ASFAI can ask its own questions and align to its skill map. It is recommended, never required.",
    actors: ["worker", "teacher"],
  },
  {
    title: "Silicus keeps the record.",
    body: [
      "Every decision is written to an append-only record you can check and export.",
      "It is evidence of what was decided, not proof of who decided it.",
    ],
    actors: ["silicus"],
  },
  {
    title: "Publish, then let students ask.",
    body: [
      "Publishing makes a version that cannot change; changes become the next version.",
      "Students\u2019 questions are answered only from the version you published; asking is never evidence of learning.",
    ],
    actors: ["teacher", "silicus"],
  },
];
