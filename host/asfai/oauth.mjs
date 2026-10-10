/**
 * oauth.mjs — the host as its OWN OAuth 2.1 public client (PKCE S256, dynamic
 * registration) against the ASFAI issuer. The teacher's consent click is the only
 * thing that can mint a token; the host never reads another process's credentials.
 *
 * Defenses, each with a test: `state` is single-use and TTL-bound (callback CSRF);
 * an `iss` parameter must match the issuer (mix-up); every discovered endpoint must
 * be https on the issuer's origin unless the host is explicitly configured for a
 * loopback test issuer (SSRF / redirect to elsewhere); refresh is single-flight.
 */
import { createHash, randomBytes } from "node:crypto";

export class AsfaiAuthError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = "AsfaiAuthError"; }
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const PENDING_TTL_MS = 10 * 60 * 1000;

export class AsfaiOAuth {
  #fetch; #prmUrl; #resource; #redirectUri; #store; #now; #allowInsecure;
  #meta = null; #pending = new Map(); #refreshing = null;

  constructor({ prmUrl, resource = null, redirectUri, tokenStore, fetchImpl = fetch, now = Date.now, allowInsecure = false }) {
    this.#prmUrl = prmUrl; this.#resource = resource; this.#redirectUri = redirectUri; this.#store = tokenStore;
    this.#fetch = fetchImpl; this.#now = now; this.#allowInsecure = allowInsecure;
  }

  #checkEndpoint(url, issuer) {
    const u = new URL(url);
    const i = new URL(issuer);
    const loopback = this.#allowInsecure && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
    if (u.protocol !== "https:" && !loopback) throw new AsfaiAuthError("ENDPOINT_NOT_HTTPS", `refusing non-https endpoint ${u.origin}`);
    if (u.origin !== i.origin) throw new AsfaiAuthError("ENDPOINT_OFF_ISSUER", `endpoint ${u.origin} is not on the issuer origin ${i.origin}`);
    return url;
  }

  async #json(url, init) {
    const res = await this.#fetch(url, init);
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* handled by caller */ }
    return { status: res.status, ok: res.ok, json };
  }

  async discover() {
    if (this.#meta) return this.#meta;
    const prm = await this.#json(this.#prmUrl);
    const issuer = prm.json?.authorization_servers?.[0];
    if (!prm.ok || !issuer) throw new AsfaiAuthError("DISCOVERY_FAILED", "protected-resource metadata unavailable");
    let meta = null;
    for (const wk of [`${issuer}/.well-known/oauth-authorization-server`,
      `${new URL(issuer).origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname}`]) {
      const r = await this.#json(wk);
      if (r.ok && r.json?.issuer) { meta = r.json; break; }
    }
    if (!meta) throw new AsfaiAuthError("DISCOVERY_FAILED", "authorization-server metadata unavailable");
    if (meta.issuer !== issuer) throw new AsfaiAuthError("ISSUER_MISMATCH", "metadata issuer does not match the protected resource's issuer");
    if (!meta.code_challenge_methods_supported?.includes("S256")) throw new AsfaiAuthError("NO_PKCE", "issuer does not support PKCE S256");
    for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) this.#checkEndpoint(meta[k], issuer);
    this.#meta = { resource: this.#resource ?? prm.json.resource, issuer, scope: prm.json.scopes_supported?.join(" ") ?? "asfai", ...meta };
    return this.#meta;
  }

  async #client() {
    const cached = this.#store.client(this.#redirectUri);
    if (cached) return cached;
    const m = await this.discover();
    const r = await this.#json(m.registration_endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Silicus TA host", redirect_uris: [this.#redirectUri],
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        token_endpoint_auth_method: "none", scope: m.scope,
      }),
    });
    if (!r.ok || !r.json?.client_id) throw new AsfaiAuthError("REGISTRATION_FAILED", "dynamic client registration was refused");
    this.#store.saveClient(this.#redirectUri, { client_id: r.json.client_id });
    return this.#store.client(this.#redirectUri);
  }

  /** Step 1: build the consent URL. The teacher opens it; nothing happens without their click. */
  async beginAuthorization() {
    const m = await this.discover();
    const client = await this.#client();
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(24));
    this.#pending.set(state, { verifier, at: this.#now() });
    const u = new URL(m.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: "code", client_id: client.client_id, redirect_uri: this.#redirectUri,
      scope: m.scope, resource: m.resource, state, code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
    }).toString();
    return { authorizeUrl: u.toString() };
  }

  /** Step 2: the redirect back. `state` is single-use; a replay, forgery or stale one is refused. */
  async handleCallback({ code, state, iss, error } = {}) {
    const p = state ? this.#pending.get(state) : null;
    if (state) this.#pending.delete(state); // single use, success or not
    if (!p) throw new AsfaiAuthError("BAD_STATE", "unknown or already-used authorization state");
    if (this.#now() - p.at > PENDING_TTL_MS) throw new AsfaiAuthError("STATE_EXPIRED", "the consent link expired; start again");
    if (error) throw new AsfaiAuthError("CONSENT_DENIED", `authorization refused: ${String(error).slice(0, 80)}`);
    const m = await this.discover();
    if (iss !== undefined && iss !== m.issuer) throw new AsfaiAuthError("ISS_MISMATCH", "callback iss does not match the issuer");
    if (!code) throw new AsfaiAuthError("NO_CODE", "callback carried no code");
    const client = await this.#client();
    await this.#tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.#redirectUri, client_id: client.client_id, code_verifier: p.verifier, resource: m.resource });
    return this.status();
  }

  async #tokenRequest(params) {
    const m = await this.discover();
    const r = await this.#json(m.token_endpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString(),
    });
    if (!r.ok || !r.json?.access_token) {
      if (params.grant_type === "refresh_token") this.#store.clearTokens(); // a dead refresh token is not "connected"
      // status + the RFC 6749 error code are diagnostics, not secrets
      const why = r.json?.error ? `${r.status} ${String(r.json.error).slice(0, 40)}` : String(r.status);
      throw new AsfaiAuthError("TOKEN_REFUSED", `the token endpoint refused the request (${why})`);
    }
    const prev = this.#store.tokens();
    this.#store.saveTokens({
      accessToken: r.json.access_token,
      refreshToken: r.json.refresh_token ?? prev?.refreshToken ?? null,
      expiresAt: this.#now() + (Number(r.json.expires_in) || 3600) * 1000,
      scope: r.json.scope ?? m.scope,
    });
  }

  /** A valid bearer, refreshing (single-flight) inside the last minute. Throws AUTH_REQUIRED if there is none. */
  async accessToken() {
    const t = this.#store.tokens();
    if (!t) throw new AsfaiAuthError("AUTH_REQUIRED", "ASFAI is not connected");
    if (t.expiresAt - this.#now() > 60_000) return t.accessToken;
    if (!t.refreshToken) { this.#store.clearTokens(); throw new AsfaiAuthError("AUTH_REQUIRED", "the ASFAI session expired; reconnect"); }
    if (!this.#refreshing) {
      this.#refreshing = (async () => {
        const client = await this.#client();
        await this.#tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken, client_id: client.client_id, resource: (await this.discover()).resource });
      })().finally(() => { this.#refreshing = null; });
    }
    try { await this.#refreshing; } catch { throw new AsfaiAuthError("AUTH_REQUIRED", "the ASFAI session expired; reconnect"); }
    return this.#store.tokens().accessToken;
  }

  /** Server rejected our bearer: drop it so status() tells the truth. */
  invalidate() { this.#store.clearTokens(); }
  status() { return this.#store.publicView(); }
}
