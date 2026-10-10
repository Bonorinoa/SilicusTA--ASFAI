/** An in-process fake ASFAI: PRM + issuer + DCR + token + MCP (json or SSE). No network. */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const FX = JSON.parse(readFileSync(new URL("../fixtures/lesson-intake.json", import.meta.url), "utf8"));

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
    if (u.pathname === "/education/oauth/token") {
      const p = new URLSearchParams(raw); st.tokenRequests.push(Object.fromEntries(p));
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
        const a = m.params.arguments; st.toolArgs = st.toolArgs ?? []; st.toolArgs.push(a);
        if (m.params.name === "asfai_lesson" && a.action === "prepare_outline") {
          const full = a.payload?.topic && a.payload?.course && a.payload?.learningOutcomes;
          result = { content: [{ type: "text", text: JSON.stringify((full ? FX.ready_to_draft : FX.clarifying).response) }] };
        } else if (m.params.name === "asfai_lesson" && a.action === "validate_outline") {
          result = { content: [{ type: "text", text: JSON.stringify({ valid: true, issues: [], echoedSections: a.outline?.sections?.length ?? null, echoedOutcomes: a.outline?.learningOutcomes ?? null }) }] };
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
