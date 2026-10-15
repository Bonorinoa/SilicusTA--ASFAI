VERDICT: NO BLOCK

Artifact: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-verify
Verified commit: e0ffe1ab730c8f0a6a7acac5377c339be96573df (feat/online)

Criterion 1 — PASS
Command: each required suite command was run with stdout/stderr redirected to its own file under /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/round2-*.log; exit codes were captured without piping in round2-status.txt.
Exit code: all nine captured statuses are 0; round2-status.txt:1-9.
Evidence:
- cd confirm-gate && node --test: 41 tests, 41 pass, 0 fail; round2-confirm-gate.log:42-49.
- node --test api/test/: 54 tests, 54 pass, 0 fail; round2-api.log:55-62.
- cd host && node --test --test-timeout=30000 --test-force-exit: 248 tests, 248 pass, 0 fail; round2-host.log:255-262.
- cd host && node scripts/e2e-restart.mjs: 53/53 acceptance checks; round2-e2e-restart.log:56.
- cd frontend && npx tsc --noEmit -p .: exit 0; round2-status.txt:5 and the redirected diagnostic file is empty (round2-frontend-tsc.log, 0 bytes).
- cd frontend && npm test: 20 files, 215 tests, 215 pass; round2-frontend-test.log:29-34.
- cd frontend && npm run build: exit 0; round2-frontend-build.log:2-15.
- node frontend/scripts/live-host-smoke.mjs: 62/62; round2-live-host-smoke.log:129.
- node frontend/scripts/browser-mode-smoke.mjs: 39/39; round2-browser-mode-smoke.log:39-41.

Criterion 2 — PASS
Command: git diff --exit-code main -- confirm-gate > verifier-scratch/round2-confirm-diff.log 2>&1
Exit code: 0, captured in round2-confirm-diff-status.txt:1.
Evidence: round2-confirm-diff.log is empty; no confirm-gate diff exists.

Criterion 3 — PASS
Commands:
- node verifier-scratch/round2-own-attacks.mjs > verifier-scratch/round2-own-attacks.log 2>&1
- node --test api/test/ > verifier-scratch/round2-api.log 2>&1
Exit codes: own attack 0, captured in round2-own-attacks-status.txt:1; API suite 0, captured in round2-status.txt:2.
Evidence:
- api/_lib/passcode.mjs:16-22 hashes both values to equal-length SHA-256 digests and uses crypto.timingSafeEqual; unset/empty expected passcodes return false.
- api/_lib/worker.mjs:96-111 requires key, model and passcode, rate-limits before passcode failure, and allow-lists the request body; api/_lib/worker.mjs:61-71 forces the environment model, caps max_tokens, drops client provider/tools/stream fields, and applies the default ZDR provider block.
- api/_lib/worker.mjs:113-152 makes one upstream attempt, applies the deadline, relays only status-derived upstream errors, and refuses a successful upstream response that contains the secret key; api/_lib/http.mjs:38-81 enforces the capped body read and 413 mapping.
- The independent injected-fetch attack output is ROUND2_OWN_ATTACKS_PASS worker=6 ssrf=9 (round2-own-attacks.log:1). It tested missing/unconfigured, missing and wrong passcodes; hostile model/provider/tools/stream; default and explicit-off ZDR; upstream key echo; oversize request body; and the API's refusal/no-upstream behavior.
- Existing API assertions independently cover constant-time comparison, policy stripping, ZDR fail-closed behavior, 413 by content length and by stream, upstream error-body non-disclosure, and key echo refusal; round2-api.log:27-53.

Criterion 4 — PASS
Commands:
- node verifier-scratch/round2-own-attacks.mjs > verifier-scratch/round2-own-attacks.log 2>&1
- node --test api/test/ > verifier-scratch/round2-api.log 2>&1
Exit codes: own attack 0 (round2-own-attacks-status.txt:1); API suite 0 (round2-status.txt:2).
Evidence:
- host/materials.mjs:85-114 parses the URL, requires HTTPS, refuses credentials/nonstandard ports, strips trailing-dot host syntax, rejects private IPs and private DNS answers; host/materials.mjs:147-169 follows redirects manually and re-vets every Location before fetching it.
- The independent injected-fetch cases covered decimal 2130706433, hexadecimal 0x7f000001, octal 0177.0.0.1, trailing-dot loopback, [::ffff:a9fe:a9fe], example.com@127.0.0.1, a trailing-dot private DNS hostname, a redirect to the decimal loopback spelling, and YouTube. The attack output is round2-own-attacks.log:1 and no unexpected fetch was called.
- Existing API tests cover private/loopback/metadata, redirects, YouTube, body limits and rate/deadline behavior; round2-api.log:8-20.

