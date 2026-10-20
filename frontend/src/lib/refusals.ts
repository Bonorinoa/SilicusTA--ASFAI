/**
 * refusals.ts — every refusal the studio can show, in three plain parts (R5, sprint 2026-10-19).
 *
 *   what   what happened, in the teacher's words
 *   saved  whether anything was saved on the course, or sent to the model
 *   next   the ONE next action (retry, add a source, enter the passcode, write your own, …)
 *
 * The host's own message never stands in for these; it goes into a closed "Details" disclosure. The CODE picks
 * the entry, never the message (the one exception: PASSCODE_REQUIRED covers a wrong code, a dismissed prompt
 * and a prompt that could not open, which the site tells apart only by its sentence; see `passcodeVariant`).
 * An unknown code falls back to a generic entry that still names what to try. Display only: nothing here
 * decides; the host did, and this only says so.
 */

/** What the teacher was doing when the host refused. Picks the generic wording; the code picks the rest. */
export type Act = "propose" | "suggest" | "plan" | "decide" | "confirm" | "brief" | "publish" | "ask" | "create" | "check" | "other";

export interface RefusalText { what: string; saved: string; next: string; /** A different next action for one act. */ nextFor?: Partial<Record<Act, string>> }
export interface Explained extends RefusalText {
  /** The refusal's code, for tests and the table; never shown on a teacher screen. */
  code: string;
  /** The host's own message, for the closed Details disclosure ("" when there is none). */
  details: string;
}

/** The codes contract §3 names. The table below must cover every one of them (refusals.test.ts iterates this). */
export const CONTRACT_CODES = [
  "WORKER_NOT_CONFIGURED", "WORKER_UNREACHABLE", "WORKER_BAD_OUTPUT", "WORKER_TRUNCATED", "WORKER_FAILED",
  "NO_MATERIALS", "MATERIAL_ROUND_PENDING", "ALREADY_PROPOSED", "NO_TEACHER_OUTCOMES", "OBJECTIVES_CONFIRMED",
  "OBJECTIVES_AUTO", "PROPOSE_FIRST", "SUGGESTIONS_PENDING", "NO_USABLE_SUGGESTIONS", "OBJECTIVES_PENDING",
  "NO_OBJECTIVES", "PASSCODE_REQUIRED", "PASSCODE_CANCELLED", "RATE_LIMITED", "URL_UNREACHABLE",
] as const;

const NOTHING_ADDED = "Nothing was added to your course.";
const NOTHING_SENT = "Nothing was sent to the model, and nothing on your course changed.";
const NOTHING_CHANGED = "Nothing on your course changed.";

