/**
 * harness.ts — the minimal binding between the UI and the REAL confirm-gate
 * core (../../confirm-gate/confirm-gate.mjs, bundled unmodified).
 *
 * Architecture law (from the handoff): components render gate state and
 * dispatch intents; the PARENT wires intents into the gate. This harness is
 * that parent wiring for stories/tests/workbench — it plays the role of the
 * host transport:
 *
 *   UI intent ──▶ TeacherChannel#say (a real recorded teacher turn)
 *            ──▶ gate.confirmObjectives({ provenance citing that turn, ... })
 *
 * There is no path from an intent to a confirmation that skips a recorded
 * teacher turn: the gate rejects anything else with FabricatedConfirmationError
 * (asserted in src/gate/harness.test.ts). The component never sees the gate and
 * never fabricates decisions or provenance.
 */
import { ConfirmGate } from "../../../confirm-gate/confirm-gate.mjs";
import { TurnLedger } from "../../../confirm-gate/host-guard.mjs";
import type {
  CheckpointStatus,
  DecisionIntent,
  DispatchResult,
  LessonPlanView,
  PackageVersionView,
  PlanInvalidationView,
  ProposalStatus,
  ProposalView,
  TimelineEvent,
  VersionChangeView,
} from "./types";

/* ------------------------------ gate surface ------------------------------ */
/* Hand-written view of the gate API we depend on. The .mjs core is plain ESM +
 * JSDoc; we bind through this interface so the UI layer stays fully typed. */

export interface GateProvenance {
  turnRef: string;
  decidedBy: string;
  channel: string;
  decidedAt: number;
}

export interface GateProposalInput {
  kind: "public" | "local";
  publicId?: string;
  statement?: string;
  alignment?: { publicId: string; relationship: "closeMatch" | "relatedTo" | "exactMatch" };
}

export interface GateDecisionInput {
  verb: "accept" | "rename" | "drop" | "add";
  proposalId?: string;
  statement?: string;
}

export interface GateDecisionRecord {
  id: string;
  key: string;
  verb: "accept" | "rename" | "drop" | "add";
  proposalId: string | null;
  targetId: string | null;
  statement?: string;
  renamedFrom?: {
    proposalId: string;
    originalStatement: string | null;
    originalKind: string;
    publicId: string | null;
  };
  provenance: GateProvenance;
  boundCourseVersion: number;
}

export interface GateObjectiveRecord {
  id: string;
  kind: "public" | "local";
  statement?: string;
  publicId?: string;
  alignment?: { publicId: string; relationship: "closeMatch" | "relatedTo" | "exactMatch"; confirmedByEducator: boolean };
  confirmedByEducator: boolean;
  proposedBy: "ai" | "teacher";
  proposedAt: number;
}

export interface GateCheckpointRecord {
  id: string;
  status: string;
  provenance: GateProvenance | null;
  note: string | null;
}

export interface GateLike {
  checkpoints(): Readonly<Record<string, GateCheckpointRecord>>;
  confirmCheckpoint(id: "files" | "outline", provenance: GateProvenance, note?: string): unknown;
  proposeObjectives(items: readonly GateProposalInput[]): readonly GateObjectiveRecord[];
  confirmObjectives(batch: {
    provenance: GateProvenance;
    decisions: readonly GateDecisionInput[];
  }): readonly GateDecisionRecord[];
  decisions(): readonly GateDecisionRecord[];
  confirmedObjectives(): readonly GateObjectiveRecord[];
  getProposal(proposalId: string): GateObjectiveRecord | null;
  getObjective(objectiveId: string): GateObjectiveRecord | null;
  proposeLessonPlan(spec: {
    title: string;
    audience?: { ageRangeStart?: number; ageRangeEnd?: number };
    activities: readonly {
      id?: string;
      title: string;
      minutes: number;
      objectiveIds: readonly string[];
      materialVersionIds?: readonly string[];
      learnerDoes: string;
      teacherDoes: string;
      evidenceIfAny: "none" | "observation" | "work-product";
      notEvidence?: string;
    }[];
  }): LessonPlanView;
  confirmLessonPlan(spec: { planId?: string; provenance: GateProvenance }): LessonPlanView;
  currentPlan(): LessonPlanView | null;
  getPlan(planId: string): LessonPlanView | null;
  publishStatus(): { canPublish: boolean; blockers: readonly string[] };
  publish(spec: { provenance: GateProvenance; note?: string | null }): PackageVersionView;
  versions(): readonly PackageVersionView[];
}

