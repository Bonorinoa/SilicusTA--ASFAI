# PR description draft — CORS allow-list for browser MCP clients

Upstream: `redbeard-26/asfai-education` · issue #16 · prepared 14 Nov 2026 by Silicus TA (`Bonorinoa/asfai-education` fork)

- Branch on the fork: `fix/cors-browser-mcp-clients`
- Base: `upstream/main` @ `dac19d3` (the sha the issue was observed against)
- Commit: `77abe82` — 6 files changed (`src/lib/cors.ts` added, four route files, `tests/cors.test.ts` added)

## What changed

One shared helper, `src/lib/cors.ts`, and four routes wiring it in:

- **`ASFAI_CORS_ORIGINS` env var** (comma-separated, exact match). When it is
  unset, nothing changes — preflights keep the framework's plain `204`, real
  responses are byte-identical to to-day. **Additive, default unchanged.**
- A matching `Origin` is **echoed back**, `Vary: Origin` is added, and the
  response carries `Access-Control-Allow-Methods: POST, OPTIONS`,
  `Access-Control-Allow-Headers: authorization, content-type,
  mcp-protocol-version, mcp-session-id, last-event-id`,
  `Access-Control-Expose-Headers: www-authenticate, mcp-session-id` and
  `Access-Control-Max-Age: 600`.
- **No `Access-Control-Allow-Credentials`**: every call uses a Bearer token or
  a public-client form post, never cookies.
- `OPTIONS` handlers on `src/app/oauth/register/route.ts`,
  `src/app/oauth/token/route.ts`, `src/app/oauth/revoke/route.ts` and
  `src/app/api/[transport]/route.ts` (the MCP route's preflight advertises the
  route's full method set, `DELETE, GET, HEAD, OPTIONS, POST`).
- The headers are applied to the **real responses** too, including the 401 from
  `/api/mcp` — so a browser can read its `www-authenticate` and complete a
  challenge instead of swallowing the error.
- `basePath` (`/education`) is untouched: the handlers run at their existing
  `/education/...` paths.

Out of scope on purpose: OAuth semantics, token storage, registration rules.
The `allowedRedirectUri` validator in `src/lib/remote-oauth.ts` is unchanged.

## How to test

Run with `ASFAI_CORS_ORIGINS=https://silicus-ta.vercel.app` (or your client
origin). One command per endpoint:

```bash
# 1. register preflight
curl -i -X OPTIONS https://education.asfai.org/education/oauth/register \
  -H 'Origin: https://silicus-ta.vercel.app' -H 'Access-Control-Request-Method: POST'

# 2. token preflight
curl -i -X OPTIONS https://education.asfai.org/education/oauth/token \
  -H 'Origin: https://silicus-ta.vercel.app' -H 'Access-Control-Request-Method: POST'

# 3. revoke preflight
curl -i -X OPTIONS https://education.asfai.org/education/oauth/revoke \
  -H 'Origin: https://silicus-ta.vercel.app' -H 'Access-Control-Request-Method: POST'

# 4. MCP preflight
curl -i -X OPTIONS https://education.asfai.org/education/api/mcp \
  -H 'Origin: https://silicus-ta.vercel.app' -H 'Access-Control-Request-Method: POST'

# 5. MCP real call: 401 must now carry access-control-* AND www-authenticate
curl -i -X POST https://education.asfai.org/education/api/mcp \
  -H 'Origin: https://silicus-ta.vercel.app' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Observed on Node v22.22.3 against this branch (reproducible with the repo's own
build; the env-unset server answers every endpoint exactly as `dac19d3` does):

| Endpoint | Listed Origin | Unlisted Origin | Env unset |
|---|---|---|---|
| `OPTIONS` x4 | `204` + full header block, `Vary: Origin` | `204`, no `access-control-*` | `204`, no `access-control-*` (identical to base) |
| `POST /api/mcp` (no auth) | `401` + header block + `www-authenticate` | no `access-control-*` | no `access-control-*` (identical to base) |

Automated checks, all exit 0 on Node v22.22.3: `npm ci`, `npm test`
(22 files / 118 tests, incl. the 21 new CORS tests), `npm run lint`,
`npm run build`, `npm run build:plugin`, `npm run test:plugin`.

## Open questions from issue #16, with our recommended answers

### 1. Allow-list env var, or a fixed list in code?

**Recommendation: keep the allow-list env var.** Unset = byte-identical
default, so each deployment decides without a code change, and this service
already reads its deployment shape from env (`ASFAI_SITE_ORIGIN`,
`ASFAI_REMOTE_TOKEN_SECRET`). A fixed list in code would force a redeploy for
every new client origin. A wildcard is defensible for a bearer-token API with
no cookies, but an allow-list stays the cautious default and the env var keeps
it a one-line operational change if it ever needs to move.

### 2. Should `register` be restricted to origins whose `redirect_uris` match the requesting origin?

**Recommendation: not in this PR.** Registration rules are out of scope here,
and today's validator is already the gate: `allowedRedirectUri`
(`src/lib/remote-oauth.ts:195`) only admits `claude.ai`/`claude.com`
`/api/mcp/auth_callback` URLs, `chatgpt.com`/`platform.openai.com`, and local
loopback — a custom web origin cannot register at all in production as of
`dac19d3`. CORS only decides browser readability; the semantic control is the
`redirect_uri` membership check at authorize time. If a first-party origin
restriction is wanted, it should be a separate change to the registration
policy (and would first need the validator widened so browser clients on
arbitrary hosts can register at all — the observed 400 for
`https://silicus-ta.vercel.app/oauth/callback`).

## Compatibility

Additive. With `ASFAI_CORS_ORIGINS` unset, every response — preflight and real
— is byte-identical to `dac19d3`. Non-browser clients are unaffected (they
ignore CORS). No dependency added, no storage or OAuth semantics touched.
