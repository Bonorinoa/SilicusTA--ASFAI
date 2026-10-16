/**
 * stage.ts — which stage the course page shows expanded.
 *
 * DISPLAY ONLY. Nothing here decides what is allowed: every rule (what may be confirmed, when publishing is
 * possible, what a revision invalidates) stays in the host, and this reads the host's own view to choose
 * which card to put in front of the teacher. A wrong answer here costs a teacher a misplaced card; it can
 * never cost a record, because every verb still leaves as an intent and the gate still decides.
 */
import type { HostView } from "../gate/transport";

export type Stage = "intake" | "material" | "objectives" | "plan" | "publish" | "published";

/** The order a teacher meets them in. */
export const STAGE_ORDER: readonly Stage[] = ["intake", "material", "objectives", "plan", "publish", "published"];

export function stageOf(v: HostView): Stage {
  const status = (id: string) => v.checkpoints[id]?.status;

  // 1-2. Material list and outline: the correspondence that starts the course.
  if (status("files") !== "confirmed" || status("outline") !== "confirmed") return "intake";

  // 3. Objectives. With nothing proposed yet, the teacher either hands over material or asks Silicus to list
  //    objectives from their own answers; once anything is proposed, the decisions are the stage.
  if (status("objectives") !== "confirmed") {
    return v.proposals.length === 0 && v.intake.answers?.outcomes_from === "materials" ? "material" : "objectives";
  }

  // 4. Plan: none yet, a draft, or one that cites an objective the teacher revoked.
  if (!v.plan || v.plan.status !== "confirmed") return "plan";

  // 5-6. Nothing sealed: the publish stage (also where the reasons are said when the host will not seal yet).
  if (v.versions.length === 0) return "publish";
  // Something is sealed. It is "published" only while nothing is pending; a revision in progress, or the host
  // reopening the publish checkpoint, means the teacher is drafting the next version.
  const pending = status("publish") === "pending" || v.revision?.drafting === true;
  return pending ? "publish" : "published";
}
