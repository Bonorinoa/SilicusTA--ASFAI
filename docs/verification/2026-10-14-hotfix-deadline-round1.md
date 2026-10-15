VERDICT: BLOCK

Artifact

Root: /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff
Artifact reviewed: git show cfd9cc4 -- frontend/src/browser/site.ts frontend/src/browser/site.deadline.test.ts
HEAD verified as cfd9cc4578f67250529d3654743789fa2b57d5bb.
The working tree was clean after verification. No .env file was read and no vercel command was run.

Criterion 1 — passcode-dialog time is excluded from /api/worker and /api/fetch deadlines

PASS. The implementation creates the per-attempt AbortSignal.timeout only after passcode.get()/passcode.ask() at frontend/src/browser/site.ts:94-108. A 401 clears the passcode and repeats the loop, so the re-ask also occurs before creation of the next signal at lines 113-118.

Evidence:
- Current deadline tests: `npx vitest run src/browser/site.deadline.test.ts` in verifier-scratch/criterion4/frontend; captured exit code 0; 3 tests passed.
- The same test against the parent site.ts: captured inner `PARENT_TEST_EXIT_CODE=1`; all 3 tests failed, including the reproduced worker failure and both timeout tests.
- The same test against cfd9cc4 site.ts: captured inner `CURRENT_TEST_EXIT_CODE=0`; all 3 tests passed.
- Additional verifier audit: `npx vitest run src/browser/verifier-audit.test.ts` in verifier-scratch/criterion4/frontend; exit code 0; 3 tests passed. This includes a delayed 401 re-ask with a fresh non-aborted signal for both attempts.

Criterion 2 — every network attempt has a deadline and failures are plain messages

BLOCKED by Finding 1 below. The actual /api/worker and /api/fetch attempts have deadlines and their timeout/non-timeout failures are mapped to plain messages at site.ts:105-112, 121-129, and 141-149. However, the preliminary /api/worker/status network attempt has no deadline at all, so the broad acceptance requirement “Every network attempt” is not met.

Criterion 3 — no unrelated behavior changed

PASS for the reviewed hotfix scope, except that the criterion-2 block remains.

Evidence:
- `git diff --exit-code cfd9cc4^ cfd9cc4 -- host` returned exit code 0: host/ is untouched.
- `git show --format= --name-status cfd9cc4` lists only `frontend/src/browser/site.ts` modified and `frontend/src/browser/site.deadline.test.ts` added.
- The passcode/session behavior remains in the existing code at frontend/src/browser/passcode.ts:31-48 (sessionStorage keeper, clear on 401 path in site.ts:113-116), and the existing browser tests cover the 401 re-ask at frontend/src/browser/browserHost.test.ts:250-282, including “Not now” sends nothing.
- The existing mappings are unchanged in the commit diff at site.ts:132-138 and site.ts:157-164 (including 503/429/413/504/402 handling). The full frontend suite passed 218 tests.

Criterion 4 — regression test fails on parent and passes on cfd9cc4

PASS. I created a scratch copy under `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/verifier-scratch/criterion4`, copied the new test into it, copied the parent site.ts for the first run, and symlinked frontend/node_modules to the production checkout. The parent run captured exit code 1; the cfd9cc4 run captured exit code 0.

Criterion 5 — required suites

PASS.

1. Command: `cd frontend && npx tsc --noEmit -p . && npm test`
   Captured exit code: 0
   Output: `Test Files 21 passed (21)` and `Tests 218 passed (218)`.

2. Command: `node frontend/scripts/browser-mode-smoke.mjs`
   Captured exit code: 0
   Output: `39/39 browser-mode checks passed`.

3. Command: `cd host && node --test --test-timeout=30000 --test-force-exit`
   Captured exit code: 0
   Output: `tests 248`, `pass 248`, `fail 0`.

Findings by severity

HIGH — status health-check request can hang forever

Evidence:
- File: `/Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff/frontend/src/browser/site.ts:74-87`. The status request is `await fetchImpl(`${origin}/api/worker/status`, { method: "GET" })` at line 77, with no AbortSignal or timeout. Its `await res.json()` at line 79 is likewise not bounded by a signal.
- Reproduction/audit command: `npx vitest run src/browser/verifier-audit.test.ts`, run from `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/verifier-scratch/criterion4/frontend`; captured exit code 0; output was `3 tests passed`. The third audit test gave a never-resolving status fetch and verified after 100 ms that the result was still pending and `init.signal` was undefined.
- Consequence: `workerFetch()` awaits `withPasscode()` at site.ts:121-124, which first awaits `status()` at line 92. If `/api/worker/status` hangs, the worker request never reaches its bounded network attempt, the catch at lines 125-129 is never reached, and the teacher receives no plain failure message.

This finding is against acceptance criterion 2, not a claim that the requested model/link deadline hotfix is ineffective. The production /api/worker and /api/fetch attempts themselves passed the supplied regression tests.

Model route

Verifier route used: openai-codex / gpt-5.6-luna (ASU Codex seat), independent verifier route.
