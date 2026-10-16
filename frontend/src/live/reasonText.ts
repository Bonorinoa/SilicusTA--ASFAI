/**
 * reasonText.ts — the ONE table that turns the host's publish-blocker codes into sentences for a teacher (D3).
 *
 * The host classifies each blocker (`publish.reasons`, same order as `publish.blockers`); the gate's own
 * strings stay the source of truth and are kept in the Record details disclosure. A code this build does not
 * know is shown as the gate wrote it (OTHER), never dropped.
 */
import type { PublishReason, PublishStatusView } from "../gate/types";
import { plural } from "../lib/plural";

const sentenceCase = (t: string): string => { const s = t.trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

export function reasonText(r: PublishReason): string {
  switch (r.code) {
    case "CHECKPOINT_UNCONFIRMED":
      return r.checkpoint === "files" ? "Confirm the material list" : r.checkpoint === "outline" ? "Confirm the brief" : "Decide every proposed objective";
    case "UNDECIDED_PROPOSALS":
      return r.count === 1 ? "Decide the proposed objective still waiting" : `Decide the ${plural(r.count, "proposed objective")} still waiting`;
    case "NO_CONFIRMED_PLAN":
      return "Confirm a lesson plan";
    case "PLAN_INVALIDATED":
      return "Re-confirm the plan: it cites an objective you revoked";
    case "PLAN_EMPTY":
      return "The plan has no activities";
    case "PLAN_CITES_UNCONFIRMED":
      return r.count === 1 ? "The plan cites an objective you have not confirmed" : `The plan cites ${r.count.toLocaleString("en-US")} objectives you have not confirmed`;
    case "OTHER":
      return sentenceCase(r.text);
    default:
      // A code from a newer host than this build: say that something needs attention rather than nothing.
      return "Something else needs your attention";
  }
}

/**
 * The lines a publish card shows. The host's reasons when they line up one-to-one with its blockers; otherwise
 * (an older host, or a mismatch we should not trust) the gate's raw blockers, as before. Several "cites an
 * unconfirmed objective" blockers (one per objective) are counted into one line, not repeated.
 */
export function reasonsFor(status: PublishStatusView): string[] {
  const { blockers, reasons } = status;
  if (!reasons || reasons.length !== blockers.length) return [...blockers];
  const lines: string[] = [];
  let cites = 0;
  let citesAt = -1;
  for (const r of reasons) {
    if (r.code === "PLAN_CITES_UNCONFIRMED") {
      if (citesAt < 0) { citesAt = lines.length; lines.push(""); }
      cites += r.count;
    } else {
      const line = reasonText(r);
      if (!lines.includes(line)) lines.push(line);
    }
  }
  if (citesAt >= 0) lines[citesAt] = reasonText({ code: "PLAN_CITES_UNCONFIRMED", count: cites });
  return lines;
}
