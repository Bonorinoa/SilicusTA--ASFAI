# Plan reliability

This gate exercises the real `CourseSession` plan path with twelve original fixtures. It does not copy text from the private L2 stress record.

Coverage is explicit in `fixtures.mjs`: a short brief, many source names, fifty objectives, a Spanish-language source stand-in, every age stage, an 18+ course, unknown ages, and original stand-ins for L2's difficult adult and ages 10–11 courses.

## Scripted gate (no network, no model)

```sh
node --test eval/plan-reliability/run.test.mjs
node eval/plan-reliability/run.mjs
```

The scripted run requires every fixture to return activities, positive whole minutes, and citations to confirmed objective IDs. It injects a truncation and an empty/bad reply; each must be retried once inside the host and leave `plan.retry` in the course activity. A separate second-failure probe must return the teacher sentence and leave `plan.failed` in the record.

## One paid run

```sh
SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env \
  node eval/plan-reliability/run.mjs --live --out /path/outside-the-repo/plan-reliability-live.json
```

The runner never reads the credential file. It starts `host/scripts/with-worker-env.mjs`, which reads and filters that named file. It sends fixtures serially, records each plan request's elapsed time and automatic retry count, and reports finish rate, nearest-rank p50/p95, model-call count, and provider-reported cost. No plan or source text is written to the summary.

A live run exits nonzero if fewer than twelve plans finish or provider-reported cost exceeds $0.30. The report also states whether p95 is under 75 seconds; a latency miss remains visible even when all plans finish.