export interface TeacherChannelLike {
  say(text: string, at?: number): string;
}

export interface LedgerLike {
  teacherChannel(identity: { teacherId: string; channel?: string }): TeacherChannelLike;
  getTurn(ref: string): { id: string; role: "teacher" | "assistant"; actorId: string; channel: string; at: number };
  recordAssistantTurn(text: string, options?: { channel?: string; at?: number }): string;
  readonly size: number;
}

/* ------------------------------ proposal meta ----------------------------- */

export interface ProposalSpec {
  statement: string;
  /** Quiet provenance label, e.g. "from your slides p.4". */
  source?: string;
  /** Optional Marble alignment (garnish, never the headline). */
  publicId?: string;
  relationship?: "closeMatch" | "relatedTo" | "exactMatch";
}

export interface HarnessOptions {
  teacherId?: string;
  channel?: string;
  courseId?: string;
  courseTitle?: string;
  clock?: () => number;
}

export interface HarnessSummary {
  proposals: number;
  decided: number;
  awaiting: number;
  allDecided: boolean;
  confirmedObjectives: number;
  decisions: number;
  objectivesCheckpoint: CheckpointStatus;
}

/* --------------------------------- harness -------------------------------- */

export class ConfirmGateHarness {
  readonly gate: GateLike;
  readonly ledger: LedgerLike;
  readonly teacherId: string;
  readonly channel: string;
  readonly courseTitle: string;
  readonly courseId: string;

  #teacher: TeacherChannelLike;
  #clock: () => number;
  #lastAt = 0;
  #revision = 0;
  #listeners = new Set<() => void>();
  #meta = new Map<string, { source: string | null }>();

  constructor(options: HarnessOptions = {}) {
    this.teacherId = options.teacherId ?? "teacher:tk-1";
    this.channel = options.channel ?? "silicus-ui";
    this.courseTitle = options.courseTitle ?? "Lesson 3 · AI literacy";
    this.courseId = options.courseId ?? "urn:uuid:1f9c1f5e-9ab2-4b2f-a0a2-9c0b1a2d3e4f";
    this.#clock = options.clock ?? (() => Date.now());

    this.ledger = new (TurnLedger as unknown as { new (o: { clock: () => number }): LedgerLike })({
      clock: () => this.#tick(),
    });
    this.#teacher = this.ledger.teacherChannel({ teacherId: this.teacherId, channel: this.channel });
    this.gate = new (ConfirmGate as unknown as {
      new (o: {
        courseId: string;
        owner: string;
        title: string;
        ledger: LedgerLike;
        clock: () => number;
      }): GateLike;
    })({
      courseId: this.courseId,
      owner: this.teacherId,
      title: options.courseTitle ?? "Lesson 3 · AI literacy",
      ledger: this.ledger,
      clock: () => this.#tick(),
    });

    // A real course reaches checkpoint 3 only after the teacher confirmed
    // checkpoints 1–2. The harness stands in for that transport moment with
    // genuine recorded teacher turns — never invented ones.
    this.#confirmPrerequisite("files", "Confirm the material list for this course.");
    this.#confirmPrerequisite("outline", "Confirm the lesson outline.");
  }

  /* ----------------------------- store plumbing --------------------------- */

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Snapshot token for useSyncExternalStore. */
  revision(): number {
    return this.#revision;
  }

  #bump(): void {
    this.#revision += 1;
    for (const l of this.#listeners) l();
  }

  /** Monotonic event clock: decisions can never predate what they decide. */
  #tick(): number {
    const at = Math.max(this.#clock(), this.#lastAt + 1);
    this.#lastAt = at;
    return at;
  }

