/**
 * intake.mjs — checkpoints 2's host-side gate: ASFAI's clarification round, made
 * unskippable, and the outline kept from being confirmed on an intake that never
 * happened.
 *
 * Live contract (captured 2026-10-10, fixtures/lesson-intake.json; asfai-learning
 * 2.0.0): `prepare_outline` with mode "new" and no fields returns
 * state "clarifying" with three open questions and issues NO clarificationReceipt;
 * returning the fields yields "ready_to_draft" with NO draftAuthorization. So the
 * host binds checkpoint 2 to what actually happened rather than to a server token:
 *
 *   the outline may be teacher-confirmed only once the host has OBSERVED a
 *   ready_to_draft intake result AND the guard is no longer sitting in a
 *   clarifying round, i.e. a real teacher turn landed after the questions.
 *
 * Consequences that are deliberate: reporting ready_to_draft while a clarifying
 * round is still outstanding does NOT authorize anything (that is the bypass the
 * residual rule exists to block); an armed receipt is single-use on echo; and a
 * draftAuthorization, if a future server emits one, authorizes on its own.
 *
 * The host does not call the MCP itself yet (no in-process OAuth client). The
 * runtime asks `status()` -> `mayCallPrepareOutline`, makes the real call, and
 * reports what it got here. That mirrors host-guard's design: the guard observes
 * tool results, it never executes them.
 */
import { ResidualRuleGuard } from "../confirm-gate/host-guard.mjs";

export class LessonIntake {
  #guard;
  #courseId;
  #observedState = null;
  #questions = [];
  // The residual rule, at the intake level. host-guard's own
  // onPrepareOutlineResult(ready_to_draft) CLEARS an outstanding clarifying round
  // without requiring that a teacher answered — correct for its contract
  // (SPEC §7 treats ready_to_draft as the round having completed), but the host
  // cannot verify that, so the intake tracks the round itself and refuses to
  // count a round as completed unless a teacher turn landed after the questions.
  #roundOpened = false;
  #roundAnswered = false;

  constructor({ ledger, courseId }) {
    this.#guard = new ResidualRuleGuard({ ledger });
    this.#courseId = courseId;
  }

  /** Record an OBSERVED prepare_outline result. Honest reporting never throws except on shape. */
  observe({ state, questions = [], draftAuthorization = null, receipt = null, at } = {}) {
    if (state !== "clarifying" && state !== "ready_to_draft") {
      throw new Error(`unknown prepare_outline state: ${String(state)}`);
    }
    this.#guard.onPrepareOutlineResult({
      state,
      questionIds: (questions ?? []).map((q) => q.id),
      receipt,
      draftAuthorization,
      at,
    });
    this.#observedState = state;
    if (state === "clarifying") {
      this.#roundOpened = true;
      this.#roundAnswered = false;
      this.#questions = (questions ?? []).map((q) => ({ id: q.id, prompt: q.prompt, reason: q.reason ?? null }));
    } else {
      this.#questions = [];
    }
    return this.status();
  }

  /**
   * The teacher answered. Only the session may call this: it must pass a
   * TeacherChannel minted off the session ledger, which is what makes an
   * AI-self-unblocking reply structurally impossible.
   */
  answer({ viaChannel, text, at }) {
    this.#roundAnswered = true;
    return this.#guard.onTeacherReply(text, { via: viaChannel, at });
  }

  /** Consult BEFORE every prepare_outline call. */
  mayCallPrepareOutline() {
    if (this.#roundOpened && !this.#roundAnswered) {
      return {
        allowed: false,
        code: "AWAITING_TEACHER_REPLY",
        reason:
          "The intake asked clarifying questions and the teacher has not answered. Surface them and wait " +
          "for a real reply before calling prepare_outline again.",
      };
    }
    return this.#guard.beforePrepareOutline();
  }

  /**
   * May checkpoint 2 be teacher-confirmed? Yes only for an OBSERVED ready_to_draft
   * with no outstanding clarifying round (the guard is `ready`, not `clarifying`),
   * or for an observed draftAuthorization.
   */
  outlineAuthorized() {
    if (this.#guard.hasDraftAuthorization()) return true;
    return (
      this.#observedState === "ready_to_draft" &&
      this.#guard.state !== "clarifying" &&
      (!this.#roundOpened || this.#roundAnswered)
    );
  }

  /** The gate's older shape, kept so either contract can authorize. */
  hasDraftAuthorization() {
    return this.#guard.hasDraftAuthorization();
  }

  status() {
    // NB: the LAYERED rule, not the guard directly — the guard alone clears an
    // unanswered clarifying round when a ready_to_draft result arrives.
    const call = this.mayCallPrepareOutline();
    return {
      courseId: this.#courseId,
      guardState: this.#guard.state,
      observedState: this.#observedState,
      roundOpened: this.#roundOpened,
      roundAnswered: this.#roundAnswered,
      questions: this.#questions,
      draftAuthorization: this.#guard.hasDraftAuthorization(),
      outlineAuthorized: this.outlineAuthorized(),
      mayCallPrepareOutline: call.allowed,
      refusal: call.allowed ? null : { code: call.code, reason: call.reason },
    };
  }
}
