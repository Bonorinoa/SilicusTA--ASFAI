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
 * The host calls the MCP itself (`host/asfai/`). This module still only records
 * what that call returned and what the teacher answered. It never invents a field.
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
  // What the TEACHER said, keyed by the question ids ASFAI asked. This is the only
  // thing the second prepare_outline call may be built from.
  #answers = null;

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
  answer({ viaChannel, text, answers = null, at }) {
    this.#roundAnswered = true;
    // A conversation answers one question at a time. A later reply adds a key;
    // it must not erase the ones already recorded. A blank reply leaves them.
    const cleaned = cleanAnswers(answers, this.#questions);
    if (cleaned && Object.keys(cleaned).length) {
      this.#answers = { ...(this.#answers ?? {}), ...cleaned };
    }
    return this.#guard.onTeacherReply(text, { via: viaChannel, at });
  }

  /**
   * The payload for the NEXT prepare_outline call, or a refusal. Round 1 asks with no
   * fields (that is how ASFAI opens its questionnaire). After a clarifying round the
   * fields come from the teacher's recorded answers and from nowhere else: the host
   * never fills topic / course / learningOutcomes itself.
   */
  nextCall() {
    const gate = this.mayCallPrepareOutline();
    if (!gate.allowed) return { allowed: false, code: gate.code, reason: gate.reason };
    if (!this.#roundOpened) return { allowed: true, payload: { mode: "new", audience: "teacher" } };
    if (this.#observedState === "ready_to_draft") return { allowed: false, code: "ALREADY_READY", reason: "the intake already reached ready_to_draft" };
    const a = this.#answers;
    if (!a || Object.keys(a).length === 0) {
      return { allowed: false, code: "NO_TEACHER_ANSWERS", reason: "the teacher's reply carried no answers to the questions; nothing may be sent on their behalf" };
    }
    // A partial round must not go out. The teacher has not answered every question
    // ASFAI asked that this host knows how to forward.
    const missing = this.#questions.map((q) => q.id).filter((id) => KNOWN.has(id) && !hasAnswer(a, id));
    if (missing.length) {
      return { allowed: false, code: "INCOMPLETE_ANSWERS", reason: `still waiting for the teacher's answer to: ${missing.join(", ")}` };
    }
    return {
      allowed: true,
      payload: {
        mode: "new", audience: "teacher",
        ...(a.topic ? { topic: a.topic } : {}),
        ...(a.course ? { course: a.course } : {}),
        ...(a.learning_outcomes ? { learningOutcomes: a.learning_outcomes } : {}),
      },
    };
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

  /**
   * The teacher's recorded answers, keyed by the question id ASFAI asked. A copy:
   * a caller may read them, never mutate them. This is what checkpoint 3 derives
   * its proposals from.
   */
  answers() {
    return publicAnswers(this.#answers);
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
      answeredKeys: this.#answers ? Object.keys(this.#answers) : [],
      answers: this.answers(),
      draftAuthorization: this.#guard.hasDraftAuthorization(),
      outlineAuthorized: this.outlineAuthorized(),
      mayCallPrepareOutline: call.allowed,
      refusal: call.allowed ? null : { code: call.code, reason: call.reason },
    };
  }
}

const MAX_FIELD = 2000;
const KNOWN = new Set(["topic", "course", "learning_outcomes"]);

/** Only keys ASFAI actually asked about survive; values are trimmed teacher words, bounded. */
function cleanAnswers(raw, asked) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const askedIds = new Set((asked ?? []).map((q) => q.id));
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN.has(key) || !askedIds.has(key)) continue; // an answer to a question nobody asked is ignored
    const v = raw[key];
    if (key === "learning_outcomes") {
      const list = (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
      if (list.length) out[key] = list.map((x) => x.slice(0, MAX_FIELD));
    } else if (typeof v === "string" && v.trim()) {
      out[key] = v.trim().slice(0, MAX_FIELD);
    }
  }
  return out;
}

function hasAnswer(a, id) {
  const v = a?.[id];
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.length > 0;
}

/** A copy. Callers must not be able to mutate the recorded answers. */
function publicAnswers(a) {
  if (!a) return {};
  const out = { ...a };
  if (Array.isArray(out.learning_outcomes)) out.learning_outcomes = [...out.learning_outcomes];
  return out;
}