Criterion 5 — PASS
Commands:
- node --test host/test/ (included in the host suite command above)
- cd frontend && npm test > verifier-scratch/round2-frontend-test.log 2>&1
- node frontend/scripts/browser-mode-smoke.mjs > verifier-scratch/round2-browser-mode-smoke.log 2>&1
Exit codes: host 0 (round2-status.txt:3), frontend tests 0 (round2-status.txt:6), browser smoke 0 (round2-status.txt:9).
Evidence:
- frontend/src/browser/idb.ts:54-72 writes events and metadata with IndexedDB add, never put; frontend/src/browser/browserHost.ts:89-171 awaits write-through and returns JSON copies only.
- frontend/src/browser/browserHost.ts:118-123 reloads stored data, and host/handler.mjs:94-103 loads a verified session per request. The tampered-record tests exercise refusal rather than silent load: frontend/src/browser/browserHost.test.ts:106-127.
- Material text and student-chat non-persistence are tested directly in frontend/src/browser/browserHost.test.ts:165-195; the browser smoke reports no material text in IndexedDB/web storage at round2-browser-mode-smoke.log:18-19 and no student-chat write at :25.
- Import calls readBackup before any write (frontend/src/browser/browserHost.ts:189-213); tampered import refusal and unchanged storage are asserted in frontend/src/browser/browserHost.test.ts:226-236 and in the browser smoke at round2-browser-mode-smoke.log:32-34.
- The intents boundary is implemented in host/handler.mjs:15-18 and decisions are reduced to verb-specific fields in host/course.mjs:426-455. The host suite explicitly passes forged provenance, turnRef, decidedBy, channel, id, kind and mt_* alignment keys and verifies that they do not reach the log; round2-host.log:51-56. The independent scripted host path also includes forged fields (host/test/scripted-course.mjs:68-76).
- The browser smoke confirms the browser-written record verifies on the Node chain and survives reload/import; round2-browser-mode-smoke.log:26-35.

Criterion 6 — PASS
Command: git diff --name-status main -- 'host/test/**/*.test.*' 'host/test/**/*.spec.*' 'frontend/src/**/*.test.*' 'frontend/src/**/*.spec.*'
Exit code: 0, captured in round2-preexisting-test-diff-status.txt:1.
Evidence: the path-scoped diff lists only newly added browser tests (A, not modified assertions) at round2-preexisting-test-diff.log:1-2. The broader host/test + frontend/src diff lists host test additions as A and only production frontend files as M; round2-test-diff.log:1-24. The host test suite is green at 248/248 (round2-host.log:255-262).

Criterion 7 — PASS
Commands:
- cd frontend && VITE_SILICUS_MODE=browser npx --no-install vite build --outDir /tmp/verify-dist-npx (the local npx Vite invocation; output redirected to round2-browser-build-npx.log)
- Python scan of /tmp/verify-dist-npx for key-shaped strings and server environment names
- git grep -nE 'sk-(or-)?v1-[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}' -- ':!*.env' ':!*.env.*'
Exit codes: browser build 0, captured in round2-browser-build-npx-status.txt:1; bundle scan 0, captured in round2-bundle-scan-npx-status.txt:1; repository key-shaped scan 1, meaning no match, with status captured in round2-repo-key-scan-status.txt:1.
Evidence:
- Browser build output reports 93 modules transformed and a successful build; round2-browser-build-npx.log contains the complete redirected output.
- The bundle scan output is key_shaped_matches= [] and env_name_matches= [] at round2-bundle-scan-npx.log:1-2.
- The repository key-shaped grep produced no output and exited 1; no key-shaped credential was found in tracked files outside excluded .env patterns.
- The browser import-graph guard independently finds no server env/key names; round2-host.log:47. The browser smoke repeats the built-bundle check and passes both env/key-name and key-shaped scans; round2-browser-mode-smoke.log:4-5.

Criterion 8 — PASS
Commands:
- cd frontend && npm test > verifier-scratch/round2-frontend-test.log 2>&1
- node frontend/scripts/browser-mode-smoke.mjs > verifier-scratch/round2-browser-mode-smoke.log 2>&1
Exit codes: frontend tests 0 (round2-status.txt:6); browser smoke 0 (round2-status.txt:9).
Evidence:
- frontend/src/browser/site.ts:68-80 accepts the site's reported boolean only as zdr === true; frontend/src/live/MaterialsPanel.tsx:67-72 emits the zero-retention claim only in the explicit zdr === true branch and otherwise states normal retention terms. The false-status UI assertion is frontend/src/live/LiveCourse.test.tsx:434-443; the browser smoke verifies the true-status claim at round2-browser-mode-smoke.log:13-14.
- The record copy says this browser keeps the record and that courses are stored in this browser only, not on a server (frontend/src/browser/BrowserRecord.tsx:95-100); the browser-mode UI test asserts it at frontend/src/browser/BrowserMode.test.tsx:49-61 and the smoke passes it at round2-browser-mode-smoke.log:7-9.
- The export/status copy says tamper-evident JSON, not proof (frontend/src/live/LiveCourse.tsx:244-255). The smoke also verifies tampered export refusal rather than proof/tamper-proof language at round2-browser-mode-smoke.log:32-34.

Findings

None. All eight criteria pass at e0ffe1a. The round-1 MED-1 condition is cleared: the browser build contains neither the server environment-variable names nor key-shaped strings, and the browser import-graph test and browser-mode smoke both pass.

Model route: openai-codex / gpt-5.6-luna (independent verifier route).

Artifact path: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-online-report.md
Final verification command/status record: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/round2-status.txt (all suite exit codes 0).