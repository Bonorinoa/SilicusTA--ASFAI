import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockAsfai } from "./mock-asfai.mjs";
import { TokenStore } from "../asfai/tokens.mjs";
import { AsfaiOAuth } from "../asfai/oauth.mjs";
import { AsfaiClient } from "../asfai/mcp.mjs";

const mocks = [];
after(() => mocks.forEach((m) => m.close()));
const REDIRECT = "http://127.0.0.1:8787/api/asfai/callback";

async function setup(opts = {}, oauthOpts = {}) {
  const mock = await startMockAsfai(opts); mocks.push(mock);
  const dir = mkdtempSync(join(tmpdir(), "silicus-asfai-"));
  const store = new TokenStore(join(dir, "asfai-tokens.json"));
  let now = 1_000_000;
  const oauth = new AsfaiOAuth({ prmUrl: mock.prmUrl, redirectUri: REDIRECT, tokenStore: store, allowInsecure: true, now: () => now, ...oauthOpts });
  return { mock, oauth, store, dir, clock: { advance: (ms) => { now += ms; } }, client: new AsfaiClient({ oauth, url: mock.mcpUrl }) };
}
async function connect({ mock, oauth }) {
  const { authorizeUrl } = await oauth.beginAuthorization();
  const { code, state } = mock.consent(authorizeUrl);
  return oauth.handleCallback({ code, state, iss: `${mock.origin}/education/oauth` });
}

test("consent flow: PKCE + state, tokens land in a 0600 file, status never shows a token", async () => {
  const s = await setup();
  const { authorizeUrl } = await s.oauth.beginAuthorization();
  const q = new URL(authorizeUrl).searchParams;
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("redirect_uri"), REDIRECT);
  assert.equal(q.get("response_type"), "code");
  // RFC 8707: the live issuer rejects the request (invalid_target) without the resource indicator
  assert.equal(q.get("resource"), `${s.mock.origin}/education/api/mcp`);
  const probe = await fetch(authorizeUrl);
  assert.equal(probe.status, 200, "the issuer accepts an authorize request that names its resource");
  const bare = new URL(authorizeUrl); bare.searchParams.delete("resource");
  assert.equal((await fetch(bare)).status, 400, "…and refuses one that does not (what the live server did)");
  const st = await connect(s);
  assert.equal(st.connected, true);
  assert.equal(JSON.stringify(st).includes("at-"), false, "no token value in the public view");
  assert.equal(statSync(join(s.dir, "asfai-tokens.json")).mode & 0o777, 0o600);
  assert.equal(s.mock.st.registered, 1);
  assert.equal(s.mock.st.tokenRequests.at(-1).resource, `${s.mock.origin}/education/api/mcp`, "the token request names the resource too");
  await connect(s); // second consent reuses the registered client
  assert.equal(s.mock.st.registered, 1);
});

test("callback CSRF: a forged, replayed or foreign state is refused", async () => {
  const s = await setup();
  await assert.rejects(s.oauth.handleCallback({ code: "x", state: "forged" }), { code: "BAD_STATE" });
  const { authorizeUrl } = await s.oauth.beginAuthorization();
  const { code, state } = s.mock.consent(authorizeUrl);
  await s.oauth.handleCallback({ code, state });
  const again = s.mock.consent(authorizeUrl); // fresh code, same (spent) state
  await assert.rejects(s.oauth.handleCallback({ code: again.code, state }), { code: "BAD_STATE" });
  await assert.rejects(s.oauth.handleCallback({ code: "x" }), { code: "BAD_STATE" });
});

test("a stale consent link expires; a wrong iss is refused (mix-up)", async () => {
  const s = await setup();
  let { authorizeUrl } = await s.oauth.beginAuthorization();
  let c = s.mock.consent(authorizeUrl);
  s.clock.advance(11 * 60 * 1000);
  await assert.rejects(s.oauth.handleCallback(c), { code: "STATE_EXPIRED" });
  ({ authorizeUrl } = await s.oauth.beginAuthorization());
  c = s.mock.consent(authorizeUrl);
  await assert.rejects(s.oauth.handleCallback({ ...c, iss: "https://evil.example" }), { code: "ISS_MISMATCH" });
  assert.equal(s.oauth.status().connected, false);
});

test("a code stolen without its verifier is useless (PKCE)", async () => {
  const s = await setup();
  const a = await s.oauth.beginAuthorization();
  const b = await s.oauth.beginAuthorization();
  const ca = s.mock.consent(a.authorizeUrl);        // code bound to A's challenge
  const cb = s.mock.consent(b.authorizeUrl);
  await assert.rejects(s.oauth.handleCallback({ code: ca.code, state: cb.state }), { code: "TOKEN_REFUSED" });
  assert.equal(s.oauth.status().connected, false);
});

test("SSRF: a discovered endpoint off the issuer origin, or a mismatched issuer, is refused", async () => {
  const off = await setup({ offOriginTokenEndpoint: true });
  await assert.rejects(off.oauth.beginAuthorization(), (e) => ["ENDPOINT_NOT_HTTPS", "ENDPOINT_OFF_ISSUER"].includes(e.code));
  const mis = await setup({ issuerOverride: "https://evil.example/education/oauth" });
  await assert.rejects(mis.oauth.beginAuthorization(), { code: "ISSUER_MISMATCH" });
  // and plain http is refused outright when the host is NOT in insecure-test mode
  const strict = await setup({}, { allowInsecure: false });
  await assert.rejects(strict.oauth.beginAuthorization(), { code: "ENDPOINT_NOT_HTTPS" });
});

test("refresh: expiry inside a minute refreshes once (single-flight); a dead refresh token means reconnect", async () => {
  const s = await setup(); s.mock.st.expiresIn = 120;
  await connect(s);
  const first = await s.oauth.accessToken();
  s.clock.advance(100_000);                       // 20s left: inside the refresh window
  const [a, b] = await Promise.all([s.oauth.accessToken(), s.oauth.accessToken()]);
  assert.equal(a, b); assert.notEqual(a, first);
  assert.equal(s.mock.st.tokenRequests.filter((r) => r.grant_type === "refresh_token").length, 1, "single-flight");
  s.mock.st.refresh.clear(); s.clock.advance(200_000);
  await assert.rejects(s.oauth.accessToken(), { code: "AUTH_REQUIRED" });
  assert.equal(s.oauth.status().connected, false);
});

for (const sse of [false, true]) {
  test(`MCP client: initialize + tools/list + callTool over ${sse ? "SSE" : "JSON"}`, async () => {
    const s = await setup({ sse }); await connect(s);
    assert.deepEqual((await s.client.listTools()).map((t) => t.name), ["asfai_lesson", "asfai_graph"]);
    const r = await s.client.callTool("asfai_lesson", { action: "prepare_outline", payload: { mode: "new", audience: "teacher" } });
    assert.equal(r.state, "clarifying");
    assert.equal(s.mock.st.calls.filter((c) => c.method === "initialize").length, 1, "one handshake, reused");
  });
}

test("no credential, or a rejected one: AUTH_REQUIRED, never an invented result", async () => {
  const s = await setup();
  await assert.rejects(s.client.callTool("asfai_lesson", { action: "prepare_outline", payload: {} }), { code: "AUTH_REQUIRED" });
  await connect(s);
  s.mock.st.access.clear();                       // server revokes
  await assert.rejects(s.client.callTool("asfai_lesson", { action: "prepare_outline", payload: {} }), { code: "AUTH_REQUIRED" });
  assert.equal(s.oauth.status().connected, false, "status tells the truth after a 401");
});

test("the token file never holds anything but the host's own credentials", async () => {
  const s = await setup(); await connect(s);
  const raw = readFileSync(join(s.dir, "asfai-tokens.json"), "utf8");
  assert.ok(raw.includes("accessToken"));
  assert.equal(raw.includes("hermes"), false);
});
