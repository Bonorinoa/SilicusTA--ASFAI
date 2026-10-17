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
 *   POST /api/courses/:id/objectives/suggest   (no body is read) the worker suggests up to 3 objectives that complement the teacher's own; each waits for the teacher
 *   POST /api/courses/:id/student/ask        {question, history?} a student asks about the PUBLISHED package; read-only; answers from the package (basis plan|explanation) or refuses (off_topic|assessment); records nothing
 *   POST /api/courses/:id/decisions          {decisions:[...], text}                   (teacher decides; also how a PUBLISHED course is revised: add / revoke / reword, then publish the next version)
 *   POST /api/courses/:id/plan               no body: the OSS WORKER drafts from the confirmed objectives
 *   POST /api/courses/:id/plan/confirm       {text, planId?}                           (teacher confirms)
 *   POST /api/courses/:id/publish            {text, note?}                             (teacher publishes)
 */
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CourseStore } from "./store.mjs";
import { LocalArchive } from "./archive.mjs";
import { createHandler, HttpError, MAX_BODY } from "./handler.mjs";
import { TokenStore } from "./asfai/tokens.mjs";
import { PlanWorker } from "./worker.mjs";
import { normalizeReasoning, typicalSecondsFromJson } from "./worker-config.mjs";
import { prepareMaterials } from "./materials.mjs";
import { AsfaiOAuth } from "./asfai/oauth.mjs";
import { AsfaiClient } from "./asfai/mcp.mjs";
import { AsfaiService } from "./asfai/service.mjs";
import { AsfaiGraphSource } from "./sources/asfai-graph.mjs";
import { LocalOntologySource } from "./sources/local-ontology.mjs";

const ASFAI_MCP_URL = process.env.SILICUS_ASFAI_MCP_URL ?? "https://constitution.asfai.org/education/api/mcp";
const ASFAI_PRM_URL = process.env.SILICUS_ASFAI_PRM_URL ?? "https://constitution.asfai.org/education/.well-known/oauth-protected-resource";

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

/**
 * The drafting worker from environment config. OFF unless a model is configured.
 *   SILICUS_WORKER_PROVIDER  "openrouter" (preset: OpenRouter, deepseek/deepseek-v4-flash-0731, zero-data-retention ON),
 *                            "anthropic" (native Messages API), or unset/"openai" (any chat-completions endpoint)
 *   SILICUS_WORKER_URL       the endpoint (anthropic defaults to https://api.anthropic.com/v1/messages)
 *   SILICUS_WORKER_MODEL     the model (anthropic defaults to claude-sonnet-5-5)
 *   SILICUS_WORKER_API_KEY   the credential (the presets also read OPENROUTER_API_KEY / ANTHROPIC_API_KEY)
 *   SILICUS_WORKER_ZDR       zero-data-retention routing: OpenRouter only (on by default for the preset; 0 turns it off). Asking for it on the Anthropic wire
 *                            refuses to start, because the host must not claim a guarantee it cannot make.
 *   SILICUS_WORKER_REASONING low (the OpenRouter preset default), medium, high, off, or model-default.
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
    reasoning: normalizeReasoning(env.SILICUS_WORKER_REASONING, openrouter ? "low" : "model-default"),
    // The operator hint lives here, in the Node host, not in the worker module the browser bundle shares.
    configHint: "set SILICUS_WORKER_URL and SILICUS_WORKER_MODEL, or SILICUS_WORKER_PROVIDER=openrouter",
  });
}

/** Build the app over a data directory. Returns the (unlistened) http.Server. */
export function createApp({ allowedOrigins = (process.env.SILICUS_ALLOWED_ORIGINS ? process.env.SILICUS_ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS), dataDir = process.env.SILICUS_HOST_DATA ?? join(homedir(), ".silicus", "host"), asfai = null, worker = null, workerEnv = process.env, sources = null, fetchImpl = undefined, lookupImpl = undefined, ytdlp = process.env.SILICUS_YTDLP ?? null, runImpl = undefined, port = Number(process.env.SILICUS_HOST_PORT ?? 8787) } = {}) {
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
  const planWorker = worker ?? workerFromEnv(workerEnv);

  // Knowledge sources the worker may draw on: CONFIG, never a request field. ASFAI's graph first
  // (recommended; on unless SILICUS_SOURCE_ASFAI=0), then a local ontology file if one is named.
  // A source that is not configured or not connected is a state, not an error.
  const knowledgeSources = sources ?? [
    ...(process.env.SILICUS_SOURCE_ASFAI === "0" ? [] : [new AsfaiGraphSource({ client: asfaiSvc.client, isConnected: () => asfaiSvc.status().connected === true })]),
    new LocalOntologySource({ file: process.env.SILICUS_ONTOLOGY_FILE ?? null }),
  ];

  // The API itself — routes, intents-only shapes, the per-course lock, verified replay per request and
  // the error mapping — is handler.mjs, shared with the browser host. This file is only the node:http
  // transport around it: the loopback/origin guard, the body reader, and CORS on the way out.
  const handler = createHandler({
    store,
    asfai: asfaiSvc,
    worker: planWorker,
    typicalSeconds: typicalSecondsFromJson(workerEnv.SILICUS_TYPICAL_SECONDS),
    sources: knowledgeSources,
    archives,
    prepareMaterials: (items) => prepareMaterials(items, { ...(fetchImpl ? { fetchImpl } : {}), ...(lookupImpl ? { lookupImpl } : {}), ...(ytdlp ? { ytdlp } : {}), ...(runImpl ? { runImpl } : {}) }),
    guard: (req, pathname) => guardRequest(req, allowedOrigins, pathname),
  });

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
    if (req.method === "OPTIONS") return send(204, {});
    const out = await handler.handle({ method: req.method, url: req.url, readBody: () => body(req), raw: req });
    if (out.html) { res.writeHead(out.status, { "content-type": "text/html; charset=utf-8" }); return res.end(out.html); }
    send(out.status, out.json);
  });
}

const PORT = Number(process.env.SILICUS_HOST_PORT ?? 8787);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.env.SILICUS_HOST_DATA ?? join(homedir(), ".silicus", "host");
  createApp({ dataDir, port: PORT }).listen(PORT, "127.0.0.1", () => {
    console.log(`silicus-host listening on http://127.0.0.1:${PORT}  (data: ${dataDir})`);
  });
}
