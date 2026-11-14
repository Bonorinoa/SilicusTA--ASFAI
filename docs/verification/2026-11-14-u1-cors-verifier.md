# U1V · Verifier gate on U1 (asfai-education CORS fork branch)

**Verdict: ACCEPT WITH CONDITIONS** (no HIGH finding; 1 MEDIUM, 5 LOW)

- Artifact: `Bonorinoa/asfai-education` branch `fix/cors-browser-mcp-clients` @ `77abe8200e863d33a422df20484b1e65b35eb493`
  (`git ls-remote origin` = this sha); base `dac19d3da211e22c3fd6cb4613add16e652131c9` (`git ls-remote upstream main` = same, so upstream has not moved).
- PR draft: `docs/upstream/2026-11-14-asfai-cors-pr.md` @ `ebaab45` on branch `docs/upstream-cors` (not on `main`, as the U1 card asked).
- Verifier route: `claude-sonnet-5-5` / anthropic (card override). Producer was DeepSeek, so the check is cross-family. The ASFAI/Codex seat was not used.
- Probe (reproduces every live claim below): `docs/verification/2026-11-14-u1-cors-probe.py`, exit 0.
- Node v22.22.3, npm 10.9.8. Scratch: `$TMPDIR/u1v` (fresh clone from GitHub, not the producer's checkout).

## 1. Independence: met

`/Users/bonorinoa/.hermes/profiles/engineer/logs/agent.log`, the two U1 sessions (found through the `Kanban task t_e051b953` turn_context lines 14047 and 14858):

```
grep -F <session> agent.log | grep -oE "model=[^ ]+ provider=[^ ]+" | sort | uniq -c
d89a1f36…  (12:41–12:55)  61  model=deepseek/deepseek-v4-flash-0731 provider=nous   fallback/falling-back lines: 0
27051ed2…  (12:55–12:59)  16  model=deepseek/deepseek-v4-flash-0731 provider=nous   fallback/falling-back lines: 0
```

No Claude fallback. Two `provider=openai` strings in the 12:00–13:59 window (log lines 14947, 15010) are tool output of a different session
(`6c52ded6…`, a worker printing its own config), not a U1 API call.

## 2. Fresh clone, Node 22: met

`git clone -b fix/cors-browser-mcp-clients https://github.com/Bonorinoa/asfai-education.git`, HEAD = 77abe82.

| Command (in the clone) | Exit | Result |
|---|---|---|
| `npm ci` | 0 | |
| `npm test` | 0 | 22 files, 118 tests passed |
| `npm run lint` | 0 | |
| `npm run build` (next build) | 0 | 16 routes incl. the four |
| `npm run build:plugin` | 0 | |
| `npm run test:plugin` | 0 | |
| base `dac19d3`: `npm ci`, `npm test`, `npm run build` | 0, 0, 0 | 21 files, 97 tests (so +1 file, +21 tests) |
| RED: new `tests/cors.test.ts` copied into base, `npx vitest run tests/cors.test.ts` | 1 | 16 failed, 5 passed (21) |

`git status --short` after the five checks: clean (no generated tracked files).

## 3. Diff and byte-identity: met

`git diff --name-status dac19d3 HEAD`: `M` four route files (`api/[transport]`, `oauth/register`, `oauth/revoke`, `oauth/token`),
`A src/lib/cors.ts`, `A tests/cors.test.ts`. No `package.json`/lockfile change, no other route. `grep -rn allow-credentials src` = no match.
Commit author is Augusto's identity.

Byte-identity, live: `next start` of base (:3101), HEAD with `ASFAI_CORS_ORIGINS` unset (:3102), HEAD with it set (:3103).
Probe Part A sends 37 requests (OPTIONS/POST/GET/DELETE × four endpoints × origin none / listed / unlisted / `null`) to :3101 and :3102 and
compares status, ordered header list (minus Date/ETag/Connection) and body bytes:

```
PART_A matrix=37 diffs=0      (37/37 identical=True, 0 access-control-* headers on HEAD-unset)
```

Part B also compares valid requests (register 201, revoke 200, token 400) base vs HEAD-unset: headers identical.
Ran with `ASFAI_REMOTE_DATA_DIR` in scratch and a made-up throwaway token secret. No real secret read.

## 4. Security read: met, with one test-coverage gap (M1)

Source `src/lib/cors.ts:37-42`: `origins.includes(origin)` is strict string equality, no regex, no substring, no `*` handling, and `corsOrigins()`
(lines 26-34) trims entries. A request `Origin` of `null` matches only if an operator writes `null` in the env var.

Live, HEAD with env `https://silicus-ta.vercel.app, https://app.example.com`, probe Part B (133 `ok`, 0 failed, 4 endpoints):

- Listed origin: preflight 204, `access-control-allow-origin` echoes it, `Vary: Origin`, exact methods/headers/expose/max-age, no allow-credentials.
- 11 lookalikes (`null`, `…vercel.app.evil.example`, `evil-silicus-ta.vercel.app`, `http://` scheme, trailing slash, upper-case host, `:443`,
  `app.example.com.`, `*`, empty, `https://evil.example`) × OPTIONS and POST × 4 endpoints: zero `access-control-*` headers leaked.
- Unlisted preflight with env set is byte-identical to the upstream preflight (`allow` line included) on all four endpoints.
- `POST /api/mcp` 401 keeps `www-authenticate` and gains the header block (`curl -si` shows both).
- `Vary: Origin` is present on every echoed response (preflight and real). Next adds its own `vary: rsc, …` as a separate header line, so the
  two coexist.

## 5. PR description draft vs diff: met with wording fixes (L1, L5)

Checked against the diff and the live runs: commit and file count (line 7), env semantics, header values (16-21), no credentials (22), four `OPTIONS`
handlers (24-27), 401 `www-authenticate` (28-30), unchanged `basePath` (31), "byte-identical" (14, 66, 105: proven in section 3), 22 files / 118 tests (74),
`allowedRedirectUri` at `src/lib/remote-oauth.ts:195` (93, confirmed by grep), the observed 400 for a Silicus redirect (100-101: I got
`invalid_redirect_uri` for `https://silicus-ta.vercel.app/cb`). The draft is accurate on those. Exceptions are L1 and L5 below.

## Findings

### MEDIUM

**M1. The tests do not guard exact-match, so a regression to prefix/substring/`null` would go green.** The implementation is correct
(section 4), but `tests/cors.test.ts:17` has a single unlisted origin, `https://unlisted.example.com`. Mutation check, editing only
`src/lib/cors.ts:41` in the scratch clone, then `npx vitest run tests/cors.test.ts`:

| Mutant of `origins.includes(origin)` | Exit | Tests |
|---|---|---|
| `origins.some((o) => origin.startsWith(o))` | 0 | 21 passed (survives) |
| `origins.some((o) => origin.includes(o))` | 0 | 21 passed (survives) |
| `(origin === "null" \|\| origins.includes(origin))` | 0 | 21 passed (survives) |
| `true` (allow all) | 1 | 5 failed (killed) |

The card's headline security property is exact match. **Condition:** add one test per endpoint family (or one shared helper test) with lookalike
origins (suffix/prefix of the listed origin, `null`, trailing slash, other scheme) expecting no `access-control-*` headers; it must fail on the
first three mutants. The file is the producer's own test; I did not edit it.

### LOW

**L1. The MCP route preflight advertises `POST, OPTIONS` only, but the route serves GET and DELETE; the draft wording hides that.**
`src/lib/cors.ts:19` is shared by all four routes. Live: `OPTIONS /education/api/mcp` with `Access-Control-Request-Method: GET` and a listed origin
returns `access-control-allow-methods: POST, OPTIONS`. This matches issue #16's text exactly, so it is spec-inherited, not a producer error. But draft
lines 26-27 say the MCP preflight "advertises the route's full method set, `DELETE, GET, HEAD, OPTIONS, POST`". That is the `allow` line on the
unlisted/unset preflight only. A listed origin gets no `allow` line, just the CORS block. I did not test the MCP SDK's behaviour when its optional GET stream or
DELETE preflight fails. Owner/maintainer question: add `GET, DELETE` for the MCP route, or keep the issue's text. Fix the draft sentence either way.

**L2. A thrown error escapes CORS.** `withCors` (`src/lib/cors.ts:80-93`) wraps returned responses only. In my first probe run, with the state dir unwritable,
`POST /oauth/revoke` threw and returned `500` with no `access-control-*` headers (revoke has no try/catch, `src/app/oauth/revoke/route.ts`). The browser sees an
opaque network error instead of a readable 500. Upstream behaviour for the 500 itself is unchanged. Optional hardening.

**L3. Latent Vary overwrite.** `src/lib/cors.ts:85-87` uses `headers.set`, which would replace a `Vary` value an inner handler set. Today no inner handler sets
one (live `vary-before` is only Next's own line, and Next appends it outside the handler), so nothing breaks. `headers.append("vary", "Origin")` is the safe form.

**L4. No `Vary: Origin` when the env is set but the origin is unlisted.** Fine for `POST` and no-store token responses, and the issue asks for it only on echoed
responses. A shared cache in front of `GET /api/mcp` could in theory cache a no-CORS answer for a listed origin. Noted, not required.

**L5. Draft nits.** Line 15 "to-day" (typo for "today"). Lines 39-62 point the curls at `https://education.asfai.org`, which only answers with CORS once the
env var is set there; say "against a deployment with the env var set".

### Information for the owner (not a defect of U1)

CORS alone does not unblock Silicus: `allowedRedirectUri` (`src/lib/remote-oauth.ts:195-204`) rejects an `https://silicus-ta.vercel.app/...` redirect in
production (live: 400 `invalid_redirect_uri`). The draft already says so (lines 93-101), and it is outside U1's fence, so it is consistent with G1
reading Marble directly.

## Not verified

- No browser-level test (a real cross-origin `fetch`). Evidence is raw HTTP from `next start`, which is what a browser reads.
- The MCP SDK's handling of a failed GET/DELETE preflight (L1) and streaming (GET SSE) bodies through `withCors`: not exercised.
- No look at the fork's GitHub settings, CI, or the issue thread beyond: no PR from the fork branch (`gh pr list -R Bonorinoa/asfai-education --head …`
  returned nothing), no comment on issue #16 (`comments|length` = 0), the only PR by `Bonorinoa` on `redbeard-26/asfai-education` is the closed #15 (`gh pr list --author Bonorinoa --state all`).
- Producer's claim of the earlier timed-out attempt is taken from the handoff; the log shows exactly two U1 sessions, which matches.
