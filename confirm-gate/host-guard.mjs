/**
 * host-guard.mjs — Silicus TA 3.0 host-side residual rule (confirm-gate v0).
 *
 * Closes the residual hole left open by ASFAI PR #15 (clarification receipts):
 * the server can force a clarification round before it issues a
 * `draftAuthorization`, but it cannot prove a human was asked. A host can
 * still call `prepare_outline` twice in the same turn and echo the receipt it
 * just obtained with invented answers. That residual rule is HOST-side law.
 *
 * This module provides:
 *   1. `TurnLedger`  — an append-only record of conversation turns with roles.
 *      Only turns recorded from an inbound user message (via a `TeacherChannel`
 *      capability) carry the `teacher` role. Model output can only ever be
 *      recorded as `assistant`. There is no code path from a tool call or a
 *      model-authored object to a `teacher` turn.
 *   2. `ResidualRuleGuard` — a state machine over those turns:
 *        idle ──prepare_outline result (clarifying)──▶ clarifying
 *        clarifying ──teacher turn observed──▶ ready
 *        idle/ready ──prepare_outline result (ready_to_draft)──▶ ready
 *      While `clarifying`, `beforePrepareOutline()` refuses the call. A
 *      clarification receipt issued in a clarifying round is *unarmed* until a
 *      teacher turn lands after that round; echoing an unarmed receipt is
 *      refused too ("do not echo a receipt you obtained without asking").
 *
 * Zero dependencies: plain ES modules + JSDoc types. Runs on Node >= 18
 * (tested on Node 22) with `node --test`.
 *
 * @module host-guard
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {"teacher"|"assistant"} TurnRole
 */

/**
 * @typedef {Object} TurnRecord
 * @property {string} id          Stable turn reference, `urn:turn:<n>` (1-based).
 * @property {number} index       1-based position in the ledger.
 * @property {TurnRole} role      Who produced the turn. Never spoofable via this module's API.
 * @property {string} actorId     Teacher identifier, or `"assistant"`.
 * @property {string} channel     Originating channel (e.g. `"silicus-ui"`).
 * @property {string} origin      `"inbound-user-message"` or `"model-output"`.
 * @property {string} text        The turn's text (non-empty).
 * @property {number} at          Epoch ms when the turn was recorded.
 */

/**
 * Turn reference string. The only currency a confirmation may cite.
 * @typedef {string} TurnRef
 */

/**
 * @typedef {Object} ToolResultObservation
 * @property {"clarifying"|"ready_to_draft"} state  The `state` field of the tool result.
 * @property {string[]} [questionIds]               Question ids the tool asked (`questions[].id`).
 * @property {string|null} [receipt]                HMAC `clarificationReceipt` issued with the result, if any.
 * @property {string|null} [draftAuthorization]     `draftAuthorization` bound to topic|course|audience|outcomes, if any.
 * @property {string|null} [echoedReceipt]          Receipt the host echoed on the call that produced this result.
 * @property {number} [at]                          Epoch ms (defaults to the guard clock).
 */

/**
 * @typedef {Object} GuardDecision
 * @property {boolean} allowed
 * @property {string} [code]    Machine-readable refusal code.
 * @property {string} [reason]  Human-readable reason to surface to the teacher.
 */

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** Error raised for invalid ledger/guard usage. Carries a machine-readable `code`. */
export class TurnLedgerError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.name = "TurnLedgerError";
    /** @type {string} */
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* TurnLedger                                                                  */
/* -------------------------------------------------------------------------- */

const TEACHER_ORIGIN = "inbound-user-message";
const MODEL_ORIGIN = "model-output";

/**
 * A capability object that lets a *transport layer* record genuine inbound
 * teacher messages. Created only via {@link TurnLedger#teacherChannel}. The
 * model's tool surface must never hold one; that is what makes an AI-fabricated
 * "teacher turn" structurally impossible inside this process.
 */
