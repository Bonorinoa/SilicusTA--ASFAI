VERDICT: NO BLOCK

Silicus TA 3.0 — independent verification of feat/polish

Artifact: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-verify-polish
Reviewed commit: ae8fe0632baa3c01dca47f4d5abfc6b1622f49ec
Comparison: git diff main...feat/polish
Fence honored: read-only worktree; no commit, push, merge, vercel, .env access, or model-network calls.

Criteria

| Criterion | Result | Evidence (command; captured exit code) |
|---|---|---|
| C1 Suites green; confirm-gate unchanged | PASS | `cd confirm-gate && node --test` — 41/41, exit 0. `git diff main -- confirm-gate` — empty, exit 0. `node --test api/test/` — 57/57, exit 0. `cd host && node --test --test-timeout=30000 --test-force-exit` — 255/255, exit 0. `cd host && node scripts/e2e-restart.mjs` — 53/53, exit 0. `cd frontend && npx tsc --noEmit -p .` — exit 0; `npm test` — 260/260, exit 0; `npm run build` — exit 0. `node frontend/scripts/live-host-smoke.mjs` — 62/62, exit 0. `node frontend/scripts/browser-mode-smoke.mjs` — 60/60, exit 0. |
| C2 Client cannot set model, provider, reasoning, max_tokens, or ZDR; ZDR fails closed | PASS | `api/_lib/worker.mjs:8-16,65-76` allow-lists fields and sets server-owned model, max_tokens, reasoning, and ZDR. `api/test/worker.test.mjs` — included in `node --test api/test/`, 57/57, exit 0. Independent mocked handler probe sent client `model`, `provider`, `reasoning`, and `max_tokens: 1`; upstream observed server model, low reasoning, ZDR deny, and `max_tokens: 4000` — exit 0. |
| C3 Deadlines consistent/documented; Vercel Hobby allows maxDuration 120 | PASS | `vercel.json:8-10` sets `maxDuration: 120`; `api/_lib/worker.mjs:26` uses 115000 ms upstream; `frontend/src/browser/site.ts:41-44` uses 120000 ms request and 10000 ms status deadlines; `host/worker.mjs:21,92-94` defaults Node worker timeout to 120000 ms; `docs/DEPLOY.md:67-69` documents the 120/115-second relationship. `git diff --check main...feat/polish` — exit 0. `curl -fsSL https://vercel.com/docs/functions/configuring-functions/duration` — exit 0; local assertion that the current page reports Hobby maximum 300s — exit 0. |
| C4 No server names/secrets in browser bundle; no new frontend runtime dependencies | PASS | After build, exact `grep -RIn -E 'SILICUS_WORKER_|OPENROUTER|SILICUS_DEMO_PASSCODE|sk-or-|sk-ant-' frontend/dist` had no matches — grep exit 1 (expected negative result). Dependency comparison against main — exit 0; `git diff main...feat/polish -- frontend/package.json frontend/package-lock.json` empty — exit 0. Runtime dependencies remain React and React DOM (`frontend/package.json:14-17`). |
| C5 Waiting UI is honest and matches the worker/view | PASS | `frontend/scripts/browser-mode-smoke.mjs` — 60/60, exit 0; it checks no progress/percentage, real elapsed time/ranges/counts, status-gated retention language, exact worker-body agreement for the browser plan path, and view-derived receipts. `frontend/src/components/AiWaiting/model.ts:87-145,160-195` derives descriptions and receipts from step/view data; `LiveCourse.tsx:38-57,116-125,220-270` constructs steps from the current view and computes receipts from the refreshed view. Worker payload paths are `host/handler.mjs:259-279`, `host/course.mjs:466-513`, and `host/worker.mjs:265-280,353-365,391-403`. No under-reporting mismatch was found. |
| C6 Material text is not persisted by the waiting UI | PASS | Added-line persistence scan `git diff main...feat/polish -- frontend | grep -nE '^\\+.*(localStorage|sessionStorage|indexedDB|IndexedDB)'` — grep exit 1 (expected no added persistence API). Browser-mode smoke's material-storage checks — 60/60, exit 0. |
| C7 Accessibility and motion | PASS | `frontend/src/components/AiWaiting/AiWaiting.tsx:91-114` has one polite live region with start/finish-only updates; `:172-176` uses a keyboard-reachable button with `aria-expanded`/`aria-controls`; `AiWaiting.module.css:34-50` disables animation for still motion and `prefers-reduced-motion`. `cd frontend && npm test` — 260/260, exit 0; browser smoke reduced-motion/live-region checks — 60/60, exit 0; source scan for `aria-live|prefers-reduced-motion|animation|What the model sees` — exit 0. |
| C8 Existing assertion edits are deliberate, not weakened | PASS | `git diff --unified=4 main...feat/polish -- ':(glob)**/*.test.*' ':(glob)**/*smoke*.mjs'` — capture exit 0. Inventory and judgment are below. Strict equality/count assertions remain strict; modified expectations correspond to the documented deadline/status/reasoning contract changes, while new checks add coverage. |

