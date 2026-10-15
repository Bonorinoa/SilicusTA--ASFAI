/**
 * server.mjs — the Silicus host HTTP transport (node:http, zero dependencies).
 *
 * The request shape is the trust boundary: clients send INTENTS only
 * ({ verb, proposalId, statement, text }). There is no field anywhere in this
 * API that accepts provenance, a turnRef, or a channel — the host mints the
 * teacher turn itself inside the inbound-message hook of CourseSession. A client
 * therefore cannot fabricate a teacher confirmation, whatever it posts.
 *
 *   POST /api/courses                        create a course
 *   GET  /api/courses                        list courses
 *   GET  /api/courses/:id                    the full course view
 *   GET  /api/courses/:id/export             tamper-evident export
 *   GET  /api/courses/:id/verify             recompute the event-log hash chain
 *   GET  /api/courses/:id/intake             the ASFAI intake gate status (consult before prepare_outline)
 *   POST /api/courses/:id/intake/call        the HOST calls asfai_lesson.prepare_outline (built from teacher words only) and observes the result
 *   POST /api/courses/:id/intake/answer      the teacher's reply {text?, answers?} (records a real turn; arms the round)
 *   POST /api/courses/:id/plan/validate      the HOST calls asfai_lesson.validate_outline on the drafted plan (a signal, not a confirmation)
 *   GET  /api/knowledge/status               which knowledge sources are in play (config + capability, never a path or credential)
 *   GET  /api/asfai/status                   is ASFAI connected (never a token)
 *   POST /api/asfai/connect                  begin the consent flow -> {authorizeUrl} (the teacher's click completes it)
 *   GET  /api/asfai/callback                 the OAuth redirect (state is single-use)
 *   POST /api/courses/:id/archive            {ref?} save the export to the local archive (atomic + read-back verified)
 *   GET  /api/courses/:id/archive/:ref       load + re-verify an archived export
 *   GET  /api/courses/:id/anchor/:version    the anchor a client pins on the teacher's device
 *   GET  /api/archives                       list archive refs
 *   POST /api/courses/:id/checkpoints        {id:"files"|"outline", text, note?}
 *   POST /api/courses/:id/objectives         no body: the HOST derives them from the teacher's recorded answers
 *   POST /api/courses/:id/materials/propose  {materials:[{name,text}|{url}]} the WORKER proposes objectives from the teacher's material (nothing is stored but names, digests, sizes)
 *   POST /api/courses/:id/student/ask        {question, history?} a student asks about the PUBLISHED package; read-only, grounded or "ask your teacher", records nothing
 *   POST /api/courses/:id/decisions          {decisions:[...], text}                   (teacher decides; also how a PUBLISHED course is revised: add / revoke, then re-plan and publish the next version)
 *   POST /api/courses/:id/plan               no body: the OSS WORKER drafts from the confirmed objectives
 *   POST /api/courses/:id/plan/confirm       {text, planId?}                           (teacher confirms)
 *   POST /api/courses/:id/publish            {text, note?}                             (teacher publishes)
 */
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CourseStore } from "./store.mjs";
import { CourseSession } from "./course.mjs";
import { LocalArchive } from "./archive.mjs";
import { TokenStore } from "./asfai/tokens.mjs";
import { PlanWorker } from "./worker.mjs";
import { prepareMaterials, MaterialError } from "./materials.mjs";
import { askStudent, packageOf, StudentError } from "./student.mjs";
import { AsfaiOAuth } from "./asfai/oauth.mjs";
import { AsfaiClient } from "./asfai/mcp.mjs";
import { AsfaiService } from "./asfai/service.mjs";
import { AsfaiGraphSource } from "./sources/asfai-graph.mjs";
import { LocalOntologySource } from "./sources/local-ontology.mjs";

const ASFAI_MCP_URL = process.env.SILICUS_ASFAI_MCP_URL ?? "https://constitution.asfai.org/education/api/mcp";
const ASFAI_PRM_URL = process.env.SILICUS_ASFAI_PRM_URL ?? "https://constitution.asfai.org/education/.well-known/oauth-protected-resource";

const MAX_BODY = 1 << 20;

/** The teacher's words: their text, or their per-question answers rendered as text. */
/** A worker state maps to an honest status: not configured is 501, an outage or bad output is 502. */
function planStatus(code) {
  if (code === "WORKER_NOT_CONFIGURED") return 501;
  if (code === "NO_CONFIRMED_OBJECTIVES" || code === "ALREADY_PROPOSED") return 409;
  if (code === "NO_MATERIALS") return 422;
  return 502;
}

