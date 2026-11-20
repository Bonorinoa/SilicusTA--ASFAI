# Plan-draft reliability (19 November 2026)

**Status:** a dated record. Do not edit it. Add a newer record instead.

**Verdict:** **PASS for this one run.** All 12 plan fixtures finished, with no automatic retry needed. Nearest-rank p50 was 15.470 s and p95 was 37.497 s. Both card targets were met: 12 of 12 finished and p95 was under 75 s.

## Method

- Branch `feat/pr`, implementation at `0ba6f6d` plus the already committed reasoning change `5597479`. Node v22.22.3.
- Command from the repository root:
  `SILICUS_WORKER_ENV_FILE=/Users/bonorinoa/.silicus/worker.env /Users/bonorinoa/.local/bin/node eval/plan-reliability/run.mjs --live --out /Users/bonorinoa/.hermes/profiles/engineer/cache/scratch/2026-11-19-plan-reliability-live.json`
  (exit 0). The runner delegates credential loading to `host/scripts/with-worker-env.mjs`; no credential was printed or copied.
- Route reported by the worker: model `deepseek/deepseek-v4-flash-0731`, OpenAI-compatible provider wire, ZDR on. Plan reasoning was off. The 16,000-token output cap and 32,000 ceiling remained unchanged.
- Twelve original public-safe stand-ins covered a short course, 16 named sources, 50 confirmed objectives, a Spanish-language source description, every age-stage branch, 18+, unknown ages, and original adult/ages-10–11 stand-ins for L2's difficult shapes. No private source text was copied.
- Times below are the wall time of `POST /plan`, excluding deterministic course setup. The runner required at least one activity, positive whole minutes, and confirmed-objective citations. It inspected the course trace to count host retries.
- This was the card's single paid live run. No fixture was re-run.

## Result

| Fixture | Finished | Plan time | Host attempts | Activities | Objective citations |
|---|---:|---:|---:|---:|---:|
| short-stage-1 | yes | 12.017 s | 1 | 4 | 4 |
| many-sources-stage-2 | yes | 36.665 s | 1 | 5 | 16 |
| fifty-objectives-stage-3 | yes | 34.616 s | 1 | 6 | 11 |
| spanish-source-stage-4 | yes | 16.584 s | 1 | 5 | 6 |
| adult-18-plus | yes | 19.159 s | 1 | 8 | 13 |
| unknown-ages | yes | 15.470 s | 1 | 7 | 18 |
| l2-hard-adult-stand-in | yes | 17.843 s | 1 | 6 | 9 |
| l2-hard-under-18-stand-in | yes | 9.067 s | 1 | 6 | 17 |
| stage-1-boundary | yes | 6.577 s | 1 | 5 | 7 |
| stage-2-boundary-empty-retry | yes | 9.146 s | 1 | 6 | 7 |
| stage-3-boundary | yes | 6.544 s | 1 | 5 | 8 |
| stage-4-wide | yes | 37.497 s | 1 | 8 | 13 |

Summary: **12/12 finished; p50 15.470 s; p95 37.497 s; 12 model calls; provider-reported total cost USD 0.00668938 (budget USD 0.30).** There were zero live retries and zero failed fixtures, so there is no miss to hide behind a retry.

The separate scripted gate injects a truncated reply and an empty/bad reply and proves that each is retried exactly once inside `CourseSession`, with `plan.retry` then `plan.drafted` in the trace. Its final-failure probe proves that two bad attempts return `PLAN_DRAFT_FAILED` with the teacher sentence and leave `plan.failed` in the course record.

## Limits

This is one run on one model route with synthetic stand-ins. It is evidence that the measured failure mode did not recur in these 12 calls; it is not a general reliability guarantee and it does not erase L2's earlier 10 truncations and 4 timeouts.