export class TeacherChannel {
  /**
   * @param {TurnLedger} ledger
   * @param {string} teacherId
   * @param {string} channel
   */
  constructor(ledger, teacherId, channel) {
    if (!teacherId || typeof teacherId !== "string") {
      throw new TurnLedgerError("TeacherChannel requires a non-empty teacherId", "BAD_CHANNEL");
    }
    if (!channel || typeof channel !== "string") {
      throw new TurnLedgerError("TeacherChannel requires a non-empty channel name", "BAD_CHANNEL");
    }
    Object.defineProperty(this, "_ledger", { value: ledger, enumerable: false });
    /** @type {string} */
    this.teacherId = teacherId;
    /** @type {string} */
    this.channel = channel;
    Object.freeze(this);
  }

  /**
   * Record one genuine inbound teacher message.
   * @param {string} text
   * @param {number} [at] Epoch ms (defaults to the ledger clock).
   * @returns {TurnRef}
   */
  say(text, at) {
    return this._ledger._record({
      role: "teacher",
      actorId: this.teacherId,
      channel: this.channel,
      origin: TEACHER_ORIGIN,
      text,
      at,
    });
  }
}

/**
 * Append-only ledger of conversation turns with enforced roles.
 *
 * Structural guarantee: the ONLY way to create a `teacher` turn is
 * {@link TeacherChannel#say}, and a channel is only mintable by the host
 * transport (which calls {@link TurnLedger#teacherChannel} with the real
 * teacher identity when an inbound user message arrives). Model output is
 * recorded through {@link TurnLedger#recordAssistantTurn} and can never
 * satisfy a teacher-confirmation requirement.
 */
export class TurnLedger {
  #turns = [];
  #clock;

  /**
   * @param {{clock?: () => number}} [options]
   */
  constructor({ clock = () => Date.now() } = {}) {
    this.#clock = clock;
  }

  /**
   * Mint a teacher channel capability. Call this ONLY from the inbound-message
   * hook of the host transport, never on behalf of the model.
   * @param {{teacherId: string, channel?: string}} identity
   * @returns {TeacherChannel}
   */
  teacherChannel({ teacherId, channel = "silicus-ui" } = {}) {
    return new TeacherChannel(this, teacherId, channel);
  }

  /**
   * Record a model-produced turn. Never a teacher turn.
   * @param {string} text
   * @param {{channel?: string, at?: number}} [options]
   * @returns {TurnRef}
   */
  recordAssistantTurn(text, { channel = "model", at } = {}) {
    return this._record({ role: "assistant", actorId: "assistant", channel, origin: MODEL_ORIGIN, text, at });
  }

  /**
   * Internal append. Use {@link TeacherChannel#say} or
   * {@link TurnLedger#recordAssistantTurn} instead.
   * @param {{role: TurnRole, actorId: string, channel: string, origin: string, text: string, at?: number}} spec
   * @returns {TurnRef}
   * @internal
   */
  _record(spec) {
    if (typeof spec.text !== "string" || spec.text.trim().length === 0) {
      throw new TurnLedgerError("turn text must be a non-empty string", "EMPTY_TURN");
    }
    const index = this.#turns.length + 1;
    /** @type {TurnRecord} */
    const record = Object.freeze({
      id: `urn:turn:${index}`,
      index,
      role: spec.role,
      actorId: spec.actorId,
      channel: spec.channel,
      origin: spec.origin,
      text: spec.text,
      at: spec.at ?? this.#clock(),
    });
    this.#turns.push(record);
    return record.id;
  }

  /**
   * @param {TurnRef} ref
   * @returns {TurnRecord}
   */
  getTurn(ref) {
    const m = /^urn:turn:(\d+)$/.exec(String(ref ?? ""));
    if (!m) throw new TurnLedgerError(`malformed turn reference: ${String(ref)}`, "BAD_TURN_REF");
    const record = this.#turns[Number(m[1]) - 1];
    if (!record) throw new TurnLedgerError(`unknown turn reference: ${ref}`, "UNKNOWN_TURN");
    return record;
  }

  /**
   * @param {TurnRef} ref
   * @returns {boolean}
   */
  isTeacherTurn(ref) {
    try {
      return this.getTurn(ref).role === "teacher";
    } catch {
      return false;
    }
  }

  /** @returns {number} Number of recorded turns. */
  get size() {
    return this.#turns.length;
  }

