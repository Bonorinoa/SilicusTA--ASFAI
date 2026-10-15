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
import { outcomeSentences } from "./proposer.mjs";

/**
 * The questions the HOST asks when ASFAI is not in the loop. Same ids and prompts as the
 * live asfai_learning questionnaire (fixtures/lesson-intake.json) on purpose: every
 * downstream derivation keys on these ids (KNOWN, cleanAnswers, objectivesFromAnswers,
 * the learningOutcomes payload), so "who asked" is the only difference. The ids are field
 * names, not ASFAI IP. Frozen and module-level so replay is deterministic.
 */
export const LOCAL_QUESTIONS = Object.freeze([
  Object.freeze({ id: "topic", prompt: "What topic should this lesson cover?", reason: "The outline needs a subject." }),
  Object.freeze({ id: "course", prompt: "Which course is this part of?", reason: "Course context sets scope and sequencing." }),
  Object.freeze({ id: "learning_outcomes", prompt: "What should learners be able to do by the end?", reason: "An observable outcome anchors the outline." }),
]);

export class LessonIntake {
  #guard;
  #courseId;
  #observedState = null;
  #questions = LOCAL_QUESTIONS;
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

  /** Has the host heard from ASFAI at all? Derived, so it replays with no extra event. */
  #asfaiConsulted() {
    return this.#observedState !== null;
  }

  /** Did the teacher's answers go to ASFAI? The honest basis for a source label. */
  sentToAsfai() {
    return this.#asfaiConsulted();
  }

  /**
   * Every question the host asked that it knows how to forward has an answer.
   * `KNOWN` and `hasAnswer` are the same rules `nextCall()` uses for INCOMPLETE_ANSWERS,
   * so "authorized" and "complete" cannot drift apart. `#answers` is only ever written by
   * answer(), which needs a session-minted TeacherChannel: the host cannot authorize
   * itself by merely asking.
   */
  #localAnswersComplete() {
    const asked = this.#questions.filter((q) => KNOWN.has(q.id));
    return asked.length > 0 && asked.every((q) => hasAnswer(this.#answers, q.id));
  }

  /**
   * May checkpoint 2 be teacher-confirmed?
   *
   * Two paths, and which one applies is DERIVED, not declared:
   *
   *  - ASFAI was never consulted: the host asked its own questions and the teacher
   *    answered every one of them. The only evidence is their recorded turn — no
   *    server token is involved, so there is nothing to fabricate.
   *  - ASFAI was consulted: the existing rule, unchanged. An OBSERVED ready_to_draft
   *    with no outstanding clarifying round (the guard is `ready`, not `clarifying`),
   *    or an observed draftAuthorization.
   *
   * The ASFAI path is not weakened by the local one: gating local on "never consulted"
   * means the ASFAI flow behaves exactly as before.
   */
  outlineAuthorized() {
    if (this.#guard.hasDraftAuthorization()) return true;
    if (!this.#asfaiConsulted()) return this.#localAnswersComplete();
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
      questionsFrom: this.#asfaiConsulted() ? "asfai" : "local",
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
const MAX_OUTCOMES = 12;
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
      // The split rule lives in proposer.outcomeSentences and NOWHERE else: the same
      // function builds the objectives the teacher confirms, so the list ASFAI is told
      // and the list the teacher confirms cannot drift apart. Bounds are applied here.
      const list = outcomeSentences(v).slice(0, MAX_OUTCOMES);
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
