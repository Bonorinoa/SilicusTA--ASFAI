VERDICT: BLOCK

Silicus TA 3.0 — independent verification of feat/polish

Artifact under review: /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-verify-polish (detached HEAD bbfb7838ff49a8e66ee42a059bca37eed956309b)
Comparison: git diff main...HEAD; main is 31f5fbc44cd6755a948d6cb1dd33d8f802ff188e

Criteria

| Criterion | Result | Evidence (command; captured exit code) |
|---|---|---|
| C1 Suites green and confirm-gate unchanged | PASS | `cd confirm-gate && node --test` — 41/41, exit 0. `git diff main -- confirm-gate` empty — exit 0. `node --test api/test/` — 57/57, exit 0. `cd host && node --test --test-timeout=30000 --test-force-exit` — 255/255, exit 0. `cd host && node scripts/e2e-restart.mjs` — 53/53, exit 0. `cd frontend && npx tsc --noEmit -p . && npm test && npm run build` — 260 frontend tests, build successful, exit 0. `node frontend/scripts/live-host-smoke.mjs` — 62/62, exit 0. `node frontend/scripts/browser-mode-smoke.mjs` — 60/60, exit 0. |
| C2 Proxy-owned reasoning/model/provider/max_tokens/ZDR controls | FAIL | Mocked `/api/worker` probe — exit 0, but upstream received `max_tokens:1` from the client while server cap was 4000; it also correctly received server model, low reasoning, and ZDR. The implementation reads `input.max_tokens` at `api/_lib/worker.mjs:71-72`. |
| C3 Deadline consistency/documentation and Vercel Hobby allowance | PASS | `git diff --check main...HEAD` — exit 0. `curl -fsSL https://vercel.com/docs/functions/configuring-functions/duration` — exit 0; `grep -q 'Hobby</td><td>300s (5 minutes)</td><td>300s' .../vercel-duration.html` — exit 0. Current Vercel docs allow Hobby up to 300s, so `vercel.json:9` maxDuration 120 is allowed. `docs/DEPLOY.md:66-68` documents 120s function / 115s upstream. `api/_lib/worker.mjs:25` is 115000ms; `frontend/src/browser/site.ts:42-44` is 120000ms/10000ms; `host/worker.mjs:19,70-90` defaults the Node worker to 120000ms. |
| C4 No server env/key names or secrets in browser output; no new frontend runtime deps | PASS | After build, `grep -RIn --exclude='*.map' --exclude='*.env' -E 'SILICUS_WORKER_|OPENROUTER|SILICUS_DEMO_PASSCODE|sk-or-|sk-ant-' frontend/dist` — no matches, grep exit 1 (expected no-match result). Dependency comparison script for `frontend/package.json` dependencies — equal=true, exit 0. `git diff main...HEAD -- frontend/package.json frontend/package-lock.json` empty — exit 0. |
| C5 Waiting UI honesty and wire/view agreement | PASS | `node frontend/scripts/browser-mode-smoke.mjs` — 60/60, exit 0; this includes no progress/percentage, real counts/ranges/clock, status-gated retention text, exact browser worker-body checks, and receipts. `nl -ba frontend/src/components/AiWaiting/model.ts`, `AiWaiting.tsx`, `LiveCourse.tsx`, `StudentChat.tsx`, `host/handler.mjs`, and `host/worker.mjs` — exit 0; the model/plan/answer summaries match the worker prompt inputs for the tested paths, and receipts are recomputed by `proposalsReceipt`/`planReceipt` from the resulting view. |
| C6 Material text is not persisted by the waiting UI | PASS | `git diff main...HEAD -- frontend | grep -nE '^\\+.*(localStorage|sessionStorage|indexedDB|IndexedDB)'` — no matches, grep exit 1 (expected). Browser smoke also reports material text absent from IndexedDB and web storage, exit 0. |
| C7 Accessibility and motion | PASS | `cd frontend && npx tsc --noEmit -p . && npm test && npm run build` — exit 0; 39 AiWaiting tests pass. `grep -RIn ... -E 'aria-live|prefers-reduced-motion|animation|What the model sees' frontend/src/components/AiWaiting frontend/src/live frontend/scripts/browser-mode-smoke.mjs` — exit 0. Tests and smoke verify one polite start/finish live region, keyboard disclosure, and animation removal under reduced motion. |
| C8 Existing assertion edits are deliberate rather than weakened | PASS | `git diff --unified=0 main...HEAD --` over all 9 changed `*.test.*`/`*smoke*.mjs` files — exit 0. Every pre-existing assertion edit is listed and judged below; no check was removed or weakened. |

