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
import { objectivesFromAnswers, SOURCE_FROM_ANSWERS, SOURCE_FROM_LOCAL_ANSWERS, teacherStatement } from "./proposer.mjs";
import { digestOf } from "./archive.mjs";
import { retrieveAll, verifyCitations } from "./knowledge.mjs";

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
  #validations = [];
  #planAt = null;
  /** @type {string[]} proposal ids in the order the AI proposed them */
  #proposalIds = [];
  /** @type {Map<string, string>} quiet provenance labels (host metadata, not gate state) */
  #sources = new Map();
  /**
   * Alignment suggestions the worker cited, per plan id: references only (ref, label, source,
   * which activities, whether a source actually checked it). Host metadata, never gate state:
   * the gate drops unknown plan fields, a citation is a suggestion, and the retrieved TEXT is
   * never recorded — it is not evidence.
   */
  #citations = new Map();
  /**
   * Which materials the AI's proposals were drawn from: name, digest, characters. NEVER the text.
   * The digest lets an audit tie a proposal to the exact text without the course keeping it.
   */
  #materialsUsed = [];

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
      case "plan.validated": {
        // A recorded ASFAI verdict on a plan. Inert for the gate: it can never confirm anything.
        this.#validations.push({ planId: event.planId, valid: event.valid, issues: event.issues ?? [], at: event.at });
        return;
      }
      case "intake.answered": {
        const channel = this.#ledger.teacherChannel({ teacherId: this.meta.owner, channel: CHANNEL });
        this.#intake.answer({ viaChannel: channel, text: event.text, answers: event.answers ?? null, at: event.at });
        return;
      }
      case "objectives.proposed": {
        if (event.assistantText) {
          this.#ledger.recordAssistantTurn(event.assistantText, { channel: "model", at: event.at });
        }
        for (const m of event.materials ?? []) this.#materialsUsed.push({ name: m.name, digest: m.digest, chars: m.chars });
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
        const planRecord = this.#gate.proposeLessonPlan(event.spec);
        if (Array.isArray(event.citations) && event.citations.length > 0) this.#citations.set(planRecord.id, event.citations);
        this.#planAt = event.at;
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
  observeIntake({ state, questions = [], draftAuthorization = null, receipt = null, sent = null, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "intake.observed", state, questions, draftAuthorization, receipt, ...(sent ? { sent } : {}), at: a };
    this.#apply(event);
    this.#append(event);
    return this.intakeStatus();
  }

  /** The teacher's reply to the clarifying questions: a REAL turn, and it arms the round. */
  answerIntake({ text, answers = null, at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "intake.answered", text: requireMsg(text, "text"), ...(answers ? { answers } : {}), at: a };
    this.#apply(event);
    this.#append(event);
    return this.intakeStatus();
  }

  /**
   * The drafted spine as an ASFAI lesson-outline, built from the CONFIRMED objectives and
   * the current plan. Refuses until there is a plan; sends nothing the teacher has not
   * already seen on the plan card.
   */
  outlineForValidation() {
    const plan = this.#gate.currentPlan();
    if (!plan) return { ok: false, code: "NO_PLAN", reason: "there is no lesson plan to check yet" };
    const outcomes = this.#gate.confirmedObjectives().map((o) => this.wording(o.id)).filter(Boolean);
    if (outcomes.length === 0) return { ok: false, code: "NO_CONFIRMED_OBJECTIVES", reason: "no confirmed objectives to check against" };
    return {
      ok: true,
      planId: plan.id,
      outline: {
        schemaVersion: "0.1", kind: "lesson-outline", version: 1, status: "draft",
        id: `lesson-outline.${String(this.meta.courseId).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.${String(plan.id).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        // ISO stamps come from the LOGGED event time, never the wall clock: the same log must always
        // yield the same outline (replay), and a fresh Date.now() would make validation unrepeatable.
        createdAt: new Date(this.#planAt ?? this.meta.createdAt).toISOString(),
        updatedAt: new Date(this.#planAt ?? this.meta.createdAt).toISOString(),
        course: this.meta.title, topic: plan.title ?? this.meta.title, audience: "teacher-authored course",
        learningOutcomes: outcomes,
        sections: (plan.activities ?? []).map((a, i) => ({
          id: `activity-${i + 1}`, title: a.title,
          purpose: String(a.learnerDoes || a.teacherDoes || a.title),
        })),
      },
    };
  }

  /** Record ASFAI's verdict on the plan. A signal in the timeline; the teacher still decides. */
  recordValidation({ planId, valid, issues = [], at } = {}) {
    const a = at ?? Date.now();
    const event = { kind: "plan.validated", planId, valid: valid === true, issues, at: a };
    this.#apply(event);
    this.#append(event);
    return this.#validations.at(-1);
  }

  /** What the host may send to prepare_outline next (built from teacher words only), or why not. */
  intakeNextCall() {
    return this.#intake.nextCall();
  }

  /** The intake state to consult before/after every prepare_outline call. */
  intakeStatus() {
    return this.#intake.status();
  }

  /**
   * Checkpoint 3's real path: derive the proposals from the teacher's OWN recorded
   * answers, so no objective statement crosses the API. A client therefore cannot
   * inject one, and with nothing of the teacher's on record the host refuses
   * rather than inventing a sentence to clear the checkpoint.
   *
   * `assistantText` is null on purpose: the system quoted the teacher, so the
   * ledger must not record a model turn claiming authorship.
   */
  proposeObjectivesFromAnswers({ at } = {}) {
    if (this.#proposalIds.length > 0) {
      return {
        ok: false,
        code: "ALREADY_PROPOSED",
        reason: "objectives have already been proposed for this course",
      };
    }
    const items = objectivesFromAnswers(this.#intake.answers());
    if (items.length === 0) {
      return {
        ok: false,
        code: "NO_TEACHER_OUTCOMES",
        reason:
          "the teacher has not answered the outcomes question, so there is nothing of theirs to propose",
      };
    }
    // The label is frozen into the proposal event, so a later ASFAI consult cannot
    // retroactively rewrite where an earlier proposal came from.
    const source = this.#intake.sentToAsfai() ? SOURCE_FROM_ANSWERS : SOURCE_FROM_LOCAL_ANSWERS;
    const a = at ?? Date.now();
    const event = {
      kind: "objectives.proposed",
      items,
      sources: items.map(() => source),
      assistantText: null,
      at: a,
    };
    this.#apply(event);
    this.#append(event);
    return { ok: true, proposals: this.view().proposals };
  }

  /**
   * Checkpoint 3 from the teacher's MATERIAL: a worker reads it and proposes objectives; the teacher
   * accepts, renames, drops or adds. Unlike a derived proposal this was really written by a model, so
   * an assistant turn IS recorded. The log keeps each material's name, digest and size, never its text.
   * Each proposal names the material(s) it came from, and only names the teacher supplied are possible.
   *
   * @param {{worker: object, materials: {name: string, text: string, chars: number, digest: string}[], at?: number}} input
   */
  async proposeObjectivesFromMaterials({ worker, materials = [], at } = {}) {
    if (this.#proposalIds.length > 0) {
      return { ok: false, code: "ALREADY_PROPOSED", reason: "objectives have already been proposed for this course" };
    }
    if (!worker) return { ok: false, code: "WORKER_NOT_CONFIGURED", reason: "no drafting worker is configured" };
    if (!Array.isArray(materials) || materials.length === 0) {
      return { ok: false, code: "NO_MATERIALS", reason: "there is no material to propose objectives from" };
    }
    const answers = this.#intake.answers();
    let proposed;
    try {
      proposed = await worker.draftObjectives({
        materials: materials.map((m) => ({ name: m.name, text: m.text })),
        topic: String(answers?.topic ?? ""),
        course: String(answers?.course ?? this.meta.title ?? ""),
      });
    } catch (e) {
      return { ok: false, code: e?.code ?? "WORKER_FAILED", reason: e instanceof Error ? e.message : String(e) };
    }
    const label = (from) => {
      // Always prefixed "from material:". The names come from the teacher or from a web page's own title, and
      // the labels "from your answer", "from your answer to ASFAI" and "your own objective" are reserved for
      // the teacher's words: a page titled "your answer" must not make a model's proposal read as theirs.
      const text = from.length > 0 ? `from material: ${from.join(", ")}` : "from material: (several)";
      return text.length <= 120 ? text : "from material: (several)";
    };
    const a = at ?? Date.now();
    const event = {
      kind: "objectives.proposed",
      items: proposed.map((o) => ({ kind: "local", statement: o.statement })),
      sources: proposed.map((o) => label(o.from)),
      assistantText: `Proposed ${proposed.length} objective${proposed.length === 1 ? "" : "s"} from your materials.`,
      materials: materials.map((m) => ({ name: m.name, digest: m.digest, chars: m.chars })),
      at: a,
    };
    this.#apply(event);
    this.#append(event);
    return { ok: true, proposals: this.view().proposals };
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
    // The wording the teacher types (add, rename, reword) is untrusted input: one line, bounded, control and bidi
    // characters blanked by the SAME rule that cleans an outcome (proposer.teacherStatement). It reaches the
    // log, the sealed package and every later prompt only after this, so a revision cannot smuggle a line in.
    // A reword carries exactly the intent (the verb, the objective id, the new statement) and nothing else, so a
    // client's extra keys (a provenance block, ids, a kind, an mt_* alignment) never reach the log. They would be
    // inert (the gate ignores them), but the log is hash-chained and permanent: it keeps only what the host used.
    const cleaned = Array.isArray(decisions)
      ? decisions.map((d) => {
          if (!d || typeof d !== "object") return d;
          if (d.verb === "reword") return { verb: "reword", proposalId: d.proposalId, statement: teacherStatement(d.statement) };
          return d.verb === "add" || d.verb === "rename" ? { ...d, statement: teacherStatement(d.statement) } : d;
        })
      : decisions;
    const event = { kind: "objectives.decided", decisions: cleaned, text: requireMsg(text, "text"), at: a };
    this.#apply(event);
    this.#append(event);
    return this.view().decisions;
  }

  /**
   * Checkpoint 4's real path: the WORKER drafts from the teacher's CONFIRMED
   * objectives. The worker proposes, the gate validates, the teacher confirms.
   *
   * Unlike a derived objective proposal, a model really did write this, so an
   * assistant turn IS recorded — the ledger says so honestly. The worker's output
   * was already validated against the gate's rules before it got here.
   */
  async draftPlanFromObjectives({ worker, sources = [], at } = {}) {
    const confirmed = this.#gate.confirmedObjectives();
    if (confirmed.length === 0) {
      return {
        ok: false,
        code: "NO_CONFIRMED_OBJECTIVES",
        reason: "there are no teacher-confirmed objectives to draft from",
      };
    }
    if (!worker) {
      return { ok: false, code: "WORKER_NOT_CONFIGURED", reason: "no drafting worker is configured" };
    }
    const objectives = confirmed.map((o) => ({ id: o.id, statement: this.wording(o.id) }));
    const materials = (this.meta.materials ?? [])
      .map((m) => (m && typeof m === "object" && typeof m.name === "string" ? m.name : null))
      .filter(Boolean);
    const topic = String(this.#intake.answers()?.topic ?? "");

    // Retrieval is per request and is NOT written to the log. A source that sends the teacher's
    // words to ASFAI is consulted only for a course whose answers the teacher has already sent
    // there: no new egress without the teacher's own act. Every failure degrades to no context.
    const context = await retrieveAll(sources, {
      topic, objectives, allowEgress: this.#intake.sentToAsfai() ? ["asfai"] : [],
    });

    let drafted;
    try {
      drafted = await worker.draft({ objectives, topic, materials, context });
    } catch (e) {
      return { ok: false, code: e?.code ?? "WORKER_FAILED", reason: e instanceof Error ? e.message : String(e) };
    }

    // Split the citations off the spec: the gate ignores them, and the log keeps refs only.
    const spec = { ...drafted, activities: drafted.activities.map(({ citations: _c, ...rest }) => rest) };
    const citations = await this.#resolveCitations(drafted, context, sources);

    const a = at ?? Date.now();
    const event = {
      kind: "plan.proposed",
      spec,
      assistantText: "Drafted a lesson plan from your confirmed objectives.",
      ...(citations.length > 0 ? { citations } : {}),
      at: a,
    };
    this.#apply(event);
    this.#append(event);
    return { ok: true, plan: this.view().plan };
  }

  /**
   * The model's cited refs → what the record keeps. The label and source come from the context WE
   * supplied, never from the model; a ref a source reports as unknown is dropped (a citation is
   * optional, so this costs the draft nothing); `verified` is true only when a source actually
   * checked it, so the UI cannot over-claim.
   */
  async #resolveCitations(drafted, context, sources) {
    const byRef = new Map(context.map((c) => [c.ref, c]));
    const cited = [];
    drafted.activities.forEach((act, i) => {
      for (const ref of act.citations ?? []) {
        const c = byRef.get(ref);
        if (!c) continue;
        let row = cited.find((x) => x.ref === ref);
        if (!row) { row = { ref, label: c.label, source: c.source, activityIndexes: [] }; cited.push(row); }
        row.activityIndexes.push(i);
      }
    });
    if (cited.length === 0) return [];
    const { verified, unknown } = await verifyCitations(sources, cited);
    return cited.filter((c) => !unknown.has(c.ref)).map((c) => ({ ...c, verified: verified.has(c.ref) }));
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
      .find((d) => d.statement && (d.verb === "rename" || d.verb === "add" || d.verb === "reword") && (d.proposalId === id || d.targetId === id));
    if (latest?.statement) return latest.statement;
    const proposal = this.#gate.getProposal(id);
    if (proposal?.statement) return proposal.statement;
    const rec = this.#gate.getObjective(id);
    return rec?.statement ?? proposal?.publicId ?? rec?.publicId ?? id;
  }

  /** Ids the current plan's activities cite (any plan status): host metadata for the row, never gate state. */
  #citedByPlan() {
    return new Set((this.#gate.currentPlan()?.activities ?? []).flatMap((a) => a.objectiveIds));
  }

  #rows() {
    const cited = this.#citedByPlan();
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
      // The teacher's latest wording: a rename of the proposal, or a later reword of the confirmed objective.
      const worded = [...mine].reverse().find((d) => d.verb === "rename" || d.verb === "reword");
      const confirmed = status === "proposed" ? null : this.#gate.getObjective(id);
      const alignmentSource = confirmed?.alignment ?? proposal.alignment;
      rows.push({
        id,
        kind: proposal.kind,
        status,
        statement: worded?.statement ?? proposal.statement ?? proposal.publicId ?? "",
        originalStatement: proposal.statement ?? null,
        reworded: mine.some((d) => d.verb === "reword"),
        source: this.#sources.get(id) ?? null,
        alignment: alignmentSource
          ? { publicId: alignmentSource.publicId, relationship: alignmentSource.relationship, suggested: !alignmentSource.confirmedByEducator }
          : null,
        by: "ai",
        citedByPlan: cited.has(id),
      });
    }
    for (const d of decisions) {
      if (d.verb !== "add" || !d.targetId || seen.has(d.targetId)) continue;
      seen.add(d.targetId);
      rows.push({
        id: d.targetId,
        kind: "local",
        status: "added",
        statement: this.wording(d.targetId),
        // Only a reworded objective has an "original" to show: the wording it was added with.
        originalStatement: decisions.some((x) => x.verb === "reword" && x.targetId === d.targetId) ? d.statement ?? null : null,
        reworded: decisions.some((x) => x.verb === "reword" && x.targetId === d.targetId),
        source: this.#sources.get(d.targetId) ?? "your own objective",
        alignment: null,
        by: "teacher",
        citedByPlan: cited.has(d.targetId),
      });
    }
    return rows;
  }

  /**
   * Where a PUBLISHED course stands against its last sealed version. Pure reading: derived from the sealed
   * record and the live gate state, it writes nothing and takes nothing from a client. Revising has no
   * switch of its own: the gate already reopens (the plan on a revoke or a new draft, the publish
   * checkpoint on any change), so "drafting version N+1" is a fact about the record, not a mode a click sets.
   *
   * `drafting` is true only when the record really differs from the sealed version: an objective added
   * or revoked since, or a plan that is not the sealed, confirmed one. Students read `sealedVersion`
   * (latestSealedVersion), never anything here.
   */
  #revision() {
    const sealed = this.latestSealedVersion();
    if (!sealed) return { sealedVersion: null, nextVersion: 1, drafting: false, changes: null, notInPlan: [] };
    const confirmed = this.#gate.confirmedObjectives();
    const plan = this.#gate.currentPlan();
    const sealedIds = new Set(sealed.objectiveRefs.map((o) => o.id));
    const liveIds = new Set(confirmed.map((o) => o.id));
    const said = (o) => ({ id: o.id, statement: o.statement ?? o.publicId ?? o.id });
    const objectivesAdded = confirmed.filter((o) => !sealedIds.has(o.id)).map((o) => ({ id: o.id, statement: this.wording(o.id) }));
    const objectivesRemoved = sealed.objectiveRefs.filter((o) => !liveIds.has(o.id)).map(said);
    // Same id, different statement: the teacher reworded it since the seal. Matched by id only, never by similarity.
    const sealedById = new Map(sealed.objectiveRefs.map((o) => [o.id, o]));
    const objectivesReworded = confirmed
      .filter((o) => sealedById.has(o.id) && said(sealedById.get(o.id)).statement !== said(o).statement)
      .map((o) => ({ id: o.id, before: said(sealedById.get(o.id)).statement, after: said(o).statement }));
    // The plan against the sealed one: the same confirmed plan, a different confirmed plan, or one still waiting on the teacher.
    const planState = !plan || plan.status !== "confirmed" ? "unconfirmed" : plan.id !== sealed.lessonPlan?.id ? "replaced" : "same";
    const cited = this.#citedByPlan();
    const notInPlan = plan ? confirmed.filter((o) => !cited.has(o.id)).map((o) => ({ id: o.id, statement: this.wording(o.id) })) : [];
    return {
      sealedVersion: sealed.version,
      nextVersion: sealed.version + 1,
      drafting: objectivesAdded.length > 0 || objectivesRemoved.length > 0 || objectivesReworded.length > 0 || planState !== "same",
      changes: { objectivesAdded, objectivesRemoved, objectivesReworded, plan: planState, planStatus: plan?.status ?? null },
      notInPlan,
    };
  }

  /**
   * Cited objectives the teacher reworded since the plan was last drafted or confirmed. The plan is NOT
   * invalidated (its cited ids are unchanged) and nothing is re-confirmed for the teacher: this is the notice
   * that the plan text was written from the old wording. `before` is the wording the plan was written from.
   */
  #planWording() {
    const objectives = this.#gate.rewordedSincePlan().map((r) => ({ id: r.objectiveId, before: r.before, after: r.after }));
    return { stale: objectives.length > 0, objectives };
  }

  /** The current plan, plus the alignment suggestions it cited (only when there are some). */
  #planView() {
    const plan = this.#gate.currentPlan();
    if (!plan) return plan;
    const citations = this.#citations.get(plan.id);
    return citations ? { ...plan, citations: citations.map((c) => ({ ...c, activityIndexes: [...c.activityIndexes] })) } : plan;
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
        label: { accept: "Accepted", rename: "Renamed", drop: "Dropped", add: "Added", reword: "Reworded" }[d.verb],
        detail: d.statement ?? null, before: d.renamedFrom?.originalStatement ?? d.rewordedFrom?.previousStatement ?? null,
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
      validations: [...this.#validations],
      proposals: this.#rows(),
      materialsUsed: this.#materialsUsed.map((m) => ({ ...m })),
      objectives: this.#objectiveView(),
      decisions: this.#gate.decisions(),
      plan: this.#planView(),
      planWording: this.#planWording(),
      invalidation: this.planInvalidation(),
      publish: this.#gate.publishStatus(),
      revision: this.#revision(),
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

  /**
   * What a student may ask about: the latest SEALED version, or null if nothing is published. Read only:
   * asking writes nothing to the log, and a draft or an unpublished edit is never reachable from here.
   */
  latestSealedVersion() {
    return this.#gate.versions().at(-1) ?? null;
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
      plan: this.#planView(),
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
