/**
 * types.ts — TypeScript view types for the confirm-gate core.
 *
 * The gate itself is the real zero-dependency ESM state machine at
 * ../../confirm-gate/confirm-gate.mjs (bundled unmodified; see vite.config.ts).
 * These types describe the VIEW CONTRACT between the gate and the components:
 * components render these and dispatch intents; they never touch the gate
 * directly and never fabricate decisions or provenance.
 */

/** The teacher decision verbs of checkpoint 3 (matches gate `VERBS`). `reword` acts on a CONFIRMED objective. */
export type DecisionVerb = "accept" | "rename" | "drop" | "add" | "reword";

/** Row lifecycle state, derived from real gate decisions. */
export type ProposalStatus = "proposed" | "accepted" | "renamed" | "dropped" | "added";

/** Alignment garnish (Marble `mt_*` reference) — never the headline. */
export interface AlignmentView {
  publicId: string;
  relationship: "closeMatch" | "relatedTo" | "exactMatch";
  /** True until a teacher decision lands on the objective. */
  suggested: boolean;
}

/** One row of the DecisionCard. */
export interface ProposalView {
  /** Stable local `urn:uuid:` id. A rename never changes it. */
  id: string;
  kind: "public" | "local";
  status: ProposalStatus;
  /** Current wording: the proposal's statement, or the teacher's rename/add wording. */
  statement: string;
  /** The statement exactly as proposed (survives renames), or null for `add`. */
  originalStatement: string | null;
  /** Quiet provenance label supplied by the parent, e.g. "from your slides p.4". */
  source: string | null;
  alignment: AlignmentView | null;
  by: "ai" | "teacher";
  /** Host-derived: the current lesson plan cites this objective. Revoking it invalidates that plan. */
  citedByPlan?: boolean;
  /** Host-derived: the teacher reworded this confirmed objective in place (same id). `originalStatement` is then the wording it started with. */
  reworded?: boolean;
}

/**
 * A teacher action. The component's only output verb channel — the parent
 * turns each intent into a real teacher turn (TurnLedger `TeacherChannel`) and
 * a `confirmObjectives` call with validated provenance.
 */
export type DecisionIntent =
  | { verb: "accept"; proposalId: string }
  | { verb: "rename"; proposalId: string; statement: string }
  | { verb: "drop"; proposalId: string }
  | { verb: "add"; statement: string }
  /** A new statement for an already CONFIRMED objective: same id, so plan citations survive. */
  | { verb: "reword"; proposalId: string; statement: string };

/** Gate checkpoint status (checkpoint 3 for the DecisionCard). */
export type CheckpointStatus = "pending" | "open" | "confirmed";

/** Optional expected wait ranges reported by the host, in seconds. */
export interface TypicalSeconds {
  objectives: readonly [number, number];
  plan: readonly [number, number];
  answer: readonly [number, number];
}

/** Result of dispatching an intent through the harness into the gate. */
export type DispatchResult =
  | { ok: true; turnRef: string }
  | { ok: false; code: string; message: string };

/* ----------------------------- PlanCard views ----------------------------- */

export interface ActivityView {
  id: string;
  title: string;
  minutes: number;
  objectiveIds: readonly string[];
  materialVersionIds: readonly string[];
  learnerDoes: string;
  teacherDoes: string;
  evidenceIfAny: "none" | "observation" | "work-product";
  notEvidence?: string;
}

/**
 * An alignment SUGGESTION the drafting worker cited: a reference to a node in a knowledge
 * source, never a claim and never part of the sealed package. The host keeps refs and labels
 * only (not the retrieved text). `verified` is true only when the source actually checked it.
 */
export interface PlanCitationView {
  ref: string;
  label: string;
  /** Machine id of the source, e.g. "asfai-graph" or "local-ontology". */
  source: string;
  /** Zero-based indexes into the plan's activities. */
  activityIndexes: readonly number[];
  verified: boolean;
}

/** A `LessonPlanRecord` from the gate, structurally. */
export interface LessonPlanView {
  id: string;
  courseId: string;
  courseVersion: number;
  title: string;
  audience?: { ageRangeStart?: number; ageRangeEnd?: number };
  status: "draft" | "confirmed" | "invalidated";
  activities: readonly ActivityView[];
  proposedBy: "ai";
  proposedAt: number;
  /** Alignment suggestions the worker cited (host metadata; absent when it cited none). */
  citations?: readonly PlanCitationView[];
}

/** A confirmed objective as cited by plan activities. */
export interface ObjectiveCiteView {
  id: string;
  kind: "public" | "local";
  statement: string;
  publicId?: string;
  alignment?: { publicId: string; relationship: string };
}

