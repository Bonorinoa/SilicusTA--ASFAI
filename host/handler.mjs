/**
 * handler.mjs — the Silicus API, independent of the transport that carries it.
 *
 * One API, two hosts. The route table, the intents-only request shapes, the per-course lock, the
 * verified replay per request and the error-to-status mapping live HERE and nowhere else:
 *
 *   - server.mjs wraps it in node:http (the local app: a disk log, the host's own ASFAI credential,
 *     a worker configured from the environment, the host's own guarded URL fetch);
 *   - the browser host (frontend/src/browser/) calls it in-page (the online app: the log in IndexedDB,
 *     ASFAI off, the worker and the URL fetch behind the site's two functions).
 *
 * The hosts differ only in the DEPENDENCIES they inject. Neither has its own copy of a route or a
 * policy, so a rule tightened here is tightened for both.
 *
 * The request shape is the trust boundary: clients send INTENTS only ({ verb, proposalId, statement,
 * text }). No field anywhere in this API accepts provenance, a turnRef, decidedBy or a channel — the
 * course session mints the teacher turn itself (course.mjs), and cuts every decision verb down to the
 * fields it uses before anything is logged. See server.mjs for the route list.
 */
import { CourseSession } from "./course.mjs";
import { askStudent, packageOf } from "./student.mjs";
import { DEFAULT_TYPICAL_SECONDS } from "./worker-config.mjs";

export const MAX_BODY = 1 << 20;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/** A worker state maps to an honest status: not configured is 501, an outage or bad output is 502. */
function planStatus(code) {
  if (code === "WORKER_NOT_CONFIGURED") return 501;
  if (["NO_CONFIRMED_OBJECTIVES", "ALREADY_PROPOSED", "NO_TEACHER_OUTCOMES", "SUGGESTIONS_PENDING", "OBJECTIVES_CONFIRMED", "CHECKPOINT_ORDER"].includes(code)) return 409;
  if (code === "NO_MATERIALS") return 422;
  return 502;
}

