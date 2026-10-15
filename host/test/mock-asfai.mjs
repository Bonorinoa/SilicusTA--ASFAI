/** An in-process fake ASFAI: PRM + issuer + DCR + token + MCP (json or SSE). No network. */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));

/**
 * A tiny stand-in for Marble. Shapes follow the partner source (register-asfai-tools.ts): a
 * result is an array of topics, `payload` is STRICT (an unknown key is a schema rejection, as on
 * the live server), and get_objective answers a tool error "No objective '<id>'." for a stranger.
 * The data is deliberately Marble-like: a children's node that LOOKS like a match for a
 * university topic ("Likelihood Language", ages 9-10) is the documented live behavior.
 */
export const GRAPH = [
  { id: "mt_0007", type: "skill", subject: "Computer Science", domain: "Algorithms", name: "Following Steps", description: "Follow and explain a short sequence of instructions to get a result.", ageRangeStart: 8, ageRangeEnd: 10, centrality: 0.4, evidence: ["follows a recipe"], assessmentPrompt: "Explain the steps.", standards: ["CSTA:1A-AP-08"] },
  { id: "mt_0042", type: "skill", subject: "Computer Science", domain: "Data", name: "Finding the Claim", description: "Pick out the sentence in a text that says something that could be checked.", ageRangeStart: 9, ageRangeEnd: 11, centrality: 0.3, evidence: ["marks the claim"], assessmentPrompt: "Which sentence is the claim?", standards: [] },
  { id: "mt_0100", type: "skill", subject: "Math", domain: "Probability", name: "Likelihood Language", description: "Say whether an event is certain, likely, unlikely or impossible.", ageRangeStart: 9, ageRangeEnd: 10, centrality: 0.2, evidence: [], assessmentPrompt: "Is it likely?", standards: [] },
];
const lexical = (q) => {
  const terms = String(q).toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 3) ?? [];
  return GRAPH.filter((t) => terms.some((w) => `${t.name} ${t.domain} ${t.description}`.toLowerCase().includes(w)));
};

