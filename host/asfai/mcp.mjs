/**
 * mcp.mjs — a minimal MCP client over streamable HTTP (JSON-RPC 2.0), zero deps.
 * Behind the small `callTool(name, args)` interface so the official SDK could replace
 * this file alone. Handles both `application/json` and `text/event-stream` replies.
 *
 * It returns what the server said and nothing else: the host never fabricates a
 * tool result. A failure is an AsfaiCallError, not a made-up "ok".
 */
import { AsfaiAuthError } from "./oauth.mjs";

export class AsfaiCallError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.name = "AsfaiCallError"; Object.assign(this, extra); }
}

/** ASFAI reports schema rejections as a JSON array of {path, message} issues inside an isError result. */
function schemaIssues(text) {
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr) || !arr.every((i) => i && typeof i === "object" && "message" in i)) return null;
    return arr.slice(0, 20).map((i) => `${Array.isArray(i.path) && i.path.length ? i.path.join(".") + ": " : ""}${String(i.message).slice(0, 160)}`);
  } catch { return null; }
}

function parseBody(contentType, text, id) {
  if (!text.trim()) return null;
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  let found = null;
  for (const block of text.split(/\n\n+/)) {
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
    if (!data) continue;
    try { const m = JSON.parse(data); if (m.id === id || (m.result !== undefined && found === null)) found = m; } catch { /* skip */ }
  }
  return found;
}

export class AsfaiClient {
  #oauth; #url; #fetch; #session = null; #seq = 0; #ready = false;

  constructor({ oauth, url, fetchImpl = fetch }) { this.#oauth = oauth; this.#url = url; this.#fetch = fetchImpl; }

  async #rpc(method, params, { notification = false, retry = true } = {}) {
    const token = await this.#oauth.accessToken();
    const id = notification ? undefined : ++this.#seq;
    const res = await this.#fetch(this.#url, {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`, ...(this.#session ? { "mcp-session-id": this.#session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
    });
    if (res.status === 401) {
      this.#ready = false; this.#session = null;
      this.#oauth.invalidate(); // a rejected credential is not "connected", whichever call found out
      throw new AsfaiAuthError("AUTH_REQUIRED", "ASFAI rejected the credential; reconnect");
    }
    if (res.status === 404 && this.#session && retry) { this.#session = null; this.#ready = false; await this.#init(); return this.#rpc(method, params, { notification, retry: false }); }
    const sid = res.headers.get("mcp-session-id"); if (sid) this.#session = sid;
    const text = await res.text();
    if (notification) return null;
    if (!res.ok) throw new AsfaiCallError("HTTP_" + res.status, `ASFAI returned HTTP ${res.status}`);
    let msg; try { msg = parseBody(res.headers.get("content-type") ?? "", text, id); } catch { throw new AsfaiCallError("BAD_RESPONSE", "ASFAI sent an unreadable response"); }
    if (!msg) throw new AsfaiCallError("BAD_RESPONSE", "ASFAI sent an empty response");
    if (msg.error) throw new AsfaiCallError("RPC_" + msg.error.code, String(msg.error.message ?? "rpc error").slice(0, 200));
    return msg.result;
  }

  async #init() {
    if (this.#ready) return;
    await this.#rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "silicus-host", version: "0.1.0" } }, { retry: false });
    await this.#rpc("notifications/initialized", {}, { notification: true, retry: false });
    this.#ready = true;
  }

  async listTools() { await this.#init(); return (await this.#rpc("tools/list", {})).tools ?? []; }

  /** Call a gateway tool; return its decoded JSON payload (structuredContent, else the text part parsed). */
  async callTool(name, args) {
    await this.#init();
    const r = await this.#rpc("tools/call", { name, arguments: args });
    if (r.isError) {
      const text = String(r.content?.[0]?.text ?? "tool error");
      const issues = schemaIssues(text);
      throw new AsfaiCallError(issues ? "SCHEMA_REJECTED" : "TOOL_ERROR", issues ? issues.join("; ").slice(0, 300) : text.slice(0, 200), { issues });
    }
    if (r.structuredContent) return r.structuredContent;
    const text = r.content?.find((c) => c.type === "text")?.text;
    try { return JSON.parse(text); } catch { throw new AsfaiCallError("BAD_RESULT", "tool result was not JSON"); }
  }
}