function answerText(b) {
  if (typeof b.text === "string" && b.text.trim()) return b.text;
  if (b.answers && typeof b.answers === "object") {
    return Object.entries(b.answers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`).join("\n");
  }
  return b.text;
}

/**
 * The host holds an ASFAI credential and answers on loopback, so any web page the teacher has
 * open could otherwise talk to it (localhost CSRF) and a rebinding hostname could reach it.
 * Browsers always send Origin on cross-origin POSTs, so: an Origin that is not on the allow-list
 * is refused, a Host that is not loopback is refused, and a POST must declare application/json
 * (which forces a CORS preflight a hostile page cannot pass). Non-browser clients send no
 * Origin and are unaffected. The OAuth callback is a top-level navigation from ASFAI and is
 * protected by its single-use `state` instead.
 */
const DEFAULT_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"];
function guardRequest(req, allowedOrigins, pathname) {
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (host && !["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new HttpError(403, "BAD_HOST", "this host only answers on loopback");
  if (pathname === "/api/asfai/callback") return;
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, "BAD_ORIGIN", "cross-origin request refused");
  if (req.method === "POST" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "JSON_REQUIRED", "POST bodies must be application/json");
  }
}

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * The drafting worker from environment config. OFF unless a model is configured.
 *   SILICUS_WORKER_PROVIDER  "openrouter" (preset: OpenRouter, deepseek/deepseek-v4-flash-0731, zero-data-retention ON),
 *                            "anthropic" (native Messages API), or unset/"openai" (any chat-completions endpoint)
 *   SILICUS_WORKER_URL       the endpoint (anthropic defaults to https://api.anthropic.com/v1/messages)
 *   SILICUS_WORKER_MODEL     the model (anthropic defaults to claude-sonnet-5-5)
 *   SILICUS_WORKER_API_KEY   the credential (the presets also read OPENROUTER_API_KEY / ANTHROPIC_API_KEY)
 *   SILICUS_WORKER_ZDR       zero-data-retention routing: OpenRouter only (on by default for the preset; 0 turns it off). Asking for it on the Anthropic wire
 *                            refuses to start, because the host must not claim a guarantee it cannot make.
 */
export function workerFromEnv(env) {
  const preset = env.SILICUS_WORKER_PROVIDER;
  const anthropic = preset === "anthropic";
  const openrouter = preset === "openrouter";
  const key = env.SILICUS_WORKER_API_KEY
    || (anthropic ? env.ANTHROPIC_API_KEY : openrouter ? env.OPENROUTER_API_KEY : null)
    || null;
  return new PlanWorker({
    provider: anthropic ? "anthropic" : "openai",
    url: env.SILICUS_WORKER_URL || (anthropic ? "https://api.anthropic.com/v1/messages" : openrouter ? "https://openrouter.ai/api/v1/chat/completions" : null),
    model: env.SILICUS_WORKER_MODEL || (anthropic ? "claude-sonnet-5-5" : openrouter ? "deepseek/deepseek-v4-flash-0731" : null),
    apiKey: key,
    // The OpenRouter preset is zero-data-retention unless explicitly switched off (SILICUS_WORKER_ZDR=0).
    // Every other setup is opt-in, so nothing claims a guarantee it was not asked for.
    zdr: openrouter ? env.SILICUS_WORKER_ZDR !== "0" : env.SILICUS_WORKER_ZDR === "1",
  });
}

/** Build the app over a data directory. Returns the (unlistened) http.Server. */
export function createApp({ allowedOrigins = (process.env.SILICUS_ALLOWED_ORIGINS ? process.env.SILICUS_ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS), dataDir = process.env.SILICUS_HOST_DATA ?? join(homedir(), ".silicus", "host"), asfai = null, worker = null, sources = null, fetchImpl = undefined, lookupImpl = undefined, ytdlp = process.env.SILICUS_YTDLP ?? null, runImpl = undefined, port = Number(process.env.SILICUS_HOST_PORT ?? 8787) } = {}) {
  const store = new CourseStore(dataDir);
  // The host's OWN credential file, never another process's. Injectable for tests.
  const asfaiSvc = asfai ?? (() => {
    const oauth = new AsfaiOAuth({
      prmUrl: ASFAI_PRM_URL, redirectUri: `http://127.0.0.1:${port}/api/asfai/callback`,
      tokenStore: new TokenStore(join(dataDir, "asfai-tokens.json")),
      // Test-only: lets the host talk to a LOOPBACK mock issuer over http. The OAuth module
      // still refuses any non-loopback http endpoint and any endpoint off the issuer origin.
      allowInsecure: process.env.SILICUS_ASFAI_ALLOW_INSECURE === "1",
    });
    return new AsfaiService({ oauth, client: new AsfaiClient({ oauth, url: ASFAI_MCP_URL }) });
  })();
  const archives = new LocalArchive(join(dataDir, "archives"));
  // The OSS worker that drafts a plan. OFF unless url+model are configured: the host
  // runs, and the suite passes, with no model at all. Its output is validated in worker.mjs.
  const planWorker = worker ?? workerFromEnv(process.env);

  // Knowledge sources the worker may draw on: CONFIG, never a request field. ASFAI's graph first
  // (recommended; on unless SILICUS_SOURCE_ASFAI=0), then a local ontology file if one is named.
  // A source that is not configured or not connected is a state, not an error.
  const knowledgeSources = sources ?? [
    ...(process.env.SILICUS_SOURCE_ASFAI === "0" ? [] : [new AsfaiGraphSource({ client: asfaiSvc.client, isConnected: () => asfaiSvc.status().connected === true })]),
    new LocalOntologySource({ file: process.env.SILICUS_ONTOLOGY_FILE ?? null }),
  ];

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

  function body(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, "BODY_TOO_LARGE", "request body too large")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, "BAD_JSON", "request body is not valid JSON")); }
      });
      req.on("error", reject);
    });
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

  async function route(req) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["api","courses",id,...]
    const method = req.method ?? "GET";

    if (parts[0] !== "api") throw new HttpError(404, "NOT_FOUND", "not found");
    guardRequest(req, allowedOrigins, url.pathname);

    if (parts[1] === "health" && method === "GET") return { status: 200, json: { ok: true, courses: store.list().length } };
    // Whether a drafting worker is configured. Config, never a credential.
    if (parts[1] === "worker" && parts[2] === "status" && method === "GET") {
      return { status: 200, json: { configured: planWorker.enabled, zdr: planWorker.zdr, provider: planWorker.provider } };
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
    if (parts[1] === "archives" && method === "GET") return { status: 200, json: { refs: archives.list() } };

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
          const b = await body(req);
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
        return { status: 200, json: await askStudent({ pkg: packageOf(sealed), worker: planWorker, body: await body(req) }) };
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
        const record = archives.load(ref);
        const ver = archives.verify(ref, record.digest);
        return { status: 200, json: { verified: ver.verified, ref, digest: record.digest, archivedAt: record.archivedAt, export: record.payload } };
      }
      if (method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", `${method} not allowed for ${tail}`);

      const b = await body(req);
      switch (tail) {
        case "checkpoints":  return { status: 200, json: s.confirmCheckpoint({ id: b.id, text: b.text, note: b.note ?? null }) };
        case "intake/call":     return { status: 200, json: await asfaiSvc.runIntake(s) };
        case "intake/answer":
          return { status: 200, json: s.answerIntake({ text: answerText(b), answers: b.answers ?? null }) };
        case "plan/validate":   return { status: 200, json: { validation: await asfaiSvc.validate(s) } };
        case "archive": {
          // save() carries the absolute path for in-process callers. It must not leave over HTTP.
          const { path: _path, ...saved } = archives.save(b.ref ?? s.courseId, s.export());
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
          const prepared = await prepareMaterials(b.materials, { ...(fetchImpl ? { fetchImpl } : {}), ...(lookupImpl ? { lookupImpl } : {}), ...(ytdlp ? { ytdlp } : {}), ...(runImpl ? { runImpl } : {}) });
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

  return createServer(async (req, res) => {
    const send = (status, obj) => {
      const payload = JSON.stringify(obj);
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        ...(allowedOrigins.includes(String(res.req?.headers?.origin)) ? { "access-control-allow-origin": String(res.req.headers.origin), vary: "Origin" } : {}),
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      res.end(payload);
    };
    try {
      if (req.method === "OPTIONS") return send(204, {});
      const out = await route(req);
      if (out.html) { res.writeHead(out.status, { "content-type": "text/html; charset=utf-8" }); return res.end(out.html); }
      send(out.status, out.json);
    } catch (err) {
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
      send(500, { ok: false, code: "INTERNAL", message: String(err && err.message ? err.message : err) });
    }
  });
}

const PORT = Number(process.env.SILICUS_HOST_PORT ?? 8787);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.env.SILICUS_HOST_DATA ?? join(homedir(), ".silicus", "host");
  createApp({ dataDir, port: PORT }).listen(PORT, "127.0.0.1", () => {
    console.log(`silicus-host listening on http://127.0.0.1:${PORT}  (data: ${dataDir})`);
  });
}