export async function startMockAsfai({ sse = false, issuerOverride = null, offOriginTokenEndpoint = false } = {}) {
  const st = { codes: new Map(), access: new Set(), refresh: new Set(), calls: [], registered: 0, expiresIn: 3600, tokenRequests: [] };
  let origin = "";
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url, origin);
    const raw = await new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString())); });
    const send = (code, obj, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
    if (u.pathname === "/education/.well-known/oauth-protected-resource")
      return send(200, { resource: `${origin}/education/api/mcp`, authorization_servers: [`${origin}/education/oauth`], scopes_supported: ["asfai"] });
    if (u.pathname === "/.well-known/oauth-authorization-server/education/oauth" || u.pathname === "/education/oauth/.well-known/oauth-authorization-server")
      return send(200, {
        issuer: issuerOverride ?? `${origin}/education/oauth`,
        authorization_endpoint: `${origin}/education/oauth/authorize`,
        token_endpoint: offOriginTokenEndpoint ? "https://evil.example/token" : `${origin}/education/oauth/token`,
        registration_endpoint: `${origin}/education/oauth/register`,
        code_challenge_methods_supported: ["S256"], scopes_supported: ["asfai"],
      });
    if (u.pathname === "/education/oauth/register") { st.registered += 1; return send(201, { client_id: `cid-${st.registered}` }); }
    if (u.pathname === "/education/oauth/authorize") {
      // the real issuer answers invalid_target when the RFC 8707 resource is missing or wrong
      return send(u.searchParams.get("resource") === `${origin}/education/api/mcp` ? 200 : 400, { error: u.searchParams.get("resource") ? "ok" : "invalid_target" });
    }
    if (u.pathname === "/education/oauth/token") {
      const p = new URLSearchParams(raw); st.tokenRequests.push(Object.fromEntries(p));
      if (p.get("resource") !== `${origin}/education/api/mcp`) return send(400, { error: "invalid_target" });
      if (p.get("grant_type") === "authorization_code") {
        const c = st.codes.get(p.get("code"));
        const ok = c && createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") === c.challenge;
        if (!ok) return send(400, { error: "invalid_grant" });
        st.codes.delete(p.get("code"));
      } else if (!st.refresh.has(p.get("refresh_token"))) return send(400, { error: "invalid_grant" });
      const a = `at-${randomBytes(6).toString("hex")}`, r = `rt-${randomBytes(6).toString("hex")}`;
      st.access.add(a); st.refresh.add(r);
      return send(200, { access_token: a, refresh_token: r, expires_in: st.expiresIn, scope: "asfai", token_type: "Bearer" });
    }
    if (u.pathname === "/education/api/mcp") {
      const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!st.access.has(auth)) return send(401, { error: "invalid_token" }, { "www-authenticate": "Bearer" });
      const m = raw ? JSON.parse(raw) : {};
      st.calls.push(m);
      if (m.id === undefined) { res.writeHead(202); return res.end(); }
      let result;
      if (m.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-asfai", version: "0" } };
      else if (m.method === "tools/list") result = { tools: [{ name: "asfai_lesson" }, { name: "asfai_graph" }] };
      else if (m.method === "tools/call") {
        const a = m.params.arguments;
        if (!a || typeof a.action !== "string" || (a.payload !== undefined && typeof a.payload !== "object")) {
          return send(200, { jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Input validation error" } });
        } st.toolArgs = st.toolArgs ?? []; st.toolArgs.push(a);
        if (m.params.name === "asfai_lesson" && a.action === "prepare_outline") {
          const full = a.payload?.topic && a.payload?.course && a.payload?.learningOutcomes;
          result = { content: [{ type: "text", text: JSON.stringify((full ? FX.ready_to_draft : FX.clarifying).response) }] };
        } else if (m.params.name === "asfai_lesson" && a.action === "validate_outline") {
          const o = a.payload?.outline;
          const bad = [];
          if (typeof o?.id !== "string") bad.push({ path: ["id"], message: "Invalid input: expected string, received undefined" });
          if (!["draft", "reviewed"].includes(o?.status)) bad.push({ path: ["status"], message: "Invalid option: expected one of \"draft\"|\"reviewed\"" });
          for (const k of ["createdAt", "updatedAt"]) if (typeof o?.[k] !== "string") bad.push({ path: [k], message: "Invalid input: expected string, received undefined" });
          if (bad.length) return send(200, { jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify(bad) }] } });
          result = { content: [{ type: "text", text: JSON.stringify({ valid: true, issues: [], echoedSections: a.payload?.outline?.sections?.length ?? null, echoedOutcomes: a.payload?.outline?.learningOutcomes ?? null }) }] };
        } else if (m.params.name === "asfai_graph" && a.action === "search_objectives") {
          const bad = Object.keys(a.payload ?? {}).filter((k) => !["query", "limit"].includes(k));
          if (typeof a.payload?.query !== "string" || !a.payload.query || bad.length)
            return send(200, { jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify([{ path: [], message: bad.length ? `Unrecognized key: ${bad[0]}` : "query required" }]) }] } });
          if (st.graphDown) return send(503, { error: "down" });
          result = { content: [{ type: "text", text: JSON.stringify(lexical(a.payload.query).slice(0, a.payload.limit ?? 20)) }] };
        } else if (m.params.name === "asfai_graph" && a.action === "get_objective") {
          if (st.graphDown) return send(503, { error: "down" });
          const t = GRAPH.find((x) => x.id === a.payload?.id);
          result = t ? { content: [{ type: "text", text: JSON.stringify(t) }] } : { isError: true, content: [{ type: "text", text: `No objective '${a.payload?.id}'.` }] };
        } else result = { isError: true, content: [{ type: "text", text: "unknown" }] };
      } else return send(200, { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no such method" } });
      const body = { jsonrpc: "2.0", id: m.id, result };
      const h = m.method === "initialize" ? { "mcp-session-id": "sess-1" } : {};
      if (sse) { res.writeHead(200, { "content-type": "text/event-stream", ...h }); return res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`); }
      return send(200, body, h);
    }
    send(404, { error: "nope" });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${srv.address().port}`;
  return {
    st, origin, prmUrl: `${origin}/education/.well-known/oauth-protected-resource`, mcpUrl: `${origin}/education/api/mcp`,
    /** Play the consent screen: given the authorize URL, mint a code bound to its challenge. */
    consent(authorizeUrl) {
      const q = new URL(authorizeUrl).searchParams; const code = `code-${randomBytes(5).toString("hex")}`;
      st.codes.set(code, { challenge: q.get("code_challenge") });
      return { code, state: q.get("state") };
    },
    close() { srv.closeAllConnections?.(); srv.close(); },
  };
}