export const REFUSALS: Readonly<Record<string, RefusalText>> = {
  // ---- the drafting model
  WORKER_NOT_CONFIGURED: {
    what: "AI drafting isn’t set up here, so Silicus couldn’t ask the model.",
    saved: NOTHING_SENT,
    next: "Write your own objectives, or use the answers from your brief. Everything else still works.",
    nextFor: {
      plan: "A plan needs AI drafting. Ask whoever runs Silicus for you to switch it on.",
      suggest: "Write your own objectives instead. Everything else still works.",
      ask: "Rehearsing needs AI drafting. Ask whoever runs Silicus for you to switch it on.",
    },
  },
  WORKER_UNREACHABLE: {
    what: "Silicus couldn’t reach the drafting model, or it did not answer in time.",
    saved: NOTHING_ADDED,
    next: "Try again in a minute. If it keeps happening, open AI status at the top.",
  },
  WORKER_BAD_OUTPUT: {
    what: "The model answered, but its answer couldn’t be used.",
    saved: NOTHING_ADDED,
    next: "Try again; models vary from one answer to the next.",
  },
  WORKER_TRUNCATED: {
    what: "The model ran out of room before it finished.",
    saved: NOTHING_ADDED,
    next: "Try again with fewer sources, or paste only the part you want used.",
  },
  WORKER_FAILED: {
    what: "Something went wrong while the model was drafting.",
    saved: NOTHING_ADDED,
    next: "Try again. If it keeps happening, open Details and pass it on to whoever runs Silicus for you.",
  },
  MODEL_NO_CREDITS: {
    what: "The AI service is out of credit, so it can’t draft right now.",
    saved: NOTHING_ADDED,
    next: "Write your own objectives for now, or try again later.",
    nextFor: { plan: "Try again later. Nothing you have recorded is affected.", ask: "Try again later." },
  },
  TOO_LARGE: {
    what: "That is more than the model can take at once.",
    saved: NOTHING_SENT,
    next: "Remove a source, or paste only the part you want used.",
  },
  RATE_LIMITED: {
    what: "The AI is busy: too many requests just now.",
    saved: NOTHING_SENT,
    next: "Wait a minute, then try again.",
  },

  // ---- the demo passcode (online build)
  PASSCODE_REQUIRED: {
    what: "The demo passcode was not accepted.",
    saved: NOTHING_SENT,
    next: "Try again and enter the passcode you were given.",
  },
  PASSCODE_CANCELLED: {
    what: "AI drafting needs the demo passcode, and the prompt was closed.",
    saved: NOTHING_SENT,
    next: "Enter the passcode when you are ready, or write your own objectives.",
    nextFor: { plan: "Enter the passcode when you are ready, then draft the plan.", ask: "Enter the passcode when you are ready, then ask again." },
  },
  PASSCODE_DIALOG: {
    what: "The passcode box couldn’t open.",
    saved: NOTHING_SENT,
    next: "Reload the page and try again. Your course is kept in this browser.",
  },

  // ---- sources
  NO_MATERIALS: {
    what: "There was no readable source to propose from.",
    saved: NOTHING_SENT,
    next: "Add a file, some text or a web page under Sources, or write your own objectives.",
  },
  URL_UNREACHABLE: {
    what: "Silicus couldn’t read that web page.",
    saved: NOTHING_ADDED,
    next: "Check the address, or copy the page’s text and paste it as a source.",
  },
  URL_REFUSED: {
    what: "That address can’t be read: only public https web pages can.",
    saved: NOTHING_ADDED,
    next: "Copy the page’s text and paste it as a source instead.",
  },
  YOUTUBE_LOCAL_ONLY: {
    what: "YouTube captions can only be read by the local Silicus app.",
    saved: NOTHING_ADDED,
    next: "Paste the video’s transcript as text instead.",
  },
  FETCH_NOT_CONFIGURED: {
    what: "Reading web pages isn’t set up on this site.",
    saved: NOTHING_ADDED,
    next: "Copy the page’s text and paste it as a source instead.",
  },

  // ---- objectives: rounds and order
  ALREADY_PROPOSED: {
    what: "Earlier proposals are still waiting for your decision, or this kind of round has already run.",
    saved: NOTHING_SENT,
    next: "Accept, edit or drop the proposals waiting first, or write your own.",
  },
  MATERIAL_ROUND_PENDING: {
    what: "Proposals from your sources are still waiting for your decision.",
    saved: NOTHING_SENT,
    next: "Accept, edit or drop each one, then ask again.",
  },
  NO_TEACHER_OUTCOMES: {
    what: "Your brief has no outcomes of your own to start from.",
    saved: NOTHING_CHANGED,
    next: "Write an objective of your own, or propose from your sources.",
  },
  OBJECTIVES_CONFIRMED: {
    what: "Your objectives are already confirmed, so nothing new can be proposed.",
    saved: NOTHING_CHANGED,
    next: "Go on to the plan. Rewording an objective keeps the plan.",
  },
  OBJECTIVES_AUTO: {
    what: "This course confirms its objectives by itself once every proposal is decided.",
    saved: NOTHING_CHANGED,
    next: "Decide each proposal; there is no separate confirm on this course.",
  },
  OBJECTIVES_PENDING: {
    what: "A proposal is still waiting for your decision, so the objectives can’t be confirmed yet.",
    saved: NOTHING_CHANGED,
    next: "Accept, edit or drop each proposal under Proposals, then confirm.",
  },
  NO_OBJECTIVES: {
    what: "No objective is decided yet, so there is nothing to confirm.",
    saved: NOTHING_CHANGED,
    next: "Write one of your own, or accept a proposal, then confirm.",
  },
  PROPOSE_FIRST: {
    what: "Suggestions round out a first set, and there isn’t one yet.",
    saved: NOTHING_SENT,
    next: "Propose from your answers or your sources first.",
  },
  SUGGESTIONS_PENDING: {
    what: "The earlier suggestions are still waiting for your decision.",
    saved: NOTHING_SENT,
    next: "Decide those first. Silicus offers one set at a time.",
  },
  NO_USABLE_SUGGESTIONS: {
    what: "Silicus had nothing new to suggest.",
    saved: NOTHING_ADDED,
    next: "Write your own, or carry on: the set you have may be complete.",
  },
  CHECKPOINT_ORDER: {
    what: "An earlier step isn’t confirmed yet.",
    saved: NOTHING_CHANGED,
    next: "Go back to the step marked open in the steps bar and confirm it.",
  },
  NO_CONFIRMED_OBJECTIVES: {
    what: "A plan is drafted from confirmed objectives, and there are none yet.",
    saved: NOTHING_SENT,
    next: "Confirm your objectives first.",
  },
};

