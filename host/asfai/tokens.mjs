/**
 * tokens.mjs — the host's OWN credential file (never Hermes' token store).
 * Atomic write, mode 0600. Nothing here is ever logged or returned over HTTP:
 * `publicView()` is the only shape that leaves the process.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class TokenStore {
  #path;
  #data;

  constructor(path) {
    this.#path = path;
    this.#data = { clients: {}, tokens: null };
    if (path && existsSync(path)) {
      try { this.#data = { clients: {}, tokens: null, ...JSON.parse(readFileSync(path, "utf8")) }; } catch { /* corrupt file = not connected */ }
    }
  }

  #flush() {
    if (!this.#path) return; // in-memory (tests)
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#data), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.#path);
  }

  client(redirectUri) { return this.#data.clients[redirectUri] ?? null; }
  saveClient(redirectUri, client) { this.#data.clients[redirectUri] = client; this.#flush(); }
  tokens() { return this.#data.tokens; }
  saveTokens(tokens) { this.#data.tokens = tokens; this.#flush(); }
  clearTokens() { this.#data.tokens = null; this.#flush(); }

  /** What may leave the process: never a token value. */
  publicView() {
    const t = this.#data.tokens;
    return { connected: !!t, expiresAt: t?.expiresAt ?? null, scope: t?.scope ?? null, canRefresh: !!t?.refreshToken };
  }
}