/** The teacher's words: their text, or their per-question answers rendered as text. */
function answerText(b) {
  if (typeof b.text === "string" && b.text.trim()) return b.text;
  if (b.answers && typeof b.answers === "object") {
    return Object.entries(b.answers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`).join("\n");
  }
  return b.text;
}

/** Every refusal, as a status and a JSON body. Shared, so both hosts answer a failure identically. */
export function errorResponse(err) {
  const send = (status, json) => ({ status, json });
  if (err instanceof HttpError) return send(err.status, { ok: false, code: err.code, message: err.message, ...(err.blockers ? { blockers: err.blockers } : {}) });
  if (err && err.name === "PublishBlockedError") return send(409, { ok: false, code: "PUBLISH_BLOCKED", message: err.message, blockers: err.blockers });
  if (err && err.name === "StatementError") return send(422, { ok: false, code: err.code, message: err.message });
  if (err && err.name === "FabricatedConfirmationError") return send(403, { ok: false, code: err.code, message: err.message });
  if (err && err.name === "StudentError") return send(err.code === "NO_QUESTION" ? 422 : err.code === "WORKER_NOT_CONFIGURED" ? 501 : 502, { ok: false, code: err.code, message: err.message });
  if (err && err.name === "MaterialError") return send(err.code === "URL_UNREACHABLE" ? 502 : 422, { ok: false, code: err.code, message: err.message });
  if (err && err.name === "AsfaiAuthError") return send(401, { ok: false, code: err.code, message: err.message });
  if (err && err.name === "AsfaiCallError") return send(502, { ok: false, code: err.code, message: err.message });
  if (err && err.code) return send(409, { ok: false, code: err.code, message: err.message });
  // A network failure reaching ASFAI is an outage, not a bug in the host.
  if (err && err.name === "TypeError" && /fetch/i.test(String(err.message))) return send(502, { ok: false, code: "ASFAI_UNREACHABLE", message: "ASFAI could not be reached; the course still works locally" });
  return send(500, { ok: false, code: "INTERNAL", message: String(err && err.message ? err.message : err) });
}

/**
 * The dependencies a host injects. Everything that differs between the Node host and the browser host is here.
 *   store            CourseStore (disk) or RecordStore (memory written through to IndexedDB)
 *   asfai            the ASFAI service, or a stand-in that says it is off
 *   worker           the PlanWorker every model call goes through
 *   workerStatus     what /worker/status reports (default: the worker's own config)
 *   typicalSeconds   expected wait ranges for objectives, plans and answers
 *   sources          knowledge sources (config, never a request field)
 *   archives         a LocalArchive, or null where there is no archive folder
 *   prepareMaterials how the teacher's material items become named plain text
 *   guard            transport checks run right after the /api match (Node: loopback host + origin + JSON)
 *
 * @typedef {object} HandlerDeps
 * @property {any} store
 * @property {any} asfai
 * @property {any} worker
 * @property {(() => any) | null} [workerStatus]
 * @property {any} [typicalSeconds]
 * @property {any[]} [sources]
 * @property {any} [archives]
 * @property {(items: any) => Promise<{materials: any[], skipped: any[]}>} prepareMaterials
 * @property {((raw: any, pathname: string) => void) | null} [guard]
 */

/** @param {HandlerDeps} deps */
export function createHandler({ store, asfai: asfaiSvc, worker: planWorker, workerStatus = null, typicalSeconds = DEFAULT_TYPICAL_SECONDS, sources: knowledgeSources = [], archives = null, prepareMaterials, guard = null }) {
  const reportWorker = workerStatus ?? (() => ({ configured: planWorker.enabled, zdr: planWorker.zdr, provider: planWorker.provider, typicalSeconds }));

  /**
   * Load per request. The event log is the source of record, so a fresh verified
   * replay per request IS the correct read — and it means a tampered log is
   * refused on the very request that would have served it (fail closed) instead
   * of being masked by an in-memory copy.
   */
  function session(courseId) {
    if (!store.has(courseId)) throw new HttpError(404, "UNKNOWN_COURSE", `no such course: ${courseId}`);
    return CourseSession.load(store, courseId);
  }

  function requireArchives() {
    if (!archives) {
      const e = new Error("archiving to a folder needs the local Silicus app; export your courses instead");
      e.code = "LOCAL_APP_ONLY";
      throw e;
    }
    return archives;
  }

  // One in-flight mutation per course. Two requests that both load the same log head
  // and then append (the intake call awaits ASFAI in between) would each write seq N+1
  // and leave a chain verify() rejects — the course becomes unreadable. The lock makes
  // the second request load AFTER the first has landed.
  const courseLocks = new Map();
  function withCourse(courseId, fn) {
    const prev = courseLocks.get(courseId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    courseLocks.set(courseId, run.then(() => {}, () => {}));
    return run;
  }

  /**
   * @param {{method?: string, url: string, readBody: () => Promise<any>, raw?: any}} req
   *   `readBody` is called only by routes that read a body, exactly when they read it (the Node host
   *   parses lazily, and a route that takes no body must not fail on one). `raw` is the transport's own
   *   request object, handed to `guard`.
   */
  async function route({ method: m, url: rawUrl, readBody: body, raw }) {
    const url = new URL(rawUrl, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["api","courses",id,...]
    const method = m ?? "GET";

    if (parts[0] !== "api") throw new HttpError(404, "NOT_FOUND", "not found");
    if (guard) guard(raw, url.pathname);

    if (parts[1] === "health" && method === "GET") return { status: 200, json: { ok: true, courses: store.list().length } };
    // Whether a drafting worker is configured. Config, never a credential.
    if (parts[1] === "worker" && parts[2] === "status" && method === "GET") {
      return { status: 200, json: await reportWorker() };
    }
    // Which knowledge sources are in play. Config and capability only: no URL, no path, no credential.
    if (parts[1] === "knowledge" && parts[2] === "status" && method === "GET") {
      return { status: 200, json: { sources: knowledgeSources.map((k) => ({ id: k.id, label: k.label, enabled: k.enabled, canVerify: k.canVerify })) } };
    }
    if (parts[1] === "asfai") {
      if (parts[2] === "status" && method === "GET") return { status: 200, json: asfaiSvc.status() };
      if (parts[2] === "connect" && method === "POST") return { status: 200, json: await asfaiSvc.oauth.beginAuthorization() };
      if (parts[2] === "callback" && method === "GET") {
        const q = Object.fromEntries(url.searchParams);
        try {
          console.error(`[asfai] callback received: params=${Object.keys(q).sort().join(",")}`);
          await asfaiSvc.oauth.handleCallback({ code: q.code, state: q.state, iss: q.iss, error: q.error });
          return { status: 200, html: "<!doctype html><meta charset=utf-8><title>Connected</title><body style='font:18px Georgia;max-width:32rem;margin:4rem auto'><p>ASFAI is connected. You can close this tab and return to Silicus.</p>" };
        } catch (e) {
          console.error(`[asfai] callback refused: ${e.code ?? "error"} — ${String(e.message).slice(0, 160)}`);
          return { status: 400, html: `<!doctype html><meta charset=utf-8><title>Not connected</title><body style='font:18px Georgia;max-width:32rem;margin:4rem auto'><p>ASFAI was not connected (${String(e.code ?? "error").replace(/[^A-Z_]/g, "")}). Close this tab and start again from Silicus.</p>` };
        }
      }
      throw new HttpError(404, "NOT_FOUND", "no such asfai route");
    }
    if (parts[1] === "archives" && method === "GET") return { status: 200, json: { refs: archives ? archives.list() : [] } };

    if (parts[1] === "courses") {
      // /api/courses
      if (parts.length === 2) {
        if (method === "GET") {
          // The library: enough to choose a course and to see, honestly, which one needs attention.
          // A course whose record does not verify says so here instead of silently disappearing.
          const courses = store.list().map((m) => {
            let progress;
            try {
              const v = CourseSession.load(store, m.courseId).view();
              const cps = Object.values(v.checkpoints);
              progress = { confirmed: cps.filter((c) => c.status === "confirmed").length, total: cps.length, versions: v.versions.length };
            } catch (e) {
              progress = { error: e?.code ?? "UNREADABLE" };
            }
            return { courseId: m.courseId, owner: m.owner, title: m.title, createdAt: m.createdAt, progress };
          }).sort((a, b) => b.createdAt - a.createdAt);
          return { status: 200, json: { courses } };
        }
        if (method === "POST") {
          const b = await body();
          if (!b.owner || !b.title) throw new HttpError(400, "BAD_INPUT", "owner and title are required");
          const s = CourseSession.create(store, {
            owner: String(b.owner), title: String(b.title),
            description: b.description ? String(b.description) : "",
            materials: Array.isArray(b.materials) ? b.materials : [],
          });
          return { status: 201, json: { ok: true, courseId: s.courseId, view: s.view() } };
        }
        throw new HttpError(405, "METHOD_NOT_ALLOWED", `${method} not allowed`);
      }

      const courseId = decodeURIComponent(parts[2]);

      // A student asks about the PUBLISHED course. Read-only and outside the course lock: it writes
      // nothing, and a slow model call must not hold up the teacher. Only {question, history} are read.
      if (parts[3] === "student" && parts[4] === "ask" && parts.length === 5) {
        if (method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", `${method} not allowed`);
        const sealed = session(courseId).latestSealedVersion();
        if (!sealed) throw new HttpError(409, "NOT_PUBLISHED", "this course has not been published yet");
        return { status: 200, json: await askStudent({ pkg: packageOf(sealed), worker: planWorker, body: await body() }) };
      }

      return withCourse(courseId, async () => {
      const s = session(courseId);
      const tail = parts.slice(3).join("/");

      if (!tail && method === "GET") return { status: 200, json: s.view() };
      if (tail === "export" && method === "GET") return { status: 200, json: s.export() };
      if (tail === "verify" && method === "GET") return { status: 200, json: s.verifyLog() };
      // Checkpoint 2's intake gate: consult BEFORE a prepare_outline call, report
      // the observed result AFTER it, and record the teacher's reply in between.
      if (tail === "intake" && method === "GET") return { status: 200, json: s.intakeStatus() };
      // The anchor a client PINS on the teacher's device (see frontend/src/gate/pin.ts).
      if (tail.startsWith("anchor/") && method === "GET") {
        const version = Number(tail.slice("anchor/".length));
        if (!Number.isInteger(version) || version < 1) {
          throw new HttpError(400, "BAD_VERSION", "an anchor needs a positive integer version");
        }
        return { status: 200, json: { anchor: s.publishAnchor(version) } };
      }
      if (tail.startsWith("archive/") && method === "GET") {
        const ref = decodeURIComponent(tail.slice("archive/".length));
        const record = requireArchives().load(ref);
        const ver = archives.verify(ref, record.digest);
        return { status: 200, json: { verified: ver.verified, ref, digest: record.digest, archivedAt: record.archivedAt, export: record.payload } };
      }
      if (method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", `${method} not allowed for ${tail}`);

      // The worker SUGGESTS from the teacher's recorded words. It reads NO request body: not even to ignore it.
      if (tail === "objectives/suggest") {
        const r = await s.suggestObjectives({ worker: planWorker });
        if (!r.ok) throw new HttpError(planStatus(r.code), r.code, r.reason);
        return { status: 200, json: { proposals: r.proposals } };
      }

      const b = await body();
      switch (tail) {
        case "checkpoints":  return { status: 200, json: s.confirmCheckpoint({ id: b.id, text: b.text, note: b.note ?? null }) };
        case "intake/call":     return { status: 200, json: await asfaiSvc.runIntake(s) };
        case "intake/answer":
          return { status: 200, json: s.answerIntake({ text: answerText(b), answers: b.answers ?? null }) };
        case "plan/validate":   return { status: 200, json: { validation: await asfaiSvc.validate(s) } };
        case "archive": {
          // save() carries the absolute path for in-process callers. It must not leave over HTTP.
          const { path: _path, ...saved } = requireArchives().save(b.ref ?? s.courseId, s.export());
          return { status: 200, json: saved };
        }
        case "objectives": {
          // The host DERIVES from its own record of the teacher's answers. The request
          // body is read and ignored: a client cannot supply an objective statement, so
          // no objective content is forgeable — the same narrowness as intake/call.
          const r = s.proposeObjectivesFromAnswers({});
          if (!r.ok) throw new HttpError(409, r.code, r.reason);
          return { status: 200, json: { proposals: r.proposals } };
        }
        case "materials/propose": {
          // Content comes IN here, because material is the teacher's input. Objective TEXT never does:
          // the proposals are written by the worker from the material, labelled with the names the
          // teacher supplied, and every one still waits for the teacher. Only `materials` is read.
          // The text is returned to nobody and kept nowhere; the log gets names, digests and sizes.
          const prepared = await prepareMaterials(b.materials);
          const r = await s.proposeObjectivesFromMaterials({ worker: planWorker, materials: prepared.materials });
          if (!r.ok) throw new HttpError(planStatus(r.code), r.code, r.reason);
          return { status: 200, json: {
            proposals: r.proposals,
            materials: prepared.materials.map(({ name, chars, digest, kind, truncated }) => ({ name, chars, digest, kind, truncated })),
            skipped: prepared.skipped,
          } };
        }
        case "decisions":    return { status: 200, json: { decisions: s.decideObjectives({ decisions: b.decisions, text: b.text }) } };
        case "plan": {
          // The WORKER drafts from the confirmed objectives. The body is read and ignored:
          // a client cannot supply a plan any more than it can supply an objective.
          const r = await s.draftPlanFromObjectives({ worker: planWorker, sources: knowledgeSources });
          if (!r.ok) throw new HttpError(planStatus(r.code), r.code, r.reason);
          return { status: 200, json: r.plan };
        }
        case "plan/confirm": return { status: 200, json: s.confirmLessonPlan({ text: b.text, planId: b.planId ?? null }) };
        case "publish":      return { status: 200, json: { version: s.publish({ text: b.text, note: b.note ?? null }) } };
        default: throw new HttpError(404, "NOT_FOUND", `no route: ${url.pathname}`);
      }
      });
    }
    throw new HttpError(404, "NOT_FOUND", "not found");
  }

  return {
    /**
     * Handle one request. Never throws: every failure is a {status, json} refusal.
     * @returns {Promise<{status: number, json?: any, html?: string}>}
     */
    async handle(req) {
      try {
        return await route(req);
      } catch (err) {
        return errorResponse(err);
      }
    },
  };
}