  #confirmPrerequisite(id: "files" | "outline", text: string): void {
    const at = this.#tick();
    const turnRef = this.#teacher.say(text, at);
    this.gate.confirmCheckpoint(id, {
      turnRef,
      decidedBy: this.teacherId,
      channel: this.channel,
      decidedAt: at,
    });
    this.#bump();
  }

  /* -------------------------------- actions ------------------------------- */

  /** The AI proposes. Never confirmed here — see gate `confirmedByEducator: false`. */
  propose(items: readonly ProposalSpec[]): readonly GateObjectiveRecord[] {
    const created = this.gate.proposeObjectives(
      items.map((item) => ({
        kind: item.publicId ? ("public" as const) : ("local" as const),
        statement: item.statement,
        publicId: item.publicId,
        alignment: item.publicId
          ? { publicId: item.publicId, relationship: item.relationship ?? "closeMatch" }
          : undefined,
      })),
    );
    created.forEach((record, i) => {
      this.#meta.set(record.id, { source: items[i]?.source ?? null });
    });
    this.#bump();
    return created;
  }

  /**
   * Record a genuine teacher turn (the host-transport moment) and return
   * validated-shape provenance citing it. Only the parent/harness calls this —
   * components never mint provenance.
   */
  recordTeacherTurn(text: string): GateProvenance {
    const at = this.#tick();
    const turnRef = this.#teacher.say(text, at);
    return { turnRef, decidedBy: this.teacherId, channel: this.channel, decidedAt: at };
  }

  /** Parent-side checkpoint-4 action: teacher turn + `gate.confirmLessonPlan`. */
  confirmPlan(text = "Confirm this lesson plan."): LessonPlanView {
    const provenance = this.recordTeacherTurn(text);
    const plan = this.gate.confirmLessonPlan({ provenance });
    this.#bump();
    return plan;
  }

  /**
   * Parent-side checkpoint-5 action: teacher turn + `gate.publish`. The AI
   * never publishes — this fires AFTER a real teacher turn is recorded, and
   * the gate rejects any provenance that does not cite one.
   */
  publishCourse(note?: string): DispatchResult & { version?: number } {
    const trimmed = note?.trim();
    try {
      const provenance = this.recordTeacherTurn(
        trimmed ? `Publish the course package. Note: ${trimmed}` : "Publish the course package.",
      );
      const record = this.gate.publish({ provenance, note: trimmed || null });
      this.#bump();
      return { ok: true, turnRef: provenance.turnRef, version: record.version };
    } catch (err) {
      this.#bump();
      const e = err as Error & { code?: string };
      return { ok: false, code: e.code ?? "PUBLISH_GATE_ERROR", message: e.message };
    }
  }

  /** All sealed CoursePackage versions, oldest first (the gate's immutable history). */
  publishedVersions(): readonly PackageVersionView[] {
    return this.gate.versions();
  }

  /**
   * The current human wording of an objective id, resolved from the decision
   * trail first (a rename carries the teacher's wording), then the proposal
   * registry (dropped proposals still live there and are unreachable via
   * getObjective), then the confirmed record, then the id itself.
   */
  objectiveWording(id: string): string {
    const decisions = this.gate.decisions();
    const latest = [...decisions]
      .reverse()
      .find(
        (d) =>
          d.statement &&
          (d.verb === "rename" || d.verb === "add") &&
          (d.proposalId === id || d.targetId === id),
      );
    if (latest?.statement) return latest.statement;
    const proposal = this.gate.getProposal(id);
    if (proposal?.statement) return proposal.statement;
    const rec = this.gate.getObjective(id);
    return rec?.statement ?? proposal?.publicId ?? rec?.publicId ?? id;
  }

  /**
   * WHY the current plan is invalidated (D): the objectives it still cites
   * that are no longer in the confirmed set, and the activities citing them.
   * Derived from real gate state — the gate keeps the plan status but the
   * reason must be read from the citations.
   */
  planInvalidation(): PlanInvalidationView {
    const plan = this.gate.currentPlan();
    if (!plan || plan.status !== "invalidated") return { invalidated: false, gaps: [] };
    const confirmed = new Set(this.gate.confirmedObjectives().map((o) => o.id));
    const gaps: { id: string; statement: string; citedIn: string[] }[] = [];
    for (const activity of plan.activities) {
      for (const objId of activity.objectiveIds) {
        if (confirmed.has(objId)) continue;
        let gap = gaps.find((g) => g.id === objId);
        if (!gap) {
          gap = {
            id: objId,
            statement: this.objectiveWording(objId),
            citedIn: [],
          };
          gaps.push(gap);
        }
        gap.citedIn.push(activity.title);
      }
    }
    return { invalidated: true, gaps };
  }

  /**
   * Immutable version diffs (D): for every sealed version, what was added or
   * removed versus its predecessor — the `what changed since version N` view.
   * Computed from the gate's frozen version records, never re-created.
   */
  versionChanges(): VersionChangeView[] {
    const versions = this.gate.versions();
    return versions.map((v, i) => {
      const prev = i === 0 ? null : versions[i - 1];
      const prevIds = new Set((prev?.objectiveRefs ?? []).map((o) => o.id));
      const currIds = new Set(v.objectiveRefs.map((o) => o.id));
      const word = (o: { statement?: string; publicId?: string; id: string }) =>
        o.statement ?? o.publicId ?? o.id;
      return {
        version: v.version,
        previousVersion: v.previousVersion,
        added: v.objectiveRefs.filter((o) => !prevIds.has(o.id)).map(word),
        removed: (prev?.objectiveRefs ?? [])
          .filter((o) => !currIds.has(o.id))
          .map(word),
      };
    });
  }

  /**
   * The append-only audit trail as a single chronological view: checkpoint
   * confirmations (files/outline/plan), every teacher decision, and every
   * sealed version. Derived from REAL gate records — nothing is re-created.
   */
  timeline(): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    for (const id of ["files", "outline", "plan"] as const) {
      const cp = this.gate.checkpoints()[id];
      if (cp.status !== "confirmed" || !cp.provenance) continue;
      events.push({
        id: `checkpoint:${id}`,
        kind: "checkpoint",
        at: cp.provenance.decidedAt,
        label: `Checkpoint confirmed — ${id}`,
        detail: cp.note,
        turnRef: cp.provenance.turnRef,
        decidedBy: cp.provenance.decidedBy,
        channel: cp.provenance.channel,
      });
    }
    for (const d of this.gate.decisions()) {
      const sourceKey = d.verb === "add" ? d.targetId : d.proposalId;
      events.push({
        id: d.id,
        kind: "decision",
        verb: d.verb,
        at: d.provenance.decidedAt,
        label: VERB_LABEL[d.verb],
        detail: d.statement ?? null,
        before: d.renamedFrom?.originalStatement ?? null,
        source: sourceKey ? (this.#meta.get(sourceKey)?.source ?? null) : null,
        version: d.boundCourseVersion,
        turnRef: d.provenance.turnRef,
        decidedBy: d.provenance.decidedBy,
        channel: d.provenance.channel,
      });
    }
    for (const v of this.gate.versions()) {
      events.push({
        id: `publish:${v.version}`,
        kind: "publish",
        at: v.publishedAt,
        label: `Published version ${v.version}`,
        detail: v.note ?? v.title,
        version: v.version,
        turnRef: v.provenance.turnRef,
        decidedBy: v.provenance.decidedBy,
        channel: v.provenance.channel,
      });
    }
    // The harness clock is monotonic, so timestamps are distinct; a stable
    // tie-break keeps the timeline deterministic regardless.
    events.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return events;
  }

  /**
   * A teacher action from the UI. Records a REAL teacher turn first (the
   * host-transport moment), then dispatches the decision into the gate with
   * provenance citing that turn. Returns the gate's decision target ids.
   */
  dispatch(intent: DecisionIntent): DispatchResult & { targetIds?: string[] } {
    const at = this.#tick();
    const turnRef = this.#teacher.say(describeIntent(intent), at);
    const provenance: GateProvenance = {
      turnRef,
      decidedBy: this.teacherId,
      channel: this.channel,
      decidedAt: at,
    };
    const decision: GateDecisionInput =
      intent.verb === "add"
        ? { verb: "add", statement: intent.statement }
        : intent.verb === "rename"
          ? { verb: "rename", proposalId: intent.proposalId, statement: intent.statement }
          : { verb: intent.verb, proposalId: intent.proposalId };
    try {
      const records = this.gate.confirmObjectives({ provenance, decisions: [decision] });
      if (intent.verb === "add") {
        for (const r of records) {
          if (r.targetId) this.#meta.set(r.targetId, { source: "your own objective" });
        }
      }
      this.#bump();
      return {
        ok: true,
        turnRef,
        targetIds: records.map((r) => r.targetId).filter((t): t is string => Boolean(t)),
      };
    } catch (err) {
      this.#bump();
      const e = err as Error & { code?: string };
      return { ok: false, code: e.code ?? "CONFIRM_GATE_ERROR", message: e.message };
    }
  }

  /* -------------------------------- readers ------------------------------- */

  /** Row views derived from REAL gate state (proposals + teacher-added objectives). */
  views(): ProposalView[] {
    const decisions = this.gate.decisions();
    const rows: ProposalView[] = [];
    const seen = new Set<string>();

    // Proposal rows in the order the AI proposed them.
    const proposals = [...this.#meta.keys()]
      .map((id) => this.gate.getProposal(id))
      .filter((p): p is GateObjectiveRecord => p !== null && p.proposedBy === "ai");

    for (const proposal of proposals) {
      seen.add(proposal.id);
      const mine = decisions.filter((d) => d.verb !== "add" && d.proposalId === proposal.id);
      const status = statusOf(mine);
      const rename = [...mine].reverse().find((d) => d.verb === "rename");
      const meta = this.#meta.get(proposal.id);
      const confirmed = status === "proposed" ? null : this.gate.getObjective(proposal.id);
      const alignmentSource = confirmed?.alignment ?? proposal.alignment;
      rows.push({
        id: proposal.id,
        kind: proposal.kind,
        status,
        statement: rename?.statement ?? proposal.statement ?? proposal.publicId ?? "",
        originalStatement: proposal.statement ?? null,
        source: meta?.source ?? null,
        alignment: alignmentSource
          ? {
              publicId: alignmentSource.publicId,
              relationship: alignmentSource.relationship,
              suggested: !alignmentSource.confirmedByEducator,
            }
          : null,
        by: "ai",
      });
    }

    // Teacher-authored objectives (verb: add), in decision order.
    for (const d of decisions) {
      if (d.verb !== "add" || !d.targetId || seen.has(d.targetId)) continue;
      const objective = this.gate.getObjective(d.targetId);
      rows.push({
        id: d.targetId,
        kind: "local",
        status: "added",
        statement: d.statement ?? objective?.statement ?? "",
        originalStatement: null,
        source: this.#meta.get(d.targetId)?.source ?? "your own objective",
        alignment: objective?.alignment
          ? {
              publicId: objective.alignment.publicId,
              relationship: objective.alignment.relationship,
              suggested: !objective.alignment.confirmedByEducator,
            }
          : null,
        by: "teacher",
      });
    }
    return rows;
  }

  summary(): HarnessSummary {
    const rows = this.views();
    const proposals = rows.filter((r) => r.by === "ai");
    const decided = proposals.filter((r) => r.status !== "proposed").length;
    return {
      proposals: proposals.length,
      decided,
      awaiting: proposals.length - decided,
      allDecided: proposals.length > 0 && decided === proposals.length,
      confirmedObjectives: this.gate.confirmedObjectives().length,
      decisions: this.gate.decisions().length,
      objectivesCheckpoint: this.gate.checkpoints().objectives.status as CheckpointStatus,
    };
  }
}

/* -------------------------------- helpers --------------------------------- */

/** Human headline for each decision verb (audit timeline). */
const VERB_LABEL: Record<GateDecisionRecord["verb"], string> = {
  accept: "Accepted",
  rename: "Renamed",
  drop: "Dropped",
  add: "Added",
};

function statusOf(ds: readonly GateDecisionRecord[]): ProposalStatus {
  if (ds.some((d) => d.verb === "drop")) return "dropped";
  if (ds.some((d) => d.verb === "rename")) return "renamed";
  if (ds.some((d) => d.verb === "accept")) return "accepted";
  return "proposed";
}

/** The teacher turn text recorded for an intent (ledger provenance material). */
export function describeIntent(intent: DecisionIntent): string {
  switch (intent.verb) {
    case "accept":
      return `Accept objective (proposal ${intent.proposalId}).`;
    case "rename":
      return `Rename objective (proposal ${intent.proposalId}) to: ${intent.statement}`;
    case "drop":
      return `Drop objective (proposal ${intent.proposalId}).`;
    case "add":
      return `Add objective: ${intent.statement}`;
  }
}
