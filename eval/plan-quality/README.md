# Plan-quality eval (14 November round)

## `run-baseline.mjs` — B1 baseline plans (before set)

Drives the REAL local host API (worker configured from the owner's credential) to create,
confirm and draft a lesson plan for three courses, two runs each (six plans), and saves each
drafted plan JSON with the model id the worker reported, the draft latency and the sha-256 of
the plan.

```sh
node eval/plan-quality/run-baseline.mjs
```

- The host is started by the script from `host/` via `npm run start:worker`, on a free loopback
  port, with an isolated `SILICUS_HOST_DATA` temp dir (never `~/.silicus/host`).
- The worker env file is named by `SILICUS_WORKER_ENV_FILE` (default `~/.silicus/worker.env`).
  The launcher reads it; the script never reads, prints or copies it.
- Exactly one model call per run: `POST /api/courses/:id/plan`. Nothing else calls a model
  (objectives are the teacher's own, derived from the intake answers and accepted by the
  teacher, as the no-ASFAI product path does). Six runs = six model calls.
- Knowledge sources are left at their defaults (off): this is the baseline of the current
  prompt with no ontology file and no ASFAI connection.

## Outputs: `baseline-2026-11-14/`

- `<course>-<run>.json` — one file per plan: course/run identity, `modelId`, `provider`,
  `zdr`, `draftLatencyMs`, `planSha256` (sha-256 of the plan JSON), `chainHead` and
  `chainVerify` (per-course event-log verification), the confirmed objectives, and the plan
  itself under `plan`.
- `manifest.json` — the run summary (worker identity, knowledge sources, model-call count,
  per-run latencies, file list).
- All sha-256 values are computed by the script and re-verified against the files on disk
  before the run exits 0.