Findings by severity

HIGH

1. C2 is not satisfied for `max_tokens`: the client still controls the upstream value within the server cap.
   Evidence: `api/_lib/worker.mjs:71-72` assigns `asked = input.max_tokens` and sends `Math.min(asked, settings.maxTokensCap)`. The pre-existing test at `api/test/worker.test.mjs:240-245` explicitly asserts client values such as 100 are forwarded (bounded). Independent mocked-handler command, exit code 0, returned:
   `{"status":200,"model":"server-model","max_tokens":1,"reasoning":{"effort":"low"},"provider":{"zdr":true,"data_collection":"deny"}}`.
   Model, reasoning, provider, and ZDR were server-owned in that probe; `max_tokens` was not. This can also turn a normal worker call into a predictable truncation refusal, and it directly contradicts the acceptance wording that the client cannot set `max_tokens`.

MED

None found.

LOW

None found.

C8 assertion-edit inventory and judgment

- `api/test/config.test.mjs:16,18`: existing expectation and label changed from maxDuration 60 to 120. Deliberate deadline change; the assertion remains exact and the 120 value is allowed by current Vercel Hobby documentation.
- `api/test/status.test.mjs:16-17,50-51`: existing exact status-shape assertions extended with `typicalSeconds`. Deliberate API-contract change; strict equality remains.
- `api/test/worker.test.mjs:167`: existing upstream-key allow-list extended with the new server-selected `reasoning` field. Deliberate behavior change, not a weakened check.
- `api/test/worker.test.mjs:296-320`: existing 55-second deadline assertion changed to the intended 115-second proxy deadline and its rationale. Deliberate deadline change; still exact.
- `frontend/src/browser/browserHost.test.ts:335-338`: existing status-shape assertion extended with `typicalSeconds`. Deliberate forwarding contract; strict equality remains.
- `frontend/src/browser/site.deadline.test.ts`: no pre-existing assertion was weakened; it adds an exact 120-second constant assertion.
- `host/test/materials-flow.test.mjs:40-44,268-271`: test boot helper gains injectable worker env and the existing status shape gains `typicalSeconds`. Deliberate test/configuration changes; strict equality remains.
- `host/test/worker.test.mjs`: no pre-existing assertion was edited; new reasoning, truncation, timeout, and env-parity assertions were added.
- `frontend/scripts/browser-mode-smoke.mjs`: the existing passcode screenshot is scoped from the whole page to the dialog, and the old fixed plan poll timeout is made `PLAN_MS + 15000` to support the intentionally slow mock. These are harness changes, not weakened acceptance assertions; existing checks remain and new checks increase coverage.
- `frontend/src/components/AiWaiting/AiWaiting.test.tsx`: entirely new test file; no pre-existing assertion was edited.

Verification commands and route

Worktree setup command: `git -C /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff worktree add --detach /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-verify-polish feat/polish` — exit 0. The requested branch was already checked out by another worktree, so this verifier used a detached worktree at the exact feat/polish commit. Node modules were symlinked from the main repo as requested.

Primary verification command with the blocking result: the mocked `node --input-type=module` `/api/worker` probe above — captured exit code 0; its output is the evidence of the incorrect `max_tokens` ownership.

Model route: openai-codex / gpt-5.6-luna (independent verifier route).