Findings by severity

CRITICAL

None.

HIGH

None.

MED

None.

LOW

None.

C8 assertion-edit inventory and judgment

- `api/test/config.test.mjs:10-14`: the pre-existing maxDuration assertion and its test label changed from 60 to 120. Deliberate deadline behavior change; exact assertion remains.
- `api/test/status.test.mjs:24-30,50-56`: pre-existing exact status-shape assertions gained `typicalSeconds`. Deliberate API-contract change; exact equality remains.
- `api/test/worker.test.mjs:65-71`: the upstream body-key allow-list gained server-selected `reasoning`. Deliberate behavior change; exact key equality remains.
- `api/test/worker.test.mjs:112-128`: the pre-existing max_tokens test was deliberately rewritten from `min(client, cap)` to server-owned cap semantics. The revised table tests client values 1, 100, 99999, negative, string, and an env cap; it is stronger for C2, not a weakened check.
- `api/test/worker.test.mjs:137-142`: the pre-existing upstream deadline assertion changed from 55 seconds to 115 seconds, matching the 120-second function budget with five seconds headroom. Deliberate deadline change; exact assertion remains.
- `frontend/src/browser/browserHost.test.ts:330-338`: the pre-existing status expectation gained `typicalSeconds`; it remains an exact response assertion. The added truncation test is new coverage.
- `frontend/src/browser/site.deadline.test.ts:349-362`: import changed to expose `REQUEST_TIMEOUT_MS`, and a new exact 120-second assertion was added. Existing deadline behavior checks were not weakened.
- `host/test/materials-flow.test.mjs:40-44,268-271`: the boot helper gained injectable worker environment and the status-shape assertion gained `typicalSeconds`. These are deliberate test/configuration changes; exact assertions remain.
- `host/test/worker.test.mjs`: no pre-existing assertion was weakened; reasoning, truncation, timeout, and environment-parity tests were added.
- `frontend/scripts/browser-mode-smoke.mjs`: the existing passcode screenshot was scoped to the dialog, and the fixed plan polling timeout became `PLAN_MS + 15000` to accommodate the intentionally slow mock. Existing acceptance checks remain, with additional waiting/receipt/accessibility/storage checks added.
- `frontend/src/components/AiWaiting/AiWaiting.test.tsx`: entirely new test file; it edits no pre-existing assertion.

Verification command and route

Artifact report path: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verifier-polish-report.md
Primary verification command: `node --input-type=module - <<'NODE' ...` mocked `/api/worker` client-control probe; captured exit code 0 and output `mocked client-control probe: PASS`.
Suite verification commands: listed per criterion above; all required commands completed with exit code 0, with negative grep checks explicitly recorded as expected exit code 1.
Model route: openai-codex / gpt-5.6-luna (independent verifier route).