/* ------------------------ Publish (checkpoint 5) views -------------------- */

/** Teacher provenance, as recorded by the gate (who/verb/before/after/provenance). */
export interface ProvenanceView {
  turnRef: string;
  decidedBy: string;
  channel: string;
  decidedAt: number;
}

/** `publishStatus()` / `publishBlockers()` from the gate. */
export interface PublishStatusView {
  canPublish: boolean;
  blockers: readonly string[];
  /**
   * The same blockers, classified by the HOST so the UI can say them in plain words (contract 2026-10-16).
   * One entry per `blockers` entry, same order. `OTHER` carries the gate's raw text for a blocker the host
   * does not recognise, so a new gate rule is never silently dropped. Absent on an older host.
   */
  reasons?: readonly PublishReason[];
}

export type PublishReason =
  | { code: "CHECKPOINT_UNCONFIRMED"; checkpoint: "files" | "outline" | "objectives" }
  | { code: "UNDECIDED_PROPOSALS"; count: number }
  | { code: "NO_CONFIRMED_PLAN" }
  | { code: "PLAN_INVALIDATED" }
  | { code: "PLAN_EMPTY" }
  | { code: "PLAN_CITES_UNCONFIRMED"; count: number }
  | { code: "OTHER"; text: string };

/** Who did something to the course: the teacher, Silicus itself, the drafting model, or ASFAI. */
export type ActivityActor = "teacher" | "silicus" | "worker" | "asfai";

/**
 * One thing a component did, derived by the HOST from the course's event log (contract 2026-10-16).
 * It is what makes the background work visible: every row names its actor and the artifact it changed.
 * `facts` hold counts, names and flags only — never material text, never a passcode, never a key.
 */
export interface ActivityItem {
  /** 1-based position in the event log; stable and unique within a course. */
  seq: number;
  /** Epoch ms. */
  at: number;
  actor: ActivityActor;
  action:
    | "course.created"
    | "checkpoint.confirmed"
    | "intake.asked"
    | "intake.answered"
    | "intake.sent"
    | "objectives.derived"
    | "objectives.drafted"
    | "objectives.decided"
    | "plan.drafted"
    | "plan.checked"
    | "plan.confirmed"
    | "package.sealed";
  artifact: "record" | "outline" | "objectives" | "plan" | "package";
  facts: Readonly<Record<string, string | number | boolean>>;
}

/** A published `CoursePackage` version record (immutable, from the gate). */
export interface PackageVersionView {
  courseId: string;
  version: number;
  previousVersion: number | null;
  title: string;
  owner: string;
  status: "published";
  objectiveRefs: readonly {
    id: string;
    kind: "public" | "local";
    statement?: string;
    publicId?: string;
  }[];
  lessonPlan: LessonPlanView | null;
  publishedAt: number;
  note: string | null;
  provenance: ProvenanceView;
}

/* --------------------------- Audit trail views ---------------------------- */

export type TimelineEventKind = "checkpoint" | "decision" | "publish";

/* --------------------- Invalidation & re-confirm views (D) ---------------- */

/** An objective an invalidated plan still cites but is no longer confirmed. */
export interface CitedObjectiveGap {
  id: string;
  /** The objective's wording (or publicId as a last resort). */
  statement: string;
  /** Activity titles citing it. */
  citedIn: readonly string[];
}

/** Why the current lesson plan is invalidated, derived from gate state. */
export interface PlanInvalidationView {
  invalidated: boolean;
  gaps: readonly CitedObjectiveGap[];
}

/** What a sealed version added/removed versus its predecessor (immutable diff). */
export interface VersionChangeView {
  version: number;
  previousVersion: number | null;
  added: readonly string[];
  removed: readonly string[];
}

/** One node of the append-only audit timeline, derived from REAL gate state. */
export interface TimelineEvent {
  /** Stable event id (decision record id, checkpoint id, or `publish:N`). */
  id: string;
  kind: TimelineEventKind;
  /** Decision events only: the verb that was decided. */
  verb?: "accept" | "rename" | "drop" | "add" | "reword";
  /** Epoch ms; the timeline is sorted by this. */
  at: number;
  /** Human headline: "Accepted", "Checkpoint confirmed — files", "Published version 2". */
  label: string;
  /** The wording/note the event is about (null for a bare checkpoint). */
  detail?: string | null;
  /** rename: the original statement, before the teacher's rewording. reword: the wording it replaced. */
  before?: string | null;
  /** Quiet provenance garnish (e.g. "from your slides p.4"), when the parent has it. */
  source?: string | null;
  /** Course-version this event is bound to (decisions), or the sealed version (publish). */
  version?: number;
  turnRef: string;
  decidedBy?: string;
  channel?: string;
}
