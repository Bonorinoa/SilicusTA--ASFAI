VERDICT: BLOCK

Criterion 1 — PASS
Command: the required suite commands were each run with stdout/stderr redirected to verifier-scratch/suite-*.log; exit codes were captured by the wrapper in verifier-scratch/suite-status.txt.
Exit codes: all 0.
Evidence and counts:
- `cd confirm-gate && node --test`: 41 tests, 41 pass, 0 fail; suite-confirm-gate.log:42-48.
- `node --test api/test/`: 54 tests, 54 pass, 0 fail; suite-api.log:55-61.
- `cd host && node --test --test-timeout=30000 --test-force-exit`: 247 tests, 247 pass, 0 fail; suite-host.log: `tests 247`, `pass 247`, `fail 0`.
- `cd host && node scripts/e2e-restart.mjs`: 53/53 acceptance checks; suite-e2e-restart.log:56.
- `cd frontend && npx tsc --noEmit -p .`: exit 0; suite-frontend-tsc.log is empty because TypeScript emitted no diagnostics.
- `cd frontend && npm test`: 20 files, 215 tests, 215 pass; suite-frontend-test.log:32-35.
- `cd frontend && npm run build`: exit 0; suite-frontend-build.log:15.
- `node frontend/scripts/live-host-smoke.mjs`: 62/62; suite-live-host-smoke.log: `62/62 live acceptance checks passed`.
- `node frontend/scripts/browser-mode-smoke.mjs`: 37/37; suite-browser-mode-smoke.log:39.

Criterion 2 — PASS
Command: `git diff --exit-code main -- confirm-gate`
Exit code: 0.
Evidence: command produced no diff output. The captured command output also records `confirm_diff_exit=0`.

Criterion 3 — PASS
Commands:
- `node /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/own-attacks.mjs > .../own-attacks.log 2>&1`
- `node --test api/test/`
Exit codes: own attack 0; API suite 0.
Evidence:
- `api/_lib/passcode.mjs:17-22` hashes both values and uses `crypto.timingSafeEqual` on equal-length SHA-256 digests.
- `api/_lib/worker.mjs:96-111` requires key, model and passcode, rate-limits before passcode failure, and rejects missing/wrong passcodes; `worker.mjs:52-71` allow-lists request fields and forces the configured model/max-token/ZDR policy.
- `api/_lib/worker.mjs:113-152` performs one upstream attempt, applies the deadline, returns only status-derived errors, and rejects an upstream JSON response containing the secret key.
- `api/_lib/http.mjs:38-81` enforces the 512-KB capped body read and 413 mapping.
- `own-attacks.log` output is `OWN_ATTACKS_PASS worker=8 ssrf=10 intent_and_backup=2`; the injected-handler cases are in own-attacks.mjs:21-38.
- The API suite independently reports 54/54, including passcode, constant-time, policy stripping, ZDR fail-closed, body cap, key non-disclosure, rate and deadline cases (suite-api.log:27-54).

Criterion 4 — PASS
Commands:
- `node /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/own-attacks.mjs > .../own-attacks.log 2>&1`
- `node --test api/test/`
Exit codes: own attack 0; API suite 0.
Evidence:
- `host/materials.mjs:65-114` rejects non-public IPv4/IPv6, IPv4-mapped IPv6, localhost-like names, private DNS answers, and trailing-dot normalization; `host/materials.mjs:147-162` follows redirects manually and re-vets every location.
- The independent injected-fetch cases cover decimal `2130706433`, hexadecimal `0x7f000001`, octal `0177.0.0.1`, trailing-dot loopback, `[::ffff:a9fe:a9fe]`, userinfo (`example.com@127.0.0.1`), private DNS with trailing dot, and redirects to decimal/private targets (own-attacks.mjs:40-76). All returned 422 `URL_REFUSED`; no direct target was fetched.
- API suite reports the existing private/link-local/mapped-IPv6, redirect, YouTube, and body cases green (suite-api.log:12-21).

Criterion 5 — PASS
Commands:
- `node /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/own-attacks.mjs > .../own-attacks.log 2>&1`
- `cd frontend && npm test`
- `node frontend/scripts/browser-mode-smoke.mjs`
Exit codes: own attack 0; frontend test 0; browser smoke 0.
Evidence:
- `frontend/src/browser/idb.ts:54-73` writes with IndexedDB `add`, never `put`; `frontend/src/browser/browserHost.ts:89-171` awaits write-through and returns JSON copies only.
- `frontend/src/browser/browserHost.ts:189-214` verifies an import before writing and rejects conflicts; `frontend/src/browser/browserHost.test.ts:106-127` covers tampered stored records and `:226-235` covers tampered import files.
- Material and student-chat rules are exercised by `frontend/src/browser/browserHost.test.ts:165-195`; the browser smoke explicitly reports material text absent from IndexedDB/web storage and student chat wrote nothing (suite-browser-mode-smoke.log:16-18, 23-24).
- `host/handler.mjs:15-18` defines the intents-only boundary; `host/handler.mjs:248-270` ignores client objective content and routes decisions to the host session. The independent forged provenance/turnRef/decidedBy/channel/mt_* case is in own-attacks.mjs:78-99 and passed; no forged marker reached the stored record.
- Browser smoke reports tampered export refusal with no write and successful re-import (suite-browser-mode-smoke.log:30-33).