/** The generic entry: what the teacher was doing, nothing assumed, and still a next step. */
const ACT_WHAT: Record<Act, string> = {
  propose: "Silicus couldn’t propose objectives.",
  suggest: "Silicus couldn’t suggest more objectives.",
  plan: "Silicus couldn’t draft the lesson plan.",
  decide: "Your decision wasn’t recorded.",
  confirm: "That wasn’t confirmed.",
  brief: "The brief wasn’t confirmed.",
  publish: "The course wasn’t published.",
  ask: "The question wasn’t answered.",
  create: "The course wasn’t created.",
  check: "The record couldn’t be checked.",
  other: "That didn’t go through.",
};
const ACT_SAVED: Record<Act, string> = {
  propose: NOTHING_ADDED, suggest: NOTHING_ADDED, plan: "No plan was added to your course.",
  decide: NOTHING_CHANGED, confirm: NOTHING_CHANGED, brief: "Anything recorded before this step is kept.",
  publish: "No new version was published.", ask: "Nothing was recorded; a rehearsal is never kept.",
  create: "Nothing was recorded.", check: NOTHING_CHANGED, other: NOTHING_CHANGED,
};
export function fallbackRefusal(act: Act = "other"): RefusalText {
  return { what: ACT_WHAT[act], saved: ACT_SAVED[act], next: "Try again. If it happens again, open Details below and pass it on to whoever runs Silicus for you." };
}

const sentence = (m: string) => { const t = m.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : ""; };

/** PASSCODE_REQUIRED covers three cases the site tells apart only by its sentence (browser/site.ts). */
export function passcodeVariant(message: string): "PASSCODE_REQUIRED" | "PASSCODE_CANCELLED" | "PASSCODE_DIALOG" {
  if (/not accepted/i.test(message)) return "PASSCODE_REQUIRED";
  if (/could not open/i.test(message)) return "PASSCODE_DIALOG";
  return "PASSCODE_CANCELLED";
}

/** Turn whatever the host threw into the three parts plus the host's own words for Details. */
export function explainRefusal(e: unknown, act: Act = "other"): Explained {
  const raw = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "";
  const message = e instanceof Error ? e.message : e == null ? "" : String(e);
  const code = raw === "PASSCODE_REQUIRED" ? passcodeVariant(message) : raw;
  const entry = REFUSALS[code] ?? fallbackRefusal(act);
  return { what: entry.what, saved: entry.saved, next: entry.nextFor?.[act] ?? entry.next, code: code || "UNKNOWN", details: sentence(message) };
}

/** One line for places that hold a string (the AI status dialog's "Last attempt", older tests). */
export function refusalLine(x: RefusalText): string {
  return `${x.what} ${x.saved} ${x.next}`;
}
