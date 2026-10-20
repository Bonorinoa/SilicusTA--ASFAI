/**
 * confirm-gate.mjs — Silicus TA 3.0 teacher-confirm gate (confirm-gate v0).
 *
 * Proposals (objectives, then a lesson plan) only enter a published
 * CoursePackage through explicit teacher decisions — verbs `accept`, `rename`,
 * `drop`, `add`, plus `reword` for an already confirmed objective (same id, new
 * statement) — each recorded with provenance that cites a real teacher turn
 * in the shared {@link TurnLedger}. There is NO code path that sets
 * `confirmedByEducator` or publishes without such a decision record; AI
 * self-confirmation is structurally impossible because every mutating
 * confirmation API requires a `turnRef` resolving to a `teacher`-role turn that
 * only the host transport can record (see host-guard.mjs).
 *
 * Model of the five teacher checkpoints (protocol, not manners):
 *
 *   files ──▶ outline ──▶ objectives ──▶ plan ──▶ publish
 *
 * - `files`, `outline`: explicit teacher confirmations (checkpoint 1–2).
 * - `objectives`: auto-confirmed when every proposal has received a teacher
 *   decision (accept / rename / drop / add); reopens when new proposals arrive.
 * - `plan`: confirmed only by `confirmLessonPlan` (checkpoint 4); invalidated
 *   and reopened when a confirmed objective it cites is dropped or when a new
 *   plan proposal supersedes it.
 * - `publish`: `publish()` bumps `CoursePackage.version` (never overwrite) and
 *   requires explicit teacher provenance — "AI proposes; it never publishes".
 *
 * Idempotency: every confirm-style call is keyed (verb + target + turnRef; for
 * `add`: turnRef + statement hash) and replaying the exact same call returns
 * the original record without re-applying state. Conflicting re-decisions
 * throw `ALREADY_DECIDED`.
 *
 * Zero dependencies: plain ES modules + JSDoc types. Node >= 18 (tested on 22).
 *
 * @module confirm-gate
 */

import { createHash, randomUUID } from "node:crypto";
import { TurnLedger } from "./host-guard.mjs";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {import("./host-guard.mjs").TurnRef} TurnRef
 * @typedef {import("./host-guard.mjs").TurnLedger} TurnLedgerType
 */

/**
 * Teacher decision provenance. Every confirmation MUST carry one. Produced by
 * the host UI/transport when the teacher acts — never by the model.
 *
 * @typedef {Object} TeacherProvenance
 * @property {TurnRef} turnRef     Cites a `teacher`-role turn in the ledger.
 * @property {string} decidedBy    Teacher identifier; must equal the turn's actorId.
 * @property {string} channel      Channel; must equal the turn's channel.
 * @property {number} decidedAt    Epoch ms; must not predate the turn or the proposal.
 */

/**
 * @typedef {Object} ValidatedProvenance
 * @property {TurnRef} turnRef
 * @property {"teacher"} role
 * @property {string} decidedBy
 * @property {string} channel
 * @property {number} decidedAt
 * @property {number} recordedAt
 */

/**
 * @typedef {Object} AlignmentRef  Optional public alignment metadata (never a key).
 * @property {string} publicId     Marble id (`mt_...`).
 * @property {"closeMatch"|"relatedTo"|"exactMatch"} relationship
 */

/**
 * AI-proposed or teacher-added objective. `id` is ALWAYS a locally minted
 * `urn:uuid:...` — state is never keyed on `mt_*` alone.
 *
 * @typedef {Object} ObjectiveRecord
 * @property {string} id
 * @property {"public"|"local"} kind
 * @property {string} [publicId]   Required iff kind === "public".
 * @property {string} [statement]  Required iff kind === "local".
 * @property {AlignmentRef} [alignment]
 * @property {boolean} confirmedByEducator  Always false until a teacher decision lands.
 * @property {"ai"|"teacher"} proposedBy
 * @property {number} proposedAt
 */

/**
 * @typedef {Object} DecisionRecord
 * @property {string} id
 * @property {string} key            Idempotency key.
 * @property {"accept"|"rename"|"drop"|"add"|"reword"} verb
 * @property {string|null} proposalId  For `reword`: the confirmed objective's id.
 * @property {string|null} targetId  Confirmed-set objective id (accept/rename/add/reword).
 * @property {string} [statement]    Teacher-written statement (rename/add/reword: the AFTER).
 * @property {{proposalId: string, originalStatement: string|null, originalKind: string, publicId: string|null}} [renamedFrom]
 * @property {{objectiveId: string, previousStatement: string|null, originalStatement: string|null, kind: string, publicId: string|null}} [rewordedFrom]  `reword` only: the BEFORE (immediate previous wording) and the original.
 * @property {ValidatedProvenance} provenance
 * @property {number} boundCourseVersion  CoursePackage version this decision binds to.
 */

/**
 * @typedef {Object} Activity
 * @property {string} id
 * @property {string} title
 * @property {number} minutes
 * @property {string[]} objectiveIds
 * @property {string[]} materialVersionIds
 * @property {string} learnerDoes
 * @property {string} teacherDoes
 * @property {"none"|"observation"|"work-product"} evidenceIfAny
 * @property {string} [notEvidence]
 */

/**
 * @typedef {Object} LessonPlanRecord
 * @property {string} id
 * @property {string} courseId
 * @property {number} courseVersion
 * @property {string} title
 * @property {{ageRangeStart?: number, ageRangeEnd?: number}} [audience]
 * @property {"draft"|"confirmed"|"invalidated"} status
 * @property {readonly Activity[]} activities
 * @property {"ai"} proposedBy
 * @property {number} proposedAt
 */

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** The five teacher checkpoints, in protocol order. */
export const CHECKPOINTS = Object.freeze(["files", "outline", "objectives", "plan", "publish"]);

/** Teacher decision verbs (checkpoint 3). */
/**
 * `reword` is the only verb that acts on an already CONFIRMED objective: it changes the statement and keeps
 * the id (so plan citations survive). `rename` stays terminal and applies to a proposal only.
 */
export const VERBS = Object.freeze(["accept", "rename", "drop", "add", "reword"]);

/** Allowed public-alignment relationships. */
export const RELATIONSHIPS = Object.freeze(["closeMatch", "relatedTo", "exactMatch"]);

/** Allowed evidence kinds. Student chat is NOT one of them. */
export const EVIDENCE_KINDS = Object.freeze(["none", "observation", "work-product"]);

const MT_ID_RE = /^mt_[A-Za-z0-9_-]+$/;
const URN_UUID_RE = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** Base error; carries a machine-readable `code`. */
export class ConfirmGateError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.name = "ConfirmGateError";
    /** @type {string} */
    this.code = code;
  }
}

