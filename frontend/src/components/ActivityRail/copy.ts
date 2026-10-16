/**
 * copy.ts — everything the rail SAYS about a row, as pure functions of the host's `ActivityItem`.
 *
 * The sentence is a verb phrase: the actor is named beside it, so it never repeats who did it. It is built
 * from `action` plus the numbers in `facts`. A fact that is missing or malformed drops its clause; nothing is
 * ever guessed, and no count is printed that the host did not send. Every count goes through plural().
 *
 * `facts` keys this file reads (the host contract names the kinds of fact, not the keys; these are the keys):
 *   checkpoint.confirmed  checkpoint: "files" | "outline" | "objectives" | "plan"
 *   intake.asked          questions: number
 *   objectives.derived    count: number
 *   objectives.drafted    count: number, materials: number
 *   objectives.suggested  count: number
 *   objectives.decided    accepted, renamed, dropped, added: number
 *   plan.drafted          activities: number
 *   plan.checked          valid: boolean, issues: number
 *   package.sealed        version: number
 * Material NAMES and objective wording are deliberately not read: the rail is a reading aid, not a second copy.
 *
 * Locks: the drafting model "drafts" and "proposes", never "confirms" or "decides"; the record is never
 * "verified" or "secure"; ASFAI's format check is reported as what it reported, never as an approval.
 */
import type { ActivityItem } from "../../gate/types";
import { plural } from "../../lib/plural";

type Facts = ActivityItem["facts"];

/** A whole, non-negative number the host sent; anything else is "not known". */
function num(facts: Facts, key: string): number | null {
  const v = facts[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

const CHECKPOINT_PHRASE: Readonly<Record<string, string>> = {
  files: "Confirmed the material list",
  outline: "Confirmed the brief", // the gate's checkpoint is `outline`; the teacher's word is the glossary's: brief
  objectives: "Confirmed the objectives",
  plan: "Confirmed the lesson plan",
};

export function sentenceOf(it: Pick<ActivityItem, "action" | "facts"> & Partial<ActivityItem>): string {
  const { action, facts } = it;
  switch (action) {
    case "course.created":
      return "Started this course";
    case "checkpoint.confirmed": {
      const c = facts.checkpoint;
      return (typeof c === "string" && CHECKPOINT_PHRASE[c]) || "Confirmed a step";
    }
    case "intake.asked": {
      const n = num(facts, "questions");
      return n === null ? "Asked questions about your course" : `Asked ${plural(n, "question")} about your course`;
    }
    case "intake.answered":
      return "Answered the questions";
    case "intake.sent":
      return "Reported that your answers are enough to start drafting";
    case "objectives.derived": {
      const n = num(facts, "count");
      return n === null ? "Listed objectives from your own answers" : `Listed ${plural(n, "objective")} from your own answers`;
    }
    case "objectives.drafted": {
      const n = num(facts, "count");
      const m = num(facts, "materials");
      const what = n === null ? "Drafted objectives" : `Drafted ${plural(n, "objective")}`;
      return m === null ? what : `${what} from ${plural(m, "material")}`;
    }
    case "objectives.suggested": {
      const n = num(facts, "count");
      return n === null ? "Suggested objectives to round out yours" : `Suggested ${plural(n, "objective")} to round out yours`;
    }
    case "objectives.decided": {
      const parts = (["accepted", "renamed", "dropped", "added"] as const)
        .flatMap((verb) => { const n = num(facts, verb); return n !== null && n > 0 ? [`${n.toLocaleString("en-US")} ${verb}`] : []; });
      return parts.length > 0 ? `Your decisions: ${parts.join(", ")}` : "Decided on the proposed objectives";
    }
    case "plan.drafted": {
      const n = num(facts, "activities");
      return n === null ? "Drafted a lesson plan" : `Drafted a lesson plan with ${plural(n, "activity", "activities")}`;
    }
    case "plan.checked": {
      const head = "Checked the plan\u2019s format";
      if (facts.valid === true) return `${head}: no problems reported`;
      const n = facts.valid === false ? num(facts, "issues") : null;
      return n !== null && n > 0 ? `${head}: ${plural(n, "problem")} reported` : head;
    }
    case "plan.confirmed":
      return "Confirmed the lesson plan";
    case "package.sealed": {
      const v = num(facts, "version");
      return v === null ? "Published a version for students" : `Published version ${v}`; // glossary: "sealed" appears only in the publish confirmation
    }
    default:
      return "Did something to the course"; // an action this build does not know: say so, never guess
  }
}

/** The tag on a row: the glossary's stage vocabulary (Material, Brief, Objectives, Plan, Version). The host's artifact ids stay as they are. */
export const ARTIFACT_LABEL: Readonly<Record<ActivityItem["artifact"], string>> = {
  record: "Material",
  outline: "Brief",
  objectives: "Objectives",
  plan: "Plan",
  package: "Version",
};

/** "just now", "5 minutes ago", "1 hour ago", "2 days ago". A clock a little ahead of the host is still "just now". */
export function relativeTime(at: number, now: number): string {
  const s = Math.floor((now - at) / 1000);
  if (!Number.isFinite(s) || s < 45) return "just now";
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${plural(min, "minute")} ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

/** "13:05" (24-hour, local): what a row says when every row would say "just now". With `seconds`, "13:05:12", for rows that share a minute. */
export const clockTime = (at: number, seconds = false): string =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });

/** A full local date and time for the `title` of a row, so the exact moment is one hover away. */
export const exactTime = (at: number): string => new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