Criterion 6 — PASS
Command: `git diff --name-status --diff-filter=M main -- 'host/test/**/*.test.*' 'host/test/**/*.spec.*' 'frontend/src/**/*.test.*' 'frontend/src/**/*.spec.*'`
Exit code: 0; output empty.
Evidence: the broader `git diff --name-status main -- host/test frontend/src` lists the test additions as `A` only (browserMode.test.tsx, browserHost.test.ts, record-store.test.mjs, scripted-course.mjs, sha256.test.mjs, worker-fetch-errors.test.mjs); no pre-existing test file is modified. The frontend source modifications listed there are production `.tsx/.ts/.mjs` files, not pre-existing test assertions.

Criterion 7 — FAIL
Commands:
- Browser build, using the local installed Vite binary without package resolution: `cd frontend && PATH="$PWD/node_modules/.bin:$PATH" VITE_SILICUS_MODE=browser npx --no-install vite build --outDir /tmp/verify-dist`
- `grep -RInaE --binary-files=without-match 'sk(-or)?-v1-[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}' /tmp/verify-dist`
- `grep -RhoE --binary-files=without-match 'OPENROUTER_API_KEY|SILICUS_WORKER_MODEL|SILICUS_DEMO_PASSCODE|SILICUS_WORKER_ZDR|SILICUS_DAILY_CAP|SILICUS_WORKER_MAX_TOKENS|SILICUS_WORKER_URL|SILICUS_WORKER_PROVIDER|ANTHROPIC_API_KEY' /tmp/verify-dist | sort -u`
- `git grep -nE 'sk(-or)?-v1-[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}' -- ':!*.env' ':!*.env.*'`
Exit codes: browser build 0; bundle key scan 1 (no key-shaped match); repo key scan 1 (no key-shaped match); bundle env-name scan 0.
Evidence: the env-name scan output is exactly:
`SILICUS_WORKER_MODEL`
`SILICUS_WORKER_URL`
`SILICUS_WORKER_ZDR`
These strings occur in `/tmp/verify-dist/assets/browserHost-BfJ4Euje.js:4` in the built browser bundle. The bundle therefore contains server environment variable names, even though no key-shaped credential was found. This violates the criterion's explicit search-for-env-names requirement.

Criterion 8 — PASS
Commands:
- `cd frontend && npm test`
- `node frontend/scripts/browser-mode-smoke.mjs`
- `git grep -nEi 'proof|tamper-proof|tamper.evident|zero[- ]retention|this browser keeps|stored in this browser' -- frontend/src`
Exit codes: frontend test 0; browser smoke 0; UI scan 0.
Evidence:
- `frontend/src/live/MaterialsPanel.tsx:67-72` emits the zero-retention claim only for `zdr === true`; the other branch explicitly says normal retention terms.
- `frontend/src/browser/site.ts:68-80` accepts `zdr` only as the site's reported boolean (`j.zdr === true`).
- `frontend/src/live/LiveCourse.tsx:254` says “tamper-evident JSON”; it does not say proof. `frontend/src/browser/BrowserRecord.tsx:96-100` says the record is stored in this browser only, not on a server.
- The frontend test explicitly verifies the false-ZDR copy (LiveCourse.test.tsx:434-443), and browser smoke reports the true-ZDR claim only when status says `zdr: true` (suite-browser-mode-smoke.log:11-12).

Findings

MED-1 — Browser bundle exposes server environment-variable names.
Evidence: `/tmp/verify-dist/assets/browserHost-BfJ4Euje.js:4` contains `SILICUS_WORKER_MODEL`, `SILICUS_WORKER_URL`, and `SILICUS_WORKER_ZDR`; the command `grep -RhoE --binary-files=without-match 'OPENROUTER_API_KEY|SILICUS_WORKER_MODEL|SILICUS_DEMO_PASSCODE|SILICUS_WORKER_ZDR|SILICUS_DAILY_CAP|SILICUS_WORKER_MAX_TOKENS|SILICUS_WORKER_URL|SILICUS_WORKER_PROVIDER|ANTHROPIC_API_KEY' /tmp/verify-dist | sort -u` exited 0 and printed those three names. Reproduction: rerun the browser build command in Criterion 7, then rerun that scan. No credential-shaped string was found; the failure is the explicit env-name condition.

Model route: openai-codex / gpt-5.6-luna (independent verifier route).

Artifact path: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-online-report.md