/**
 * A confirmation that cannot be backed by a recorded teacher turn/provenance.
 * Codes: MISSING_PROVENANCE | UNKNOWN_TURN | NON_TEACHER_TURN | ACTOR_MISMATCH |
 *        CHANNEL_MISMATCH | TIME_TRAVEL
 */
export class FabricatedConfirmationError extends ConfirmGateError {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message, code);
    this.name = "FabricatedConfirmationError";
  }
}

/** Publish attempted while blockers remain. `blockers` lists each reason. */
export class PublishBlockedError extends ConfirmGateError {
  /** @param {readonly string[]} blockers */
  constructor(blockers) {
    super(`publish blocked: ${blockers.join("; ")}`, "PUBLISH_BLOCKED");
    this.name = "PublishBlockedError";
    /** @type {readonly string[]} */
    this.blockers = Object.freeze([...blockers]);
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** @returns {string} A fresh stable local id (`urn:uuid:...`), never an `mt_*` id. */
function mintLocalId() {
  return `urn:uuid:${randomUUID()}`;
}

/**
 * A DETERMINISTIC local-id factory for hosts that persist an append-only event
 * log and rebuild gate state by replay. Given the same seed and the same
 * sequence of mint calls it yields identical `urn:uuid`-shaped ids, so a
 * replayed course reproduces the original ids, decisions and versions exactly.
 * (Random ids — the default — are deliberately NOT replayable.)
 *
 * @param {string} seed  Stable per-course seed; store it with the course record.
 * @returns {() => string}
 */
export function deterministicIdFactory(seed) {
  requireText(seed, "seed", "BAD_SEED");
  let n = 0;
  return () => {
    n += 1;
    const h = createHash("sha256").update(`${seed}:${n}`).digest("hex");
    return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  };
}

/**
 * @param {unknown} v
 * @param {string} what
 * @returns {string}
 */
function requireText(v, what, code = "BAD_INPUT", ErrorClass = ConfirmGateError) {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ErrorClass(`${what} must be a non-empty string`, code);
  }
  return v.trim();
}

/**
 * @param {AlignmentRef|undefined} raw
 * @param {boolean} confirmedByEducator
 * @returns {AlignmentRef & {confirmedByEducator: boolean}|undefined}
 */
function normalizeAlignment(raw, confirmedByEducator) {
  if (raw === undefined || raw === null) return undefined;
  const publicId = requireText(raw.publicId, "alignment.publicId", "BAD_ALIGNMENT");
  if (!MT_ID_RE.test(publicId)) {
    throw new ConfirmGateError(`alignment.publicId must be a Marble id (mt_...), got: ${publicId}`, "BAD_ALIGNMENT");
  }
  if (!RELATIONSHIPS.includes(raw.relationship)) {
    throw new ConfirmGateError(
      `alignment.relationship must be one of ${RELATIONSHIPS.join("|")}, got: ${String(raw.relationship)}`,
      "BAD_ALIGNMENT",
    );
  }
  return Object.freeze({ publicId, relationship: raw.relationship, confirmedByEducator });
}

/** @param {number} n @returns {string} */
function hashStatement(statement) {
  return createHash("sha256").update(statement).digest("base64url");
}

/* -------------------------------------------------------------------------- */
/* ConfirmGate                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} ConfirmGateOptions
 * @property {string} courseId
 * @property {string} owner              Teacher identifier (no ASFAI account required).
 * @property {string} [title]
 * @property {string} [description]
 * @property {TurnLedgerType} [ledger]   Share the ledger with the host-guard.
 * @property {import("./host-guard.mjs").ResidualRuleGuard} [hostGuard]  Optional; enforces PR #15 composition at the outline checkpoint.
 * @property {readonly object[]} [materials]  MaterialVersion records (checkpoint 1 input).
 * @property {() => number} [clock]
 * @property {() => string} [idFactory]  Local-id minting. Defaults to random `urn:uuid` ids;
 *   inject {@link deterministicIdFactory} to make state exactly replayable from an event log.
 * @property {"auto"|"explicit"} [objectivesConfirm]  How checkpoint 3 (`objectives`) confirms. `"auto"`
 *   (default, the historical behaviour): the checkpoint confirms itself once every proposal carries a teacher
 *   decision, and reopens when new proposals arrive. `"explicit"`: a teacher decision never confirms it — the
 *   teacher closes it with {@link ConfirmGate#confirmObjectivesCheckpoint}, which needs at least one decided
 *   objective and no proposal still waiting. New proposals after a confirm reopen it in both modes.
 */

/**
 * The teacher-confirm gate for one course. See module docs for the checkpoint
 * state machine, decision verbs, versioning and idempotency rules.
 */
export class ConfirmGate {
  #courseId;
  #owner;
  #title;
  #description;
  #ledger;
  #hostGuard;
  #clock;
  #materials;

  /** @type {Map<string, {record: ObjectiveRecord, status: "proposed"|"accepted"|"renamed"|"added"|"dropped", objectiveId: string|null, decisionIds: string[]}>} */
  #registry = new Map();
  /** @type {Map<string, ObjectiveRecord & {confirmedByEducator: true, decisionId: string, provenance: ValidatedProvenance, renamedFrom?: object, authoredBy?: string}>} */
  #confirmed = new Map();
  /** @type {Map<string, DecisionRecord>} */
  #decisionsByKey = new Map();
  /** @type {DecisionRecord[]} */
  #decisions = [];
  /** @type {Map<string, {record: LessonPlanRecord & {status: string}, confirmation: {provenance: ValidatedProvenance, decisionId: string}|null, invalidationReason: string|null, wordingMark: number}>} */
  #plans = new Map();
  /** @type {{objectiveId: string, decisionId: string, before: string|null, after: string}[]} every reword, in order */
  #rewords = [];
  #latestPlanId = null;
  /** @type {Map<string, {id: string, status: "pending"|"open"|"confirmed", provenance: ValidatedProvenance|null, note: string|null}>} */
  #checkpoints = new Map(CHECKPOINTS.map((id) => [id, { id, status: "pending", provenance: null, note: null }]));
  /** @type {object[]} */
  #history = [];
  #nextVersion = 1;
  #dirty = false;
  /** @type {() => string} */
  #idFactory;
  /** @type {"auto"|"explicit"} */
  #objectivesConfirm;

