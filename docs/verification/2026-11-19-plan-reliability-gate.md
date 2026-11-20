# PRV · Plan reliability gate on `9c86127`, 19 November 2026

## Verdict: **ACCEPT — `feat/pr` may merge**

The REL live-plan blocker is closed for this candidate. PR's paid record finished 12/12 fixtures, and my independent run finished the three fixtures that were slowest in PR's run plus its fastest fixture: 4/4, one attempt each. The deterministic host retry, teacher-visible failure record, server-owned reasoning setting, recorded-age display, and truncation guard all survived destructive mutations.

- **Root:** `/Users/bonorinoa/Hermes/Projects/silicus-wt/PRV`, branch `verify/p1`.
- **Candidate:** `9c861270143ebf1e886612344bc2d2b741d0cedf` (`feat/pr`).
- **Node:** `/Users/bonorinoa/.local/bin/node`, `v22.22.3`.
- **Verifier route:** `/Users/bonorinoa/.hermes/profiles/verifier/logs/agent.log:6771` records `API call #1: model=gpt-5.6-sol provider=openai-codex`; later calls in this session show the same route.
- **Fence:** the candidate code was read-only. Mutations ran only in clean archive exports. The only committed writes are this record and its probe under `docs/verification/`. No `confirm-gate/` file changed; no push, deploy, PR, email, or private source-text copy occurred. The first paid export used macOS `$TMPDIR`, was removed after its logs were copied to verifier scratch, and the probe was then changed and re-run so all future exports use `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/`.

## 1. Clean-archive matrix

The committed-form probe ran from the verifier worktree:

```sh
env -u PYTHONPATH /Users/bonorinoa/.local/bin/python3 \
  docs/verification/2026-11-19-plan-reliability-gate-probe.py --keep
# exit 0
```

It made a clean `git archive 9c86127`, ran `npm ci` in the exported `frontend/`, and invoked Node by its absolute path. Every candidate suite exited 0:

| Command | Exit | Result |
|---|---:|---:|
| `(cd confirm-gate && node --test)` | 0 | 52 pass, 0 fail |
| `node --test api/test/` | 0 | 59 pass, 0 fail |
| `(cd host && node --test)` | 0 | 486 pass, 0 fail |
| `(cd host && node scripts/e2e-restart.mjs)` | 0 | 58/58 |
| `(cd frontend && npm test)` | 0 | 648 pass in 73 files |
| `(cd frontend && npm run build)` | 0 | built in 3.00 s; existing chunk-size warning only |
| `node frontend/scripts/browser-mode-smoke.mjs` | 0 | 316/316 |
| `node frontend/scripts/studio-smoke.mjs` | 0 | 108/108 |
| `node frontend/scripts/live-host-smoke.mjs` | 0 | 89/89 |
| `node frontend/scripts/narrow-shell.mjs` | 0 | 68/68 |
| `node --test eval/plan-reliability/run.test.mjs` | 0 | 3 pass, 0 fail |

The five scripted acceptance totals that REL counted remain **639/639**: 58 + 316 + 108 + 89 + 68. The new three-test plan-reliability gate is additional.

## 2. Plan reasoning is off and server-owned

- Shared policy: `host/worker-config.mjs:30` fixes `plan: "off"`.
- Node host: `host/worker.mjs:187-190` applies the task policy to the upstream body; `host/test/worker.test.mjs:268-273` checks that a configured default of low still sends `{enabled:false}` for a plan.
- Browser host: `frontend/src/browser/browserHost.ts:144-152` uses the shared `PlanWorker` and sends the task name to `/api/worker`; it does not choose the upstream reasoning value.
- Vercel function: `api/_lib/worker.mjs:76-82` rebuilds the body from its allow-list, derives reasoning from the server's task policy, and does not forward a client reasoning field. `api/test/worker.test.mjs:390-401` checks plan off and checks that client `reasoning:{effort:"high"}` cannot override it.

Destructive mutation in a fresh export changed only the shared plan policy from off to low:

| Mutation command | Child exit | Failing guard |
|---|---:|---|
| `(cd host && node --test test/worker.test.mjs test/n1-waits.test.mjs)` | 1 | 2 failures: policy table read `plan:low`; actual plan body became `{effort:"low"}` instead of `{enabled:false}` |
| `node --test api/test/worker.test.mjs` | 1 | 1/31 failed: Vercel plan body became `{effort:"low"}` instead of `{enabled:false}` |

The probe expected those non-zero child exits and itself exited 0.

## 3. Automatic retry and a teacher-visible final failure

