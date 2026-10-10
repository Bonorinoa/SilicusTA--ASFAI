/**
 * service.mjs — the two things the host asks ASFAI, and the rules that bind them.
 *
 *  runIntake(session): one prepare_outline call, built ONLY from what the session's
 *    intake allows (round 1 = no fields; later = the teacher's recorded answers). The
 *    response is recorded as an OBSERVATION because the host saw it first-hand.
 *  validate(session):  validate_outline on the drafted spine. A validity signal, never
 *    a confirmation: it is stored as an event and the teacher still decides.
 *
 * Nothing here can mint a teacher turn or a confirmation; it holds no TeacherChannel.
 */
export class AsfaiService {
  constructor({ oauth, client }) { this.oauth = oauth; this.client = client; }

  status() { return this.oauth.status(); }

  async runIntake(session) {
    const next = session.intakeNextCall();
    if (!next.allowed) {
      const e = new Error(next.reason); e.code = next.code; throw e; // gate refusal: 409 upstream
    }
    const r = await this.client.callTool("asfai_lesson", { action: "prepare_outline", payload: next.payload });
    if (r?.state !== "clarifying" && r?.state !== "ready_to_draft") {
      const e = new Error("ASFAI returned a prepare_outline result the host does not recognise"); e.code = "UNEXPECTED_RESULT"; throw e;
    }
    return session.observeIntake({
      state: r.state,
      questions: Array.isArray(r.questions) ? r.questions : [],
      draftAuthorization: r.draftAuthorization ?? null,
      receipt: r.clarificationReceipt ?? null,
      sent: Object.keys(next.payload).filter((k) => !["mode", "audience"].includes(k)), // field NAMES only, never content
    });
  }

  async validate(session) {
    const built = session.outlineForValidation();
    if (!built.ok) { const e = new Error(built.reason); e.code = built.code; throw e; }
    const r = await this.client.callTool("asfai_lesson", { action: "validate_outline", outline: built.outline });
    return session.recordValidation({
      planId: built.planId,
      valid: r?.valid === true,
      issues: Array.isArray(r?.issues) ? r.issues.map((i) => String(i).slice(0, 300)).slice(0, 20) : [],
    });
  }
}