  /** @param {ConfirmGateOptions} options */
  constructor({ courseId, owner, title = "", description = "", ledger = new TurnLedger(), hostGuard = null, materials = [], clock = () => Date.now(), idFactory = mintLocalId, objectivesConfirm = "auto" }) {
    this.#courseId = requireText(courseId, "courseId");
    this.#owner = requireText(owner, "owner");
    this.#title = title;
    this.#description = description;
    this.#ledger = ledger;
    this.#hostGuard = hostGuard;
    this.#materials = Object.freeze([...materials]);
    this.#clock = clock;
    this.#idFactory = idFactory;
    if (objectivesConfirm !== "auto" && objectivesConfirm !== "explicit") {
      throw new ConfirmGateError(`objectivesConfirm must be "auto" or "explicit", got: ${String(objectivesConfirm)}`, "BAD_INPUT");
    }
    this.#objectivesConfirm = objectivesConfirm;
  }

  /** @returns {TurnLedgerType} */
  get ledger() {
    return this.#ledger;
  }

  /* ------------------------- checkpoint machinery ------------------------ */

  /**
   * Frozen snapshot of the five-checkpoint state machine.
   * @returns {Readonly<Record<string, {id: string, status: string, provenance: ValidatedProvenance|null, note: string|null}>>}
   */
  checkpoints() {
    /** @type {Record<string, object>} */
    const out = {};
    for (const [id, rec] of this.#checkpoints) out[id] = Object.freeze({ ...rec });
    return Object.freeze(out);
  }

  /**
   * Explicit teacher confirmation for the manually-driven checkpoints
   * (`files`, `outline`). The objectives and plan checkpoints are confirmed by
   * their own decision APIs; `publish` by {@link ConfirmGate#publish}.
   *
   * @param {"files"|"outline"} id
   * @param {TeacherProvenance} provenance
   * @param {string} [note]
   * @returns {Readonly<object>} the checkpoint record
   */
  confirmCheckpoint(id, provenance, note = null) {
    if (id !== "files" && id !== "outline") {
      throw new ConfirmGateError(
        `checkpoint "${id}" is not manually confirmable (objectives/plan confirm via their decision APIs, publish via publish())`,
        "BAD_CHECKPOINT",
      );
    }
    this.#requirePriorCheckpoints(id);
    const prov = this.#requireTeacherProvenance(provenance);
    if (id === "outline" && this.#hostGuard) {
      // The host decides what counts as authorization for checkpoint 2. Prefer
      // `outlineAuthorized()` when the host provides it: the live asfai-learning
      // server issues no `draftAuthorization`, so a host binds this checkpoint to
      // the intake outcome it actually OBSERVED plus a real teacher turn. A
      // `draftAuthorization`, when a server does emit one, still satisfies it.
      const authorized =
        typeof this.#hostGuard.outlineAuthorized === "function"
          ? this.#hostGuard.outlineAuthorized()
          : this.#hostGuard.hasDraftAuthorization();
      if (!authorized) {
        throw new ConfirmGateError(
          "outline checkpoint cannot be confirmed before the host has observed a completed intake " +
            "(a prepare_outline result of ready_to_draft after the teacher answered the clarifying round — " +
            "see intake.mjs), or an observed PR #15 draftAuthorization",
          "MISSING_DRAFT_AUTHORIZATION",
        );
      }
    }
    const cp = this.#checkpoints.get(id);
    cp.status = "confirmed";
    cp.provenance = prov;
    cp.note = note;
    this.#markDirty();
    return Object.freeze({ ...cp });
  }

  /**
   * @param {string} id
   * @returns {void}
   */
  #requirePriorCheckpoints(id) {
    const idx = CHECKPOINTS.indexOf(id);
    for (const prior of CHECKPOINTS.slice(0, idx)) {
      if (this.#checkpoints.get(prior).status !== "confirmed") {
        throw new ConfirmGateError(
          `checkpoint order violation: "${prior}" must be teacher-confirmed before "${id}"`,
          "CHECKPOINT_ORDER",
        );
      }
    }
  }

  /** @param {string} id */
  #touchCheckpoint(id) {
    const cp = this.#checkpoints.get(id);
    if (cp.status === "pending") cp.status = "open";
  }