  /**
   * Frozen copy of all turns (portable decision-trace material).
   * @returns {readonly TurnRecord[]}
   */
  list() {
    return Object.freeze([...this.#turns]);
  }
}

/* -------------------------------------------------------------------------- */
/* ResidualRuleGuard                                                           */
/* -------------------------------------------------------------------------- */

/** Guard states. */
export const GUARD_STATE = Object.freeze({
  /** No outstanding clarification; a prepare_outline call is unblocked. */
  IDLE: "idle",
  /** Last prepare_outline result was `clarifying`; a teacher reply is owed. */
  CLARIFYING: "clarifying",
  /** Teacher replied (or a ready_to_draft result landed); call unblocked. */
  READY: "ready",
});

/**
 * @typedef {Object} ClarifyingRound
 * @property {number} round
 * @property {readonly string[]} questionIds
 * @property {string|null} receipt
 * @property {number} afterTurnIndex  Ledger size when the result was observed.
 * @property {number} resultAt
 * @property {boolean} armed           True once a teacher turn lands after the round.
 * @property {TurnRef|null} armedByTurnRef
 */

/**
 * Host-side residual rule over conversation turns:
 * after a `prepare_outline` result with `state: "clarifying"`, no second
 * `prepare_outline` call may be made until a teacher turn is observed.
 * A `clarificationReceipt` from that round may not be echoed until then either.
 */
export class ResidualRuleGuard {
  #ledger;
  #clock;
  /** @type {string} */
  #state = GUARD_STATE.IDLE;
  /** @type {ClarifyingRound|null} */
  #clarifying = null;
  #round = 0;
  /** @type {Map<string, {round: number, armed: boolean, used: boolean, armedByTurnRef: string|null}>} */
  #receipts = new Map();
  /** @type {boolean} */
  #hasDraftAuthorization = false;
  /** @type {object[]} */
  #log = [];

  /**
   * @param {{ledger?: TurnLedger, clock?: () => number}} [options]
   */
  constructor({ ledger = new TurnLedger(), clock = () => Date.now() } = {}) {
    this.#ledger = ledger;
    this.#clock = clock;
  }

  /** @returns {TurnLedger} The shared turn ledger (share it with the confirm gate). */
  get ledger() {
    return this.#ledger;
  }

  /** @returns {string} One of {@link GUARD_STATE}. */
  get state() {
    return this.#state;
  }

  /**
   * Record an ACTUAL `prepare_outline` tool result (called by the host tool
   * transport after the call returns — this never throws on honest reporting).
   * @param {ToolResultObservation} result
   * @returns {ClarifyingRound|null} The clarifying round, when the result was clarifying.
   */
  onPrepareOutlineResult(result) {
    const at = result.at ?? this.#clock();
    if (result.echoedReceipt) {
      const entry = this.#receipts.get(result.echoedReceipt);
      if (entry) entry.used = true;
    }
    if (result.state === "clarifying") {
      this.#round += 1;
      const questionIds = Object.freeze([...(result.questionIds ?? [])]);
      const receipt = result.receipt ?? null;
      /** @type {ClarifyingRound} */
      const live = {
        round: this.#round,
        questionIds,
        receipt,
        afterTurnIndex: this.#ledger.size,
        resultAt: at,
        armed: false,
        armedByTurnRef: null,
      };
      this.#clarifying = live;
      this.#state = GUARD_STATE.CLARIFYING;
      if (receipt) this.#receipts.set(receipt, { round: live.round, armed: false, used: false, armedByTurnRef: null });
      this.#log.push({ event: "prepare_outline.result", state: "clarifying", round: live.round, questionIds, receiptIssued: receipt, at });
      return Object.freeze({ ...live });
    }
    if (result.state === "ready_to_draft") {
      if (result.draftAuthorization) this.#hasDraftAuthorization = true;
      this.#clarifying = null;
      this.#state = GUARD_STATE.READY;
      this.#log.push({ event: "prepare_outline.result", state: "ready_to_draft", draftAuthorization: result.draftAuthorization ?? null, at });
      return null;
    }
    throw new TurnLedgerError(`unknown prepare_outline state: ${String(result.state)}`, "BAD_TOOL_RESULT");
  }

  /**
   * MUST be called before every `prepare_outline` call. Pure check — safe to
   * call speculatively.
   *
   * Refuses when:
   *  - the guard is `clarifying` (residual rule: the teacher has not replied), or
   *  - a `clarificationReceipt` is being echoed that was obtained in a
   *    clarifying round no teacher has answered yet ("obtained without asking"),
   *  - a receipt is being re-used after it was already echoed once.
   *
   * @param {{receipt?: string|null}} [options]
   * @returns {GuardDecision}
   */
  beforePrepareOutline({ receipt = null } = {}) {
    if (receipt) {
      const entry = this.#receipts.get(receipt);
      if (entry && !entry.armed) {
        return {
          allowed: false,
          code: "RECEIPT_NOT_ARMED",
          reason:
            "This clarificationReceipt was obtained in a clarifying round that no teacher has answered. " +
            "Echoing it now would fabricate teacher answers. Ask the teacher first.",
        };
      }
      if (entry && entry.used) {
        return {
          allowed: false,
          code: "RECEIPT_ALREADY_USED",
          reason: "This clarificationReceipt has already been consumed by one prepare_outline call.",
        };
      }
    }
    if (this.#state === GUARD_STATE.CLARIFYING) {
      const round = this.#clarifying;
      return {
        allowed: false,
        code: "AWAITING_TEACHER_REPLY",
        reason:
          `prepare_outline returned state "clarifying" (round ${round?.round}, questions: ` +
          `${(round?.questionIds ?? []).join(", ") || "confirm_intake"}). Surface the questions and wait for a teacher ` +
          `reply before calling prepare_outline again. Do not invent answers.`,
      };
    }
    return { allowed: true };
  }

  /**
   * Record a genuine teacher reply. Only a {@link TeacherChannel} minted by the
   * host transport can produce this — passing anything else throws, which is
   * what makes AI self-unblocking structurally impossible.
   *
   * Arms the outstanding clarifying round (and its receipt) and moves the guard
   * to `ready`.
   *
   * @param {string} text        The teacher's reply text.
   * @param {{via: TeacherChannel, at?: number}} options `via` MUST be a TeacherChannel.
   * @returns {TurnRef}
   */
  onTeacherReply(text, { via, at } = {}) {
    if (!(via instanceof TeacherChannel) || via._ledger !== this.#ledger) {
      throw new TurnLedgerError(
        "onTeacherReply requires a TeacherChannel minted by this guard's ledger (host transport only)",
        "NOT_A_TEACHER_CHANNEL",
      );
    }
    const ref = via.say(text, at ?? this.#clock());
    const turn = this.#ledger.getTurn(ref);
    const round = this.#clarifying;
    if (this.#state === GUARD_STATE.CLARIFYING && round && turn.index > round.afterTurnIndex) {
      round.armed = true;
      round.armedByTurnRef = ref;
      if (round.receipt) {
        const entry = this.#receipts.get(round.receipt);
        if (entry) {
          entry.armed = true;
          entry.armedByTurnRef = ref;
        }
      }
      this.#state = GUARD_STATE.READY;
    }
    this.#log.push({ event: "teacher.reply", turnRef: ref, at: turn.at });
    return ref;
  }

  /**
   * True when a `draftAuthorization` (PR #15) has been observed on a tool
   * result. Note: this is proof the server accepted the intake round, NOT
   * proof of any teacher decision — decisions live in the confirm gate.
   * @returns {boolean}
   */
  hasDraftAuthorization() {
    return this.#hasDraftAuthorization;
  }

  /**
   * Portable decision-trace snapshot (frozen; safe to attach to exports).
   * @returns {Readonly<{state: string, clarifyingRound: object|null, receipts: object[], log: readonly object[]}>}
   */
  snapshot() {
    return Object.freeze({
      state: this.#state,
      clarifyingRound: this.#clarifying ? Object.freeze({ ...this.#clarifying }) : null,
      receipts: Object.freeze([...this.#receipts.entries()].map(([receipt, meta]) => Object.freeze({ receipt, ...meta }))),
      hasDraftAuthorization: this.#hasDraftAuthorization,
      log: Object.freeze([...this.#log]),
    });
  }
}