`host/course.mjs:761-795` makes one second host-side attempt for truncation, bad output, timeout, or an unreachable worker. It appends `plan.draft_retried` before retrying and appends `plan.draft_failed` after the second failure. `host/activity.mjs:65-68` turns those persisted events into `plan.retry` and `plan.failed` activity rows. The teacher-facing rail says “Retried the lesson plan after an incomplete reply” and “Could not finish the lesson plan after retrying” (`frontend/src/components/ActivityRail/copy.ts:79-82`). The refusal surface gives the required plain sentence and says the failed draft and retry were kept (`frontend/src/lib/refusals.ts:84-87`).

The direct host tests at `host/test/worker.test.mjs:596-625` establish both paths and reload the course to prove the rows survive replay. The scripted reliability gate independently obtained:

- first truncated reply → two calls → `plan.retry`, then `plan.drafted`;
- two bad replies → two calls → `PLAN_DRAFT_FAILED` with “Silicus couldn't finish this plan. Try again, or shorten the sources.” → persisted `plan.failed`.

This answers REL O02: the failed attempt is no longer absent from the teacher's record.

## 4. Displayed ages come from the course

Current Studio call sites pass `view.course.ages` into the plan card (`frontend/src/studio/steps/PlanStep.tsx:90-99`, `PublishStep.tsx:95-105`) and into the downloaded handout (`PublishStep.tsx:23-25`). `PlanCard.tsx:31-32,199-200` and `live/handout.ts:19-27` render that argument, not `plan.audience`.

A fresh-export mutation replaced both display paths with `plan.audience` and ran:

```sh
(cd frontend && npm test -- \
  src/components/PlanCard/PlanCard.test.tsx src/live/handout.test.ts)
# exit 1: 3 failed, 34 passed
```

The failures showed the model guess `Ages 18–40` / `Ages 8–10` where the tests required course ages `Ages 10–12`, and showed a guessed age when course ages were unknown.

## 5. Paid reliability evidence

PR's immutable record, `docs/verification/2026-11-19-plan-reliability.md`, reports **12/12 finished**, p50 **15.470 s**, p95 **37.497 s**, 12 model calls, zero retries, and provider-reported cost **$0.00668938**.

I selected PR's three slowest fixtures and its fastest fixture, then ran only those four through the live Node-host path. The credential path was forwarded to `host/scripts/with-worker-env.mjs`; I did not read or print the file.

```sh
env -u PYTHONPATH /Users/bonorinoa/.local/bin/python3 \
  docs/verification/2026-11-19-plan-reliability-gate-probe.py --live --keep
# exit 0
```

| Fixture | Why selected | Finish | Time | Host attempts |
|---|---|---:|---:|---:|
| `stage-4-wide` | PR slowest, 37.497 s | yes | 16.716 s | 1 |
| `many-sources-stage-2` | PR second slowest, 36.665 s | yes | 14.389 s | 1 |
| `fifty-objectives-stage-3` | PR third slowest, 34.616 s | yes | 29.182 s | 1 |
| `stage-3-boundary` | PR fastest, 6.544 s | yes | 6.320 s | 1 |

Result: **4/4 finished**, p50 **14.389 s**, p95 **29.182 s**, four model calls, no retry, provider-reported cost **$0.00344605** against the **$0.15** cap. The host status reported `deepseek/deepseek-v4-flash-0731`, OpenAI-compatible wire, ZDR on.

## 6. REL condition 2: the scripted gate now bites on truncation

The clean gate passes 3/3. In a fresh export the probe changed the scripted worker so `short-stage-1` returned `WORKER_TRUNCATED` on both attempts, then ran:

```sh
node --test eval/plan-reliability/run.test.mjs
# exit 1: 1 failed, 2 passed
```

The failing assertion showed `PLAN_DRAFT_FAILED` with the required teacher sentence instead of a completed fixture. This is the missing executable coverage REL identified: the old 639 checks remain green, and the new reliability suite separately fails when the plan task remains truncated.

## 7. Merge compatibility and artifacts

```sh
git merge-tree --write-tree main feat/pr
# exit 0; tree 9be97e958ac7c244f30e992414160b6d63d44e87
```

- Candidate artifact: `9c861270143ebf1e886612344bc2d2b741d0cedf`.
- Verification record: `docs/verification/2026-11-19-plan-reliability-gate.md`.
- Reproduction probe: `docs/verification/2026-11-19-plan-reliability-gate-probe.py`.
- Current deterministic logs: `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/prv-plan-reliability-myexztpo/logs/`.
- Paid-run summary: `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/prv-9c86127/logs/live-four.json`.

**Plain answer:** `feat/pr` may merge. This is a measured reliability gate on one model route and synthetic stand-ins, not a general availability guarantee or a production-deployment check.