  /** @param {string} id @param {string} reason */
  #reopenCheckpoint(id, reason) {
    const cp = this.#checkpoints.get(id);
    if (cp.status === "confirmed") {
      cp.status = "open";
      cp.note = `reopened: ${reason}`;
    } else {
      this.#touchCheckpoint(id);
    }
    this.#markDirty();
  }

  /** Mark unpublished changes; the publish checkpoint only reflects the last publish. */
  #markDirty() {
    this.#dirty = true;
    const pub = this.#checkpoints.get("publish");
    if (pub.status === "confirmed") {
      pub.status = "pending";
      pub.note = "changes since the last publish";
      pub.provenance = null;
    }
  }

  /* --------------------------- provenance gate --------------------------- */

  /**
   * Validate that a confirmation is backed by a REAL recorded teacher turn.
   * Anything else is a fabricated confirmation and is rejected.
   *
   * @param {TeacherProvenance|undefined|null} provenance
   * @param {{notBefore?: number}} [constraints]
   * @returns {ValidatedProvenance}
   */
  #requireTeacherProvenance(provenance, { notBefore } = {}) {
    if (!provenance || typeof provenance !== "object") {
      throw new FabricatedConfirmationError(
        "confirmation rejected: missing teacher provenance (a decision must cite a recorded teacher turn)",
        "MISSING_PROVENANCE",
      );
    }
    const turnRef = requireText(provenance.turnRef, "provenance.turnRef", "MISSING_PROVENANCE", FabricatedConfirmationError);
    const decidedBy = requireText(provenance.decidedBy, "provenance.decidedBy", "MISSING_PROVENANCE", FabricatedConfirmationError);
    const channel = requireText(provenance.channel, "provenance.channel", "MISSING_PROVENANCE", FabricatedConfirmationError);
    const decidedAt = provenance.decidedAt;
    if (typeof decidedAt !== "number" || !Number.isFinite(decidedAt)) {
      throw new FabricatedConfirmationError(
        "confirmation rejected: provenance.decidedAt must be an epoch-ms number",
        "MISSING_PROVENANCE",
      );
    }

    let turn;
    try {
      turn = this.#ledger.getTurn(turnRef);
    } catch {
      throw new FabricatedConfirmationError(
        `confirmation rejected: turn ${turnRef} is not in the ledger (no recorded teacher turn)`,
        "UNKNOWN_TURN",
      );
    }
    if (turn.role !== "teacher") {
      throw new FabricatedConfirmationError(
        `confirmation rejected: turn ${turnRef} is a ${turn.role} turn — a model turn can never confirm anything`,
        "NON_TEACHER_TURN",
      );
    }
    if (decidedBy !== turn.actorId) {
      throw new FabricatedConfirmationError(
        `confirmation rejected: provenance.decidedBy "${decidedBy}" does not match the teacher on turn ${turnRef} ("${turn.actorId}")`,
        "ACTOR_MISMATCH",
      );
    }
    if (channel !== turn.channel) {
      throw new FabricatedConfirmationError(
        `confirmation rejected: provenance.channel "${channel}" does not match the channel of turn ${turnRef} ("${turn.channel}")`,
        "CHANNEL_MISMATCH",
      );
    }
    if (decidedAt < turn.at) {
      throw new FabricatedConfirmationError(
        `confirmation rejected: provenance.decidedAt predates the teacher turn it cites`,
        "TIME_TRAVEL",
      );
    }
    if (notBefore !== undefined && decidedAt < notBefore) {
      throw new FabricatedConfirmationError(
        `confirmation rejected: the decision predates the proposal it decides`,
        "TIME_TRAVEL",
      );
    }
    return Object.freeze({
      turnRef,
      role: "teacher",
      decidedBy,
      channel,
      decidedAt,
      recordedAt: this.#clock(),
    });
  }

  /* ------------------------- objectives (checkpoint 3) ------------------- */

  /**
   * AI proposes objectives. Proposals are NEVER confirmed here — the returned
   * records hard-code `confirmedByEducator: false`. Each proposal (public or
   * local) gets its own stable local `urn:uuid:` id; `mt_*` ids are optional
   * references only and never a state key.
   *
   * @param {readonly {kind: "public"|"local", publicId?: string, statement?: string, alignment?: AlignmentRef}[]} items
   * @returns {readonly ObjectiveRecord[]}
   */
  proposeObjectives(items) {
    this.#requirePriorCheckpoints("objectives");
    if (!Array.isArray(items) || items.length === 0) {
      throw new ConfirmGateError("proposeObjectives requires a non-empty array of proposals", "BAD_INPUT");
    }
    /** @type {ObjectiveRecord[]} */
    const created = [];
    for (const item of items) {
      const id = this.#idFactory();
      /** @type {ObjectiveRecord} */
      let record;
      if (item.kind === "public") {
        const publicId = requireText(item.publicId, "publicId (kind: public)");
        if (!MT_ID_RE.test(publicId)) {
          throw new ConfirmGateError(`publicId must be a Marble id (mt_...), got: ${publicId}`, "BAD_PUBLIC_ID");
        }
        record = {
          id,
          kind: "public",
          publicId,
          statement: item.statement ? requireText(item.statement, "statement") : undefined,
          alignment: normalizeAlignment(item.alignment, false),
          confirmedByEducator: false,
          proposedBy: "ai",
          proposedAt: this.#clock(),
        };
      } else if (item.kind === "local") {
        record = {
          id,
          kind: "local",
          statement: requireText(item.statement, "statement (kind: local)"),
          alignment: normalizeAlignment(item.alignment, false),
          confirmedByEducator: false,
          proposedBy: "ai",
          proposedAt: this.#clock(),
        };
      } else {
        throw new ConfirmGateError(`kind must be "public" or "local", got: ${String(item.kind)}`, "BAD_KIND");
      }
      Object.freeze(record);
      this.#registry.set(id, { record, status: "proposed", objectiveId: null, decisionIds: [] });
      created.push(record);
    }
    this.#touchCheckpoint("objectives");
    // New proposals after the objectives checkpoint was confirmed reopen it:
    // every proposal must pass through a teacher decision before publish.
    if (this.#checkpoints.get("objectives").status === "confirmed") {
      this.#reopenCheckpoint("objectives", "new proposals arrived");
    }
    this.#markDirty();
    return Object.freeze(created);
  }

  /**
   * Teacher decisions over the proposal set (`confirm_objectives`). One call =
   * one teacher turn; `provenance` is shared across the decisions in the batch.
   *
   * Verb semantics:
   *  - `accept` — the proposal enters the confirmed set unchanged.
   *  - `rename` — a teacher-written replacement statement becomes a NEW
   *    objective (fresh local id) with `renamedFrom` provenance linking to the
   *    original proposal; the proposal record itself is never mutated.
   *  - `drop`  — removed from (or kept out of) the confirmed set; any confirmed
   *    plan citing it is invalidated and publish re-blocks.
   *  - `reword` — the ONE verb for an already CONFIRMED objective: a new teacher-written statement, same id and
   *    kind, before/after on the decision. Plan citations survive (see {@link ConfirmGate#rewordedSincePlan}).
   *  - `add`   — mints a new LOCAL objective (`urn:uuid:...`, never `mt_*`)
   *    from a teacher-written statement; confirmed immediately (the teacher IS
   *    the decision).
   *
   * Idempotent: replaying the exact same call returns the original decision
   * records without re-applying. Conflicting re-decisions throw ALREADY_DECIDED.
   *
   * @param {{provenance: TeacherProvenance, decisions: readonly {verb: "accept"|"rename"|"drop"|"add"|"reword", proposalId?: string, statement?: string, alignment?: AlignmentRef}[]}} batch
   * @returns {readonly DecisionRecord[]}
   */
  confirmObjectives({ provenance, decisions }) {
    this.#requirePriorCheckpoints("objectives");
    if (!Array.isArray(decisions) || decisions.length === 0) {
      throw new ConfirmGateError("confirmObjectives requires a non-empty decisions array", "BAD_INPUT");
    }
    const prov = this.#requireTeacherProvenance(provenance);
    const applied = decisions.map((decision) => this.#applyDecision(decision, prov));
    if (this.#objectivesConfirm === "explicit") {
      // Explicit mode: a teacher decision never confirms checkpoint 3. The teacher closes it with
      // confirmObjectivesCheckpoint; until then the checkpoint stays open, exactly as it does mid-round in
      // auto mode. (A decision made after an explicit confirm leaves it open again: re-confirm.)
      this.#touchCheckpoint("objectives");
    } else if (this.#undecidedProposalIds().length === 0) {
      const cp = this.#checkpoints.get("objectives");
      cp.status = "confirmed";
      cp.provenance = prov;
      cp.note = "every proposal received a teacher decision";
    } else {
      this.#touchCheckpoint("objectives");
    }
    return Object.freeze(applied);
  }

  /**
   * Explicit teacher confirmation of checkpoint 3 — `objectivesConfirm: "explicit"` only (R4). In auto mode
   * the checkpoint confirms itself and this refuses `OBJECTIVES_AUTO` (the UI never offers the button there).
   * Needs a real teacher turn (the same provenance gate as every confirmation), at least one decided objective
   * and no proposal still waiting. A later proposal reopens the checkpoint exactly as in auto mode.
   *
   * Codes: OBJECTIVES_AUTO | OBJECTIVES_PENDING | NO_OBJECTIVES (plus the provenance codes).
   *
   * @param {{provenance: TeacherProvenance}} spec
   * @returns {Readonly<{id: string, status: string, provenance: ValidatedProvenance, note: string|null}>}
   */
  confirmObjectivesCheckpoint({ provenance } = {}) {
    if (this.#objectivesConfirm !== "explicit") {
      throw new ConfirmGateError(
        "this course confirms its objectives automatically; there is nothing for the teacher to close",
        "OBJECTIVES_AUTO",
      );
    }
    this.#requirePriorCheckpoints("objectives");
    const prov = this.#requireTeacherProvenance(provenance);
    if (this.#undecidedProposalIds().length > 0) {
      throw new ConfirmGateError(
        "a proposal is still waiting for the teacher's decision",
        "OBJECTIVES_PENDING",
      );
    }
    if (this.#confirmed.size === 0) {
      throw new ConfirmGateError(
        "no objective has been decided yet, so there is nothing to confirm",
        "NO_OBJECTIVES",
      );
    }
    const cp = this.#checkpoints.get("objectives");
    cp.status = "confirmed";
    cp.provenance = prov;
    cp.note = "the teacher confirmed the objectives";
    this.#markDirty();
    return Object.freeze({ ...cp });
  }

  /** @returns {string[]} Registry ids still awaiting a first teacher decision. */
  #undecidedProposalIds() {
    return [...this.#registry.entries()].filter(([, e]) => e.status === "proposed").map(([id]) => id);
  }

  /**
   * @param {{verb: string, proposalId?: string, statement?: string, alignment?: AlignmentRef}} decision
   * @param {ValidatedProvenance} prov
   * @returns {DecisionRecord}
   */
  #applyDecision(decision, prov) {
    const verb = decision.verb;
    if (!VERBS.includes(verb)) {
      throw new ConfirmGateError(`verb must be one of ${VERBS.join("|")}, got: ${String(verb)}`, "BAD_VERB");
    }

    if (verb === "reword") return this.#applyReword(decision, prov);

    if (verb === "add") {
      const statement = requireText(decision.statement, "statement (verb: add)", "BAD_STATEMENT");
      const key = `add:${prov.turnRef}:${hashStatement(statement)}`;
      const existing = this.#decisionsByKey.get(key);
      if (existing) return existing; // idempotent replay: no second mint.
      const id = this.#idFactory();
      if (MT_ID_RE.test(id)) {
        // Defensive: local ids must never look like Marble ids.
        throw new ConfirmGateError("minted local id collides with mt_ id space", "BAD_STATE");
      }
      const record = Object.freeze({
        id,
        kind: "local",
        statement,
        alignment: normalizeAlignment(decision.alignment, true),
        confirmedByEducator: true,
        proposedBy: "teacher",
        proposedAt: prov.decidedAt,
        authoredBy: prov.decidedBy,
        decisionId: null, // filled below via decision record linkage
        provenance: prov,
      });
      const decisionRecord = this.#recordDecision({
        key,
        verb,
        proposalId: null,
        targetId: id,
        statement,
        provenance: prov,
      });
      const confirmedEntry = Object.freeze({ ...record, decisionId: decisionRecord.id });
      this.#confirmed.set(id, confirmedEntry);
      this.#registry.set(id, {
        record: confirmedEntry,
        status: "added",
        objectiveId: id,
        decisionIds: [decisionRecord.id],
      });
      this.#touchCheckpoint("objectives");
      return decisionRecord;
    }

    const proposalId = requireText(decision.proposalId, "proposalId", "UNKNOWN_PROPOSAL");
    const entry = this.#registry.get(proposalId);
    if (!entry) {
      throw new ConfirmGateError(`unknown proposal: ${proposalId}`, "UNKNOWN_PROPOSAL");
    }
    const proposal = entry.record;
    const key = `${verb}:${proposalId}:${prov.turnRef}`;
    const existing = this.#decisionsByKey.get(key);
    if (existing) return existing; // idempotent replay.

    if (prov.decidedAt < proposal.proposedAt) {
      throw new FabricatedConfirmationError(
        "confirmation rejected: the decision predates the proposal it decides",
        "TIME_TRAVEL",
      );
    }

    if (verb === "drop") {
      if (entry.status === "dropped") {
        throw new ConfirmGateError(
          `proposal ${proposalId} was already dropped (different turn) — nothing to drop`,
          "ALREADY_DECIDED",
        );
      }
      const decisionRecord = this.#recordDecision({
        key,
        verb,
        proposalId,
        targetId: entry.objectiveId ?? proposalId,
        provenance: prov,
      });
      if (entry.objectiveId && this.#confirmed.has(entry.objectiveId)) {
        this.#confirmed.delete(entry.objectiveId);
        this.#invalidatePlansCiting(entry.objectiveId, `objective ${entry.objectiveId} was dropped by the teacher`);
      }
      entry.status = "dropped";
      entry.decisionIds.push(decisionRecord.id);
      this.#markDirty();
      return decisionRecord;
    }

    // accept / rename: one content-shaping decision per proposal, terminal.
    if (entry.status === "accepted" || entry.status === "renamed" || entry.status === "added") {
      throw new ConfirmGateError(
        `proposal ${proposalId} already received a content-shaping decision (${entry.status}) — use drop to revoke`,
        "ALREADY_DECIDED",
      );
    }
    if (entry.status === "dropped") {
      throw new ConfirmGateError(
        `proposal ${proposalId} was dropped — dropped proposals cannot be revived; propose a new one`,
        "ALREADY_DECIDED",
      );
    }

    if (verb === "accept") {
      const confirmedEntry = Object.freeze({
        ...proposal,
        alignment: proposal.alignment ? Object.freeze({ ...proposal.alignment, confirmedByEducator: true }) : undefined,
        confirmedByEducator: true,
        decisionId: null,
        provenance: prov,
      });
      const decisionRecord = this.#recordDecision({
        key,
        verb,
        proposalId,
        targetId: proposalId,
        provenance: prov,
      });
      this.#confirmed.set(proposalId, Object.freeze({ ...confirmedEntry, decisionId: decisionRecord.id }));
      entry.status = "accepted";
      entry.objectiveId = proposalId;
      entry.decisionIds.push(decisionRecord.id);
      this.#markDirty();
      return decisionRecord;
    }

    // verb === "rename": the teacher's wording for the SAME objective. The id
    // stays stable (contract: ObjectiveRef.id is "URN, stable") so plans citing
    // the objective survive teacher wording edits; before→after lives on the
    // decision record. The original proposal record stays exactly as proposed
    // (frozen provenance).
    const statement = requireText(decision.statement, "statement (verb: rename)", "BAD_STATEMENT");
    if (proposal.statement !== undefined && statement === proposal.statement) {
      throw new ConfirmGateError(
        "rename statement is identical to the proposal — use accept instead",
        "STATEMENT_UNCHANGED",
      );
    }
    const decisionRecord = this.#recordDecision({
      key,
      verb,
      proposalId,
      targetId: proposalId,
      statement,
      renamedFrom: {
        proposalId,
        originalStatement: proposal.statement ?? null,
        originalKind: proposal.kind,
        publicId: proposal.publicId ?? null,
      },
      provenance: prov,
    });
    const confirmedEntry = Object.freeze({
      ...proposal,
      id: proposalId,
      kind: proposal.kind === "public" ? "public" : "local",
      publicId: proposal.publicId,
      statement,
      alignment: proposal.alignment ? Object.freeze({ ...proposal.alignment, confirmedByEducator: true }) : undefined,
      confirmedByEducator: true,
      decisionId: decisionRecord.id,
      provenance: prov,
      renamedFrom: decisionRecord.renamedFrom,
    });
    this.#confirmed.set(proposalId, confirmedEntry);
    entry.status = "renamed";
    entry.objectiveId = proposalId;
    entry.decisionIds.push(decisionRecord.id);
    this.#markDirty();
    return decisionRecord;
  }

  /**
   * `reword`: the teacher's new wording for an objective that is ALREADY confirmed. The id and kind never
   * change, so every plan citation stays valid; the decision records before/after and the teacher turn, and
   * the original proposal record is never touched. Refusals (each its own code, nothing recorded):
   *   UNKNOWN_OBJECTIVE   no such id (an mt_* id is never an objective id)
   *   NOT_CONFIRMED       still a proposal: decide it first (accept / rename / drop)
   *   OBJECTIVE_REVOKED   dropped: revoked objectives cannot be revived
   *   BAD_STATEMENT       no new statement
   *   STATEMENT_UNCHANGED the new statement is the current one (a no-op)
   *
   * @param {{proposalId?: string, statement?: string}} decision
   * @param {ValidatedProvenance} prov
   * @returns {DecisionRecord}
   */
  #applyReword(decision, prov) {
    const id = typeof decision.proposalId === "string" ? decision.proposalId.trim() : "";
    const entry = id ? this.#registry.get(id) : undefined;
    if (!entry) {
      throw new ConfirmGateError(`unknown objective: ${id || "(no id given)"}`, "UNKNOWN_OBJECTIVE");
    }
    const statement = requireText(decision.statement, "statement (verb: reword)", "BAD_STATEMENT");

    // Idempotent replay of the LATEST reword of this objective in this turn. An older identical key (A→B→A in
    // one turn) is a real change back and must apply, so it is not treated as a replay.
    const key = `reword:${id}:${prov.turnRef}:${hashStatement(statement)}`;
    const existing = this.#decisionsByKey.get(key);
    if (existing && this.#rewords.findLast((r) => r.objectiveId === id)?.decisionId === existing.id) return existing;

    if (entry.status === "proposed") {
      throw new ConfirmGateError(
        `objective ${id} is still a proposal — accept, rename or drop it first; reword changes a confirmed objective`,
        "NOT_CONFIRMED",
      );
    }
    const current = this.#confirmed.get(id);
    if (entry.status === "dropped" || !current) {
      throw new ConfirmGateError(`objective ${id} was revoked — a revoked objective cannot be reworded`, "OBJECTIVE_REVOKED");
    }
    if (prov.decidedAt < entry.record.proposedAt) {
      throw new FabricatedConfirmationError(
        "confirmation rejected: the decision predates the objective it decides",
        "TIME_TRAVEL",
      );
    }
    const previous = current.statement ?? null;
    if (previous !== null && statement === previous) {
      throw new ConfirmGateError("reword statement is identical to the current wording — nothing to change", "STATEMENT_UNCHANGED");
    }
    const originalStatement = entry.record.statement ?? null;
    const decisionRecord = this.#recordDecision({
      key,
      verb: "reword",
      proposalId: id,
      targetId: id,
      statement,
      rewordedFrom: {
        objectiveId: id,
        previousStatement: previous,
        originalStatement,
        kind: current.kind,
        publicId: current.publicId ?? null,
      },
      provenance: prov,
    });
    // Same id, same kind, new statement. The objective's own confirmation (decisionId/provenance: who accepted,
    // renamed or added it) is kept; the reword's act lives on `rewordedFrom` and on the decision.
    this.#confirmed.set(
      id,
      Object.freeze({
        ...current,
        statement,
        rewordedFrom: Object.freeze({
          decisionId: decisionRecord.id,
          previousStatement: previous,
          originalStatement,
          provenance: prov,
        }),
      }),
    );
    entry.decisionIds.push(decisionRecord.id);
    this.#rewords.push({ objectiveId: id, decisionId: decisionRecord.id, before: previous, after: statement });
    this.#markDirty();
    return decisionRecord;
  }

  /**
   * THE honest rule for a plan whose cited objectives were reworded. The plan stays what it was (confirmed or a
   * draft, publishable): the cited ids did not change, so nothing is invalidated and nothing is re-confirmed on
   * the teacher's behalf. But the plan was drafted from the OLD wording, so this reports every cited objective
   * reworded since the plan was last drafted or confirmed — `before` is the wording at that point, `after` the
   * current one. A new draft or a teacher re-confirmation (made with this report in view) clears it; a later
   * reword raises it again. An invalidated plan has its own re-confirmation story and reports nothing here.
   *
   * @param {string} [planId]  defaults to the current plan.
   * @returns {readonly {objectiveId: string, before: string|null, after: string, decisionId: string}[]}
   */
  rewordedSincePlan(planId) {
    const id = planId ?? this.#latestPlanId;
    const entry = id ? this.#plans.get(id) : null;
    if (!entry || entry.record.status === "invalidated") return Object.freeze([]);
    const cited = new Set(entry.record.activities.flatMap((a) => a.objectiveIds));
    /** @type {Map<string, {objectiveId: string, before: string|null, after: string, decisionId: string}>} */
    const out = new Map();
    for (const r of this.#rewords.slice(entry.wordingMark)) {
      if (!cited.has(r.objectiveId)) continue;
      const seen = out.get(r.objectiveId);
      out.set(r.objectiveId, { objectiveId: r.objectiveId, before: seen ? seen.before : r.before, after: r.after, decisionId: r.decisionId });
    }
    return Object.freeze([...out.values()].filter((r) => r.before !== r.after).map((r) => Object.freeze(r)));
  }

  /**
   * @param {{key: string, verb: string, proposalId: string|null, targetId: string, statement?: string, renamedFrom?: object, rewordedFrom?: object, provenance: ValidatedProvenance}} spec
   * @returns {DecisionRecord}
   */
  #recordDecision(spec) {
    /** @type {DecisionRecord} */
    const record = Object.freeze({
      id: this.#idFactory(),
      key: spec.key,
      verb: spec.verb,
      proposalId: spec.proposalId,
      targetId: spec.targetId,
      statement: spec.statement,
      renamedFrom: spec.renamedFrom ? Object.freeze({ ...spec.renamedFrom }) : undefined,
      rewordedFrom: spec.rewordedFrom ? Object.freeze({ ...spec.rewordedFrom }) : undefined,
      provenance: spec.provenance,
      boundCourseVersion: this.#nextVersion,
    });
    this.#decisionsByKey.set(spec.key, record);
    this.#decisions.push(record);
    this.#markDirty();
    return record;
  }

  /**
   * Dropping a confirmed objective invalidates every confirmed plan citing it —
   * unconfirmed (or revoked) objectives must not appear on a published plan.
   * @param {string} objectiveId @param {string} reason
   */
  #invalidatePlansCiting(objectiveId, reason) {
    for (const planEntry of this.#plans.values()) {
      const cites = planEntry.record.activities.some((a) => a.objectiveIds.includes(objectiveId));
      if (cites && planEntry.record.status === "confirmed") {
        planEntry.record.status = "invalidated";
        planEntry.invalidationReason = reason;
        this.#reopenCheckpoint("plan", reason);
      }
    }
  }

  /* -------------------------- plan (checkpoint 4) ------------------------ */

  /**
   * AI proposes a LessonPlan draft. Activities cite objective ids (confirmed or
   * still proposed) and MaterialVersion ids. The plan is a draft until
   * {@link ConfirmGate#confirmLessonPlan}.
   *
   * @param {{title: string, audience?: {ageRangeStart?: number, ageRangeEnd?: number}, activities: readonly object[]}} spec
   * @returns {Readonly<LessonPlanRecord>}
   */
  proposeLessonPlan({ title, audience, activities }) {
    this.#requirePriorCheckpoints("plan");
    if (!Array.isArray(activities) || activities.length === 0) {
      throw new ConfirmGateError("a lesson plan needs at least one activity", "BAD_PLAN");
    }
    const normalized = activities.map((raw) => {
      const objectiveIds = Array.isArray(raw.objectiveIds) ? [...raw.objectiveIds] : [];
      if (objectiveIds.length === 0) {
        throw new ConfirmGateError(`activity "${String(raw.title)}" must cite at least one objective`, "BAD_PLAN");
      }
      for (const objId of objectiveIds) {
        if (!this.#registry.has(objId) && !this.#confirmed.has(objId)) {
          throw new ConfirmGateError(`activity cites unknown objective id: ${objId}`, "UNKNOWN_OBJECTIVE");
        }
      }
      const evidenceIfAny = raw.evidenceIfAny ?? "none";
      if (evidenceIfAny === "chat" || evidenceIfAny === "student-chat") {
        throw new ConfirmGateError("student chat is not evidence of learning", "BAD_PLAN");
      }
      if (!EVIDENCE_KINDS.includes(evidenceIfAny)) {
        throw new ConfirmGateError(
          `evidenceIfAny must be one of ${EVIDENCE_KINDS.join("|")}, got: ${String(evidenceIfAny)}`,
          "BAD_PLAN",
        );
      }
      return Object.freeze({
        id: raw.id ? requireText(raw.id, "activity.id") : this.#idFactory(),
        title: requireText(raw.title, "activity.title", "BAD_PLAN"),
        minutes: Number.isFinite(raw.minutes) ? raw.minutes : 0,
        objectiveIds: Object.freeze(objectiveIds),
        materialVersionIds: Object.freeze([...(Array.isArray(raw.materialVersionIds) ? raw.materialVersionIds : [])]),
        learnerDoes: requireText(raw.learnerDoes, "activity.learnerDoes", "BAD_PLAN"),
        teacherDoes: requireText(raw.teacherDoes, "activity.teacherDoes", "BAD_PLAN"),
        evidenceIfAny,
        notEvidence: raw.notEvidence,
      });
    });

    const id = this.#idFactory();
    const record = {
      id,
      courseId: this.#courseId,
      courseVersion: this.#nextVersion,
      title: requireText(title, "plan title", "BAD_PLAN"),
      audience: audience ? Object.freeze({ ...audience }) : undefined,
      status: "draft",
      activities: Object.freeze(normalized),
      proposedBy: "ai",
      proposedAt: this.#clock(),
    };
    this.#plans.set(id, { record, confirmation: null, invalidationReason: null, wordingMark: this.#rewords.length });
    this.#latestPlanId = id;
    // A new plan proposal supersedes any prior plan confirmation.
    if (this.#checkpoints.get("plan").status === "confirmed") {
      this.#reopenCheckpoint("plan", "a new lesson plan proposal arrived");
    } else {
      this.#touchCheckpoint("plan");
    }
    this.#markDirty();
    return Object.freeze({ ...record });
  }

  /**
   * Explicit teacher confirmation of the lesson plan (checkpoint 4,
   * `confirm_lesson_plan`). Idempotent per (plan, turnRef); a later teacher
   * turn may re-confirm (e.g. after an invalidation + fix).
   *
   * @param {{planId?: string, provenance: TeacherProvenance}} spec
   * @returns {Readonly<LessonPlanRecord>}
   */
  confirmLessonPlan({ planId, provenance }) {
    this.#requirePriorCheckpoints("plan");
    const id = planId ?? this.#latestPlanId;
    if (!id) throw new ConfirmGateError("no lesson plan has been proposed yet", "UNKNOWN_PLAN");
    const entry = this.#plans.get(id);
    if (!entry) throw new ConfirmGateError(`unknown lesson plan: ${id}`, "UNKNOWN_PLAN");
    const prov = this.#requireTeacherProvenance(provenance, { notBefore: entry.record.proposedAt });

    const key = `confirm-plan:${id}:${prov.turnRef}`;
    if (entry.confirmation && entry.confirmation.key === key) {
      return Object.freeze({ ...entry.record }); // idempotent replay.
    }
    entry.record.status = "confirmed";
    entry.invalidationReason = null;
    entry.confirmation = { key, provenance: prov, decisionId: this.#idFactory(), boundCourseVersion: this.#nextVersion };
    entry.wordingMark = this.#rewords.length; // a deliberate re-confirmation is made with any reword notice in view
    const cp = this.#checkpoints.get("plan");
    cp.status = "confirmed";
    cp.provenance = prov;
    cp.note = `plan ${id} confirmed by the teacher`;
    this.#markDirty();
    return Object.freeze({ ...entry.record });
  }

  /* --------------------------- publish (checkpoint 5) -------------------- */

  /**
   * Hard publish blockers (also used for preview at checkpoint 5).
   * Unconfirmed proposals must not appear on a published lesson plan.
   * @returns {readonly string[]}
   */
  publishBlockers() {
    /** @type {string[]} */
    const blockers = [];
    for (const id of ["files", "outline", "objectives"]) {
      if (this.#checkpoints.get(id).status !== "confirmed") {
        blockers.push(`checkpoint "${id}" is not teacher-confirmed`);
      }
    }
    const undecided = this.#undecidedProposalIds();
    if (undecided.length > 0) {
      blockers.push(`undecided proposals await teacher decisions: ${undecided.join(", ")}`);
    }
    const planEntry = this.#latestPlanId ? this.#plans.get(this.#latestPlanId) : null;
    if (!planEntry || planEntry.record.status !== "confirmed" || this.#checkpoints.get("plan").status !== "confirmed") {
      blockers.push(
        planEntry && planEntry.record.status === "invalidated"
          ? `lesson plan ${planEntry.record.id} is invalidated (${planEntry.invalidationReason}) and needs teacher re-confirmation`
          : "no teacher-confirmed lesson plan",
      );
    } else {
      if (planEntry.record.activities.length === 0) {
        blockers.push("lesson plan has no activities");
      }
      const cited = new Set(planEntry.record.activities.flatMap((a) => a.objectiveIds));
      for (const objId of cited) {
        const entry = this.#registry.get(objId);
        if (!this.#confirmed.has(objId)) {
          const status = entry ? entry.status : "unknown";
          blockers.push(`objective ${objId} is not confirmed (status: ${status}) — unconfirmed objectives must not appear on a published lesson plan`);
        }
      }
    }
    return Object.freeze(blockers);
  }

  /**
   * Preview of publish readiness (checkpoint 5 preview-then-confirm).
   * @returns {{canPublish: boolean, blockers: readonly string[]}}
   */
  publishStatus() {
    const blockers = this.publishBlockers();
    return Object.freeze({ canPublish: blockers.length === 0, blockers });
  }

  /**
   * Publish a NEW immutable CoursePackage version (checkpoint 5). Requires
   * explicit teacher provenance — the AI never publishes. Versions bump and
   * are never overwritten.
   *
   * Idempotent when nothing changed since the last publish: the previous
   * version record is returned as-is (MCP retry semantics).
   *
   * @param {{provenance: TeacherProvenance, note?: string}} spec
   * @returns {Readonly<object>} the published CoursePackage version record
   */
  publish({ provenance, note = null }) {
    const blockers = this.publishBlockers();
    if (blockers.length > 0) throw new PublishBlockedError(blockers);
    const prov = this.#requireTeacherProvenance(provenance);
    if (!this.#dirty && this.#history.length > 0) {
      return this.#history[this.#history.length - 1]; // idempotent replay.
    }

    const planEntry = this.#plans.get(this.#latestPlanId);
    const version = this.#nextVersion;
    const record = Object.freeze({
      courseId: this.#courseId,
      version,
      previousVersion: this.#history.length ? this.#history[this.#history.length - 1].version : null,
      title: this.#title,
      description: this.#description,
      owner: this.#owner,
      status: "published",
      objectiveRefs: Object.freeze([...this.#confirmed.values()].map((o) => Object.freeze({ ...o }))), // confirmed only
      materials: this.#materials,
      lessonPlan: Object.freeze({ ...planEntry.record, courseVersion: version, status: "confirmed" }),
      retrievalModes: Object.freeze(["host_native", "lexical", "direct_reading"]),
      publishedAt: prov.decidedAt,
      note,
      provenance: prov,
    });
    this.#history.push(record);
    this.#nextVersion = version + 1;
    this.#dirty = false;
    const cp = this.#checkpoints.get("publish");
    cp.status = "confirmed";
    cp.provenance = prov;
    cp.note = `published version ${version}`;
    return record;
  }

  /**
   * Immutable history lookup. Published versions are never overwritten.
   * @param {number} version
   * @returns {Readonly<object>}
   */
  getVersion(version) {
    const record = this.#history.find((r) => r.version === version);
    if (!record) throw new ConfirmGateError(`unknown version: ${version}`, "UNKNOWN_VERSION");
    return record;
  }

  /** @returns {readonly object[]} All published version records (frozen). */
  versions() {
    return Object.freeze([...this.#history]);
  }

  /* ------------------------------- readers ------------------------------- */

  /** @returns {readonly ObjectiveRecord[]} The confirmed set (and nothing else). */
  confirmedObjectives() {
    return Object.freeze([...this.#confirmed.values()].map((o) => Object.freeze({ ...o })));
  }

  /**
   * @param {string} objectiveId
   * @returns {Readonly<object>|null}
   */
  getObjective(objectiveId) {
    const entry = this.#confirmed.get(objectiveId);
    return entry ? Object.freeze({ ...entry }) : null;
  }

  /**
   * The ORIGINAL proposal record — immutable provenance material. A rename
   * never mutates this.
   * @param {string} proposalId
   * @returns {Readonly<ObjectiveRecord>|null}
   */
  getProposal(proposalId) {
    const entry = this.#registry.get(proposalId);
    return entry ? entry.record : null;
  }

  /** @returns {readonly DecisionRecord[]} All recorded teacher decisions, in order. */
  decisions() {
    return Object.freeze([...this.#decisions]);
  }

  /**
   * @param {string} planId
   * @returns {Readonly<LessonPlanRecord>|null}
   */
  getPlan(planId) {
    const entry = this.#plans.get(planId);
    return entry ? Object.freeze({ ...entry.record }) : null;
  }

  /** @returns {Readonly<LessonPlanRecord>|null} The current (latest) plan record. */
  currentPlan() {
    return this.#latestPlanId ? this.getPlan(this.#latestPlanId) : null;
  }
}
