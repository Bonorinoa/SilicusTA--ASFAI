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
 *   POST /api/courses/:id/checkpoints        {id:"files"|"outline", text, note?}
 *   POST /api/courses/:id/objectives         {items:[...], sources?, assistantText?}   (AI proposes)
 *   POST /api/courses/:id/decisions          {decisions:[...], text}                   (teacher decides)
 *   POST /api/courses/:id/plan               {spec, assistantText?}                    (AI drafts)
 *   POST /api/courses/:id/plan/confirm       {text, planId?}                           (teacher confirms)
 *   POST /api/courses/:id/publish            {text, note?}                             (teacher publishes)
 */
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CourseStore } from "./store.mjs";
import { CourseSession } from "./course.mjs";

const MAX_BODY = 1 << 20;

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Build the app over a data directory. Returns the (unlistened) http.Server. */
export function createApp({ dataDir = process.env.SILICUS_HOST_DATA ?? join(homedir(), ".silicus", "host") } = {}) {
  const store = new CourseStore(dataDir);

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

  async function route(req) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["api","courses",id,...]
    const method = req.method ?? "GET";

    if (parts[0] !== "api") throw new HttpError(404, "NOT_FOUND", "not found");

    if (parts[1] === "health" && method === "GET") return { status: 200, json: { ok: true, courses: store.list().length } };

    if (parts[1] === "courses") {
      // /api/courses
      if (parts.length === 2) {
        if (method === "GET") {
          return { status: 200, json: { courses: store.list().map((m) => ({
            courseId: m.courseId, owner: m.owner, title: m.title, createdAt: m.createdAt })) } };
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
      const s = session(courseId);
      const tail = parts.slice(3).join("/");

      if (!tail && method === "GET") return { status: 200, json: s.view() };
      if (tail === "export" && method === "GET") return { status: 200, json: s.export() };
      if (tail === "verify" && method === "GET") return { status: 200, json: s.verifyLog() };
      if (method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", `${method} not allowed for ${tail}`);

      const b = await body(req);
      switch (tail) {
        case "checkpoints":  return { status: 200, json: s.confirmCheckpoint({ id: b.id, text: b.text, note: b.note ?? null }) };
        case "objectives":   return { status: 200, json: { proposals: s.proposeObjectives({ items: b.items, sources: b.sources ?? [], assistantText: b.assistantText ?? null }) } };
        case "decisions":    return { status: 200, json: { decisions: s.decideObjectives({ decisions: b.decisions, text: b.text }) } };
        case "plan":         return { status: 200, json: s.proposeLessonPlan({ spec: b.spec, assistantText: b.assistantText ?? null }) };
        case "plan/confirm": return { status: 200, json: s.confirmLessonPlan({ text: b.text, planId: b.planId ?? null }) };
        case "publish":      return { status: 200, json: { version: s.publish({ text: b.text, note: b.note ?? null }) } };
        default: throw new HttpError(404, "NOT_FOUND", `no route: ${url.pathname}`);
      }
    }
    throw new HttpError(404, "NOT_FOUND", "not found");
  }

  return createServer(async (req, res) => {
    const send = (status, obj) => {
      const payload = JSON.stringify(obj);
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*", // dev convenience; the app uses the same-origin vite proxy
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      res.end(payload);
    };
    try {
      if (req.method === "OPTIONS") return send(204, {});
      const out = await route(req);
      send(out.status, out.json);
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { ok: false, code: err.code, message: err.message, ...(err.blockers ? { blockers: err.blockers } : {}) });
      if (err && err.name === "PublishBlockedError") return send(409, { ok: false, code: "PUBLISH_BLOCKED", message: err.message, blockers: err.blockers });
      if (err && err.name === "FabricatedConfirmationError") return send(403, { ok: false, code: err.code, message: err.message });
      if (err && err.code) return send(409, { ok: false, code: err.code, message: err.message });
      send(500, { ok: false, code: "INTERNAL", message: String(err && err.message ? err.message : err) });
    }
  });
}

const PORT = Number(process.env.SILICUS_HOST_PORT ?? 8787);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.env.SILICUS_HOST_DATA ?? join(homedir(), ".silicus", "host");
  createApp({ dataDir }).listen(PORT, () => {
    console.log(`silicus-host listening on http://127.0.0.1:${PORT}  (data: ${dataDir})`);
  });
}
