VERDICT: NO BLOCK

Artifact
- Root: /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff
- Verified HEAD: 4360798f0295d46c5ccd1748de1c3b03e6705969 (main)
- Artifact under review: `git diff cfd9cc4^ 4360798 -- frontend/src/browser`
- Working tree check: `git status --short --branch`; exit 0; output `## main...origin/main` with no file changes.

Criterion 1 — teacher time is outside the network deadline, including 401 re-ask
- `frontend/src/browser/site.ts:98-103` asks for the passcode before each attempt; `:109-115` creates a fresh `AbortSignal.timeout(requestTimeoutMs)` only after the passcode is available and converts an aborted attempt to `SiteTimeout`.
- `site.ts:117-120` clears the session passcode on 401 and forces the next loop iteration to ask again; each iteration reaches the fresh signal creation at line 109.
- Current HEAD test: `cd frontend && npx vitest run src/browser/site.deadline.test.ts`; exit 0; output `4 tests passed`. This covers the worker dialog, worker timeout, link-reader dialog/timeout, and the follow-up status finding.
- Additional read-only scratch test for the 401 re-ask: `cd /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/current-tree/frontend && npx vitest run src/browser/site.reask.deadline.test.ts`; exit 0; output `1 test passed`. It used a caller signal expiring during two 80 ms prompts, observed two un-aborted network attempts, and observed passcodes `wrong` then `right`.

Criterion 2 — every network attempt is bounded and failures are plain teacher messages
- `frontend/src/browser/site.ts:81` supplies `AbortSignal.timeout(statusTimeoutMs)` to `/api/worker/status`; `:109-115` supplies the per-attempt request deadline to `/api/worker` and `/api/fetch` and recognizes timeout aborts.
- `site.ts:129-132` maps worker timeout and all other network failures to `WorkerError` with plain messages; `:150-153` maps link timeout/network failures to plain `MaterialError` messages. No raw browser exception text is propagated by these catches.
- Current HEAD deadline test passed as above. The fourth test specifically hangs the status check and then verifies the AI step ends in a plain message without `signal` text.
- Parent comparison also demonstrates the previously reported unbounded case is fixed: the parent-copy run failed all 4 deadline tests, with the first error `the drafting worker could not be reached: TimeoutError: signal timed out` and the remaining three timing out at 5000 ms; exit 1. The HEAD copy passed all 4; exit 0.

Criterion 3 — passcode and refusal behavior preserved; mappings and Node host unchanged
- `git diff --name-status cfd9cc4^ 4360798 -- frontend/src/browser host`; exit 0; output contains only:
  `A frontend/src/browser/site.deadline.test.ts`
  `M frontend/src/browser/site.ts`
- `git diff --quiet cfd9cc4^ 4360798 -- host`; exit 0, proving no host/ change in this range.
- `site.ts:136-141` retains the worker mappings for 503, 429, 413, 504, and upstream 402; those mapping lines are not changed by the diff. `browserHost.test.ts` passcode tests cover sessionStorage-only storage, 401 clearing/re-ask, and declining/Not now with no `/api/worker` call; its refusal tests cover 402, 429, and 503.
- Full frontend suite passed 219/219, including those browser-host tests. Browser smoke also passed all 39/39 checks, including sessionStorage-only passcode behavior and the only-expected-site-function network calls.

Criterion 4 — new tests fail at the parent and pass at HEAD
- Parent reproduction was made without changing the project tree: `git archive cfd9cc4^` was extracted under `/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/parent-tree`, the HEAD test was copied there, and `frontend/node_modules` was symlinked.
- Command: `cd /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-scratch/parent-tree/frontend && npx vitest run src/browser/site.deadline.test.ts`; exit 1; output `4 tests | 4 failed`. The first reproduced the raw `TimeoutError: signal timed out`; the other three hung until Vitest's 5000 ms test timeout.
- HEAD command: `cd /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff/frontend && npx vitest run src/browser/site.deadline.test.ts`; exit 0; output `4 tests passed`.

Criterion 5 — required suites and captured exit codes
- `cd frontend && npx tsc --noEmit -p . && npm test`; exit 0. Standalone TypeScript command also returned exit 0. npm output: `21 passed` test files and `219 passed` tests.
- `node frontend/scripts/browser-mode-smoke.mjs`; exit 0. Output: `39/39 browser-mode checks passed`.
- `cd host && node --test --test-timeout=30000 --test-force-exit`; exit 0. Output: `tests 248`, `pass 248`, `fail 0`.
- No `vercel` command was run and no `.env` file was read.

Findings by severity
- BLOCKING/HIGH: none.
- MEDIUM: none.
- LOW: non-functional hygiene only. `git diff --check cfd9cc4^ 4360798 -- frontend/src/browser` returned exit 2 because `frontend/src/browser/site.deadline.test.ts:102` has a blank line at EOF. This does not affect any acceptance criterion or runtime behavior.

Verification route
- Model route run: openai-codex / gpt-5.6-luna.
- Verification report path: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-hotfix-report.md
