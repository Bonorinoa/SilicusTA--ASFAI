/**
 * course.mjs — the host-side course session: the real transport.
 *
 * This is the seam Sprint 1 exists for. The session owns the TurnLedger and the
 * ConfirmGate for one course, and it is the ONLY party that mints a
 * TeacherChannel: it does so inside the inbound-message hook, once per teacher
 * message. The public API therefore accepts an INTENT (a verb, a statement) and
 * NEVER provenance — there is no HTTP or JS field through which a caller (the
 * UI, a model, a test) can hand in a turn reference. Provenance is constructed
 * here, from the turn this session just recorded.
 *
 * Durability is event-sourcing: every mutation is one event appended to the
 * course's hash-chained log; `load()` rebuilds the live gate by replaying the
 * log. Replay is exact because the gate's `idFactory` and clock are both
 * deterministic and driven from the log (see confirm-gate/test/persistence).
 *
 * Known S1 gap: checkpoint 2 (`outline`) is NOT yet bound to an observed ASFAI
 * `draftAuthorization`. Binding it requires the real `asfai_lesson`
 * prepare_outline round-trip (Sprint 2); wiring host-guard's ResidualRuleGuard
 * before that would make the flow unreachable without inventing server state.
 */
import { randomUUID } from "node:crypto";
import { ConfirmGate, deterministicIdFactory } from "../confirm-gate/confirm-gate.mjs";
import { TurnLedger } from "../confirm-gate/host-guard.mjs";
import { CourseStore } from "./store.mjs";
import { LessonIntake } from "./intake.mjs";
import { digestOf } from "./archive.mjs";

const CHANNEL = "silicus-ui";

/** The course's event log does not verify. The record is refused, never patched. */
export class CourseIntegrityError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(`refusing to serve this course: its event log does not verify (${reason})`);
    this.name = "CourseIntegrityError";
    this.code = "LOG_INTEGRITY";
    this.reason = reason;
  }
}

export class CourseSession {
  /** Register a NEW course (a fresh per-course id seed) and return its session. */
  static create(store, { owner, title, description = "", materials = [] } = {}) {
    const courseId = `urn:uuid:${randomUUID()}`;
    const seed = `urn:uuid:${randomUUID()}`;
    store.initCourse({ courseId, owner, title, description, materials, seed, at: Date.now() });
    return CourseSession.load(store, courseId);
  }

  /**
   * Rebuild a course's live session by replaying its VERIFIED event log.
   * Fails CLOSED: a record whose chain does not verify is not served at all.
   * That catches naive edits and mid-log deletions at read time. It cannot catch
   * a self-consistent rewrite (recompute the whole chain from genesis), which
   * needs the head pinned out of band — see README, "Integrity".
   */
  static load(store, courseId) {
    const log = store.log(courseId);
    const ver = log.verify();
    if (!ver.ok) throw new CourseIntegrityError(ver.reason);
    return new CourseSession(store, store.meta(courseId), log);
  }

  constructor(store, meta, log) {
    this.#store = store;
    this.#log = log;
    this.meta = meta;
    this.#now = meta.createdAt;
    this.#ledger = new TurnLedger({ clock: () => this.#now });
    // Checkpoint 2's host-side gate: the ASFAI clarification round, unskippable.
    this.#intake = new LessonIntake({ ledger: this.#ledger, courseId: meta.courseId });
    this.#gate = new ConfirmGate({
      courseId: meta.courseId,
      owner: meta.owner,
      title: meta.title,
      description: meta.description,
      ledger: this.#ledger,
      hostGuard: this.#intake,
      materials: meta.materials ?? [],
      clock: () => this.#now,
      idFactory: deterministicIdFactory(meta.seed),
    });
    for (const record of log.read()) this.#apply(record.event);
  }

  #store;
  #log;
  #now;
  #ledger;
  #gate;
  #intake;
  /** @type {string[]} proposal ids in the order the AI proposed them */
  #proposalIds = [];
  /** @type {Map<string, string>} quiet provenance labels (host metadata, not gate state) */
  #sources = new Map();

  get courseId() { return this.meta.courseId; }

  /**
   * Read-only views of the ledger for this host's own readers. The ledger OBJECT
   * is deliberately not exposed: nothing outside this class can reach
   * `teacherChannel()`, so "only the host transport records a teacher turn" is
   * enforced at this surface rather than merely documented. (SPEC §8's
   * process-integrity limit still applies to code that imports host-guard and
   * builds its own ledger from scratch.)
   */
  turns() {
    return this.#ledger.list();
  }

  turn(ref) {
    return this.#ledger.getTurn(ref);
  }

  isTeacherTurn(ref) {
    return this.#ledger.isTeacherTurn(ref);
  }

  /* ----------------------------- clock + hook ---------------------------- */

  #setNow(at) {
    this.#now = typeof at === "number" ? at : Date.now();
  }

  /**
   * The host transport's inbound-user-message hook. Mints a fresh TeacherChannel
   * capability per real message — the ONLY path to a teacher turn.
   */
  #inbound(text, at) {
    this.#setNow(at);
    const channel = this.#ledger.teacherChannel({ teacherId: this.meta.owner, channel: CHANNEL });
    return channel.say(text, this.#now);
  }

  #prov(turnRef, at) {
    return { turnRef, decidedBy: this.meta.owner, channel: CHANNEL, decidedAt: at };
  }

  #append(event) {
    return this.#log.append(event);
  }

  /** Apply one event to the gate. Used live (once) and by replay (in order). */
  #apply(event) {
    if (event.at !== undefined) this.#setNow(event.at);
    switch (event.kind) {
      case "course.created":
        return;
      case "checkpoint.confirmed": {
        const turnRef = this.#inbound(event.text, event.at);
        this.#gate.confirmCheckpoint(event.id, this.#prov(turnRef, event.at), event.note ?? null);
        return;
      }
      case "intake.observed": {
        this.#intake.observe({
          state: event.state,
          questions: event.questions ?? [],
          draftAuthorization: event.draftAuthorization ?? null,
          receipt: event.receipt ?? null,
          at: event.at,
        });
        return;
      }
      case "intake.answered": {
        const channel = this.#ledger.teacherChannel({ teacherId: this.meta.owner, channel: CHANNEL });
        this.#intake.answer({ viaChannel: channel, text: event.text, at: event.at });
        return;
      }
      case "objectives.proposed": {
        if (event.assistantText) {
          this.#ledger.recordAssistantTurn(event.assistantText, { channel: "model", at: event.at });
        }
        const created = this.#gate.proposeObjectives(event.items);
        created.forEach((record, i) => {
          this.#proposalIds.push(record.id);
          const source = event.sources?.[i];
          if (source) this.#sources.set(record.id, source);
        });
        return;
      }
      case "objectives.decided": {
        const turnRef = this.#inbound(event.text, event.at);
        const records = this.#gate.confirmObjectives({
          provenance: this.#prov(turnRef, event.at),
          decisions: event.decisions,
        });
        for (const r of records) {
          if (r.verb === "add" && r.targetId) this.#sources.set(r.targetId, "your own objective");
        }
        return;
      }
      case "plan.proposed": {
        if (event.assistantText) {
          this.#ledger.recordAssistantTurn(event.assistantText, { channel: "model", at: event.at });
        }
        this.#gate.proposeLessonPlan(event.spec);
        return;
      }
      case "plan.confirmed": {
        const turnRef = this.#inbound(event.text, event.at);
        this.#gate.confirmLessonPlan({
          ...(event.planId ? { planId: event.planId } : {}),
          provenance: this.#prov(turnRef, event.at),
        });
        return;
      }
      case "package.published": {
        const turnRef = this.#inbound(event.text, event.at);
        this.#gate.publish({ provenance: this.#prov(turnRef, event.at), note: event.note ?? null });
        return;
      }
      default:
        throw new Error(`unknown event kind: ${event.kind}`);
    }
  }

  /* ------------------------- mutations (live path) ----------------------- */

  /** Checkpoint 1|2: the teacher confirms the material list or the outline. */
  confirmCheckpoint({ id, text, note = null, at } = {}) {
    if (id !== "files" && id !== "outline") {
      throw new Error(`checkpoint "${id}" is not manually confirmable`);
    }
    const a = at ?? Date.now();
    const event = { kind: "checkpoint.confirmed", id, note, text: requireMsg(text, "text"), at: a };
    this.#apply(event);
    this.#append(event);
    return this.view().checkpoints[id];
  }

  /**
   * Checkpoint 2 input: record an OBSERVED prepare_outline result. The runtime
   * makes the real MCP call (it asks intakeStatus() first); the host records what
   * came back and enforces the residual rule over it. A `clarifying` result
   * surfaces the questions and blocks a second call until the teacher replies.
   */
  observeIntake({ state, questions = [], draftAuthorization = null, receipt = null, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "intake.observed", state, questions, draftAuthorization, receipt, at: a };
    this.#apply(event);
    this.#append(event);
    return this.intakeStatus();
  }

  /** The teacher's reply to the clarifying questions: a REAL turn, and it arms the round. */
  answerIntake({ text, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "intake.answered", text: requireMsg(text, "text"), at: a };
    this.#apply(event);
    this.#append(event);
    return this.intakeStatus();
  }

  /** The intake state to consult before/after every prepare_outline call. */
  intakeStatus() {
    return this.#intake.status();
  }

  /** Checkpoint 3: the AI proposes objectives (never confirmed here). */
  proposeObjectives({ items, assistantText = null, sources = [], at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "objectives.proposed", items, sources, assistantText, at: a };
    this.#apply(event);
    this.#append(event);
    return this.view().proposals;
  }

  /** Checkpoint 3: the teacher decides the proposals. The caller supplies NO provenance. */
  decideObjectives({ decisions, text, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "objectives.decided", decisions, text: requireMsg(text, "text"), at: a };
    this.#apply(event);
    this.#append(event);
    return this.view().decisions;
  }

  /** Checkpoint 4: the AI proposes the lesson plan draft. */
  proposeLessonPlan({ spec, assistantText = null, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "plan.proposed", spec, assistantText, at: a };
    this.#apply(event);
    this.#append(event);
    return this.view().plan;
  }

  /** Checkpoint 4: the teacher confirms the plan. */
  confirmLessonPlan({ text, planId = null, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "plan.confirmed", planId, text: requireMsg(text, "text"), at: a };
    this.#apply(event);
    this.#append(event);
    return this.view().plan;
  }

  /** Checkpoint 5: the teacher publishes an immutable version. */
  publish({ text, note = null, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "package.published", note, text: requireMsg(text, "text"), at: a };
    this.#apply(event);
    this.#append(event);
    return this.view().versions.at(-1);
  }

  /* -------------------------------- reading ------------------------------ */

  /** The current human wording of an objective id (decision trail -> registry -> record). */
  wording(id) {
    const latest = [...this.#gate.decisions()]
      .reverse()
      .find((d) => d.statement && (d.verb === "rename" || d.verb === "add") && (d.proposalId === id || d.targetId === id));
    if (latest?.statement) return latest.statement;
    const proposal = this.#gate.getProposal(id);
    if (proposal?.statement) return proposal.statement;
    const rec = this.#gate.getObjective(id);
    return rec?.statement ?? proposal?.publicId ?? rec?.publicId ?? id;
  }

  #rows() {
    const decisions = this.#gate.decisions();
    const rows = [];
    const seen = new Set();
    for (const id of this.#proposalIds) {
      const proposal = this.#gate.getProposal(id);
      if (!proposal || proposal.proposedBy !== "ai") continue;
      seen.add(id);
      const mine = decisions.filter((d) => d.verb !== "add" && d.proposalId === id);
      const status = mine.some((d) => d.verb === "drop")
        ? "dropped"
        : mine.some((d) => d.verb === "rename")
          ? "renamed"
          : mine.some((d) => d.verb === "accept")
            ? "accepted"
            : "proposed";
      const rename = [...mine].reverse().find((d) => d.verb === "rename");
      const confirmed = status === "proposed" ? null : this.#gate.getObjective(id);
      const alignmentSource = confirmed?.alignment ?? proposal.alignment;
      rows.push({
        id,
        kind: proposal.kind,
        status,
        statement: rename?.statement ?? proposal.statement ?? proposal.publicId ?? "",
        originalStatement: proposal.statement ?? null,
        source: this.#sources.get(id) ?? null,
        alignment: alignmentSource
          ? { publicId: alignmentSource.publicId, relationship: alignmentSource.relationship, suggested: !alignmentSource.confirmedByEducator }
          : null,
        by: "ai",
      });
    }
    for (const d of decisions) {
      if (d.verb !== "add" || !d.targetId || seen.has(d.targetId)) continue;
      seen.add(d.targetId);
      rows.push({
        id: d.targetId,
        kind: "local",
        status: "added",
        statement: d.statement ?? this.#gate.getObjective(d.targetId)?.statement ?? "",
        originalStatement: null,
        source: this.#sources.get(d.targetId) ?? "your own objective",
        alignment: null,
        by: "teacher",
      });
    }
    return rows;
  }

  #objectiveView() {
    return this.#gate.confirmedObjectives().map((o) => ({
      id: o.id, kind: o.kind, statement: o.statement ?? o.publicId ?? "", publicId: o.publicId,
      alignment: o.alignment ? { publicId: o.alignment.publicId, relationship: o.alignment.relationship } : undefined,
    }));
  }

  #timeline() {
    const events = [];
    for (const id of ["files", "outline", "plan"]) {
      const cp = this.#gate.checkpoints()[id];
      if (cp.status !== "confirmed" || !cp.provenance) continue;
      events.push({ id: `checkpoint:${id}`, kind: "checkpoint", at: cp.provenance.decidedAt,
        label: `Checkpoint confirmed — ${id}`, detail: cp.note, turnRef: cp.provenance.turnRef,
        decidedBy: cp.provenance.decidedBy, channel: cp.provenance.channel });
    }
    for (const d of this.#gate.decisions()) {
      const sourceKey = d.verb === "add" ? d.targetId : d.proposalId;
      events.push({ id: d.id, kind: "decision", verb: d.verb, at: d.provenance.decidedAt,
        label: { accept: "Accepted", rename: "Renamed", drop: "Dropped", add: "Added" }[d.verb],
        detail: d.statement ?? null, before: d.renamedFrom?.originalStatement ?? null,
        source: sourceKey ? this.#sources.get(sourceKey) ?? null : null,
        version: d.boundCourseVersion, turnRef: d.provenance.turnRef,
        decidedBy: d.provenance.decidedBy, channel: d.provenance.channel });
    }
    for (const v of this.#gate.versions()) {
      events.push({ id: `publish:${v.version}`, kind: "publish", at: v.publishedAt,
        label: `Published version ${v.version}`, detail: v.note ?? v.title, version: v.version,
        turnRef: v.provenance.turnRef, decidedBy: v.provenance.decidedBy, channel: v.provenance.channel });
    }
    events.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return events;
  }

  /** The full course view: everything from persisted/derived gate state. */
  view() {
    return {
      course: {
        courseId: this.meta.courseId, owner: this.meta.owner, title: this.meta.title,
        description: this.meta.description, materials: this.meta.materials ?? [], createdAt: this.meta.createdAt,
      },
      checkpoints: this.#gate.checkpoints(),
      intake: this.#intake.status(),
      proposals: this.#rows(),
      objectives: this.#objectiveView(),
      decisions: this.#gate.decisions(),
      plan: this.#gate.currentPlan(),
      invalidation: this.planInvalidation(),
      publish: this.#gate.publishStatus(),
      versions: this.#gate.versions(),
      timeline: this.#timeline(),
      ledger: this.#ledger.list(),
      integrity: { events: this.#log.count, head: this.#log.headDigest },
    };
  }

  /**
   * The out-of-band ANCHOR for a sealed version: what a reader records on a device
   * the writer does not control, and later compares against.
   *
   * Computed from the log, but its whole value is that it is stored ELSEWHERE. The
   * host's own verify() cannot detect a self-consistent rewrite (recompute the chain)
   * or a tail truncation; a pinned copy can, because the reference lives outside the
   * record. Per-version, so later legitimate work does not disturb it.
   *
   *   versionDigest  sha-256 of the sealed version record (the contractual artifact)
   *   head / events  the log's digest and length at the moment that version sealed
   *
   * @returns the anchor, or null when the version is not in the log at all
   */
  publishAnchor(version) {
    const publishes = this.#log.read().filter((r) => r.event.kind === "package.published");
    const record = publishes[version - 1];
    if (!record) return null;
    let sealed;
    try {
      sealed = this.#gate.getVersion(version);
    } catch {
      return null;
    }
    return {
      courseId: this.meta.courseId,
      owner: this.meta.owner,
      title: this.meta.title,
      version,
      versionDigest: digestOf(sealed),
      head: record.digest,
      events: record.seq,
    };
  }

  /** WHY the current plan is invalidated: cited objectives no longer confirmed. */
  planInvalidation() {
    const plan = this.#gate.currentPlan();
    if (!plan || plan.status !== "invalidated") return { invalidated: false, gaps: [] };
    const confirmed = new Set(this.#gate.confirmedObjectives().map((o) => o.id));
    const gaps = [];
    for (const activity of plan.activities) {
      for (const objId of activity.objectiveIds) {
        if (confirmed.has(objId)) continue;
        let gap = gaps.find((g) => g.id === objId);
        if (!gap) { gap = { id: objId, statement: this.wording(objId), citedIn: [] }; gaps.push(gap); }
        gap.citedIn.push(activity.title);
      }
    }
    return { invalidated: true, gaps };
  }

  /** Tamper-evident export: the sealed package + decisions + log chain fingerprint. */
  export() {
    return {
      kind: "silicus.course.export.v1",
      course: this.view().course,
      checkpoints: this.#gate.checkpoints(),
      intake: this.#intake.status(),
      objectives: this.#gate.confirmedObjectives(),
      decisions: this.#gate.decisions(),
      plan: this.#gate.currentPlan(),
      versions: this.#gate.versions(),
      timeline: this.#timeline(),
      integrity: { events: this.#log.count, head: this.#log.headDigest },
    };
  }

  verifyLog() {
    return this.#log.verify();
  }
}

function requireMsg(text, what) {
  if (typeof text !== "string" || text.trim().length === 0) throw new Error(`${what} must be a non-empty string`);
  return text.trim();
}

export { CourseStore };
