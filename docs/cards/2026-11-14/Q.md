# Q · Paid checks on merged `main` (owner approved, about $0.10)

Runs after the PM merges `feat/g2` into `main` locally (the PM unblocks this card with the merge sha in a comment).
Worktree `/Users/bonorinoa/Hermes/Projects/silicus-wt/Q` at that sha (detached is fine). Worker credential: start the host with
`(cd host && SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env npm run start:worker)`. Never read that file. Model route: the
`openrouter` preset (DeepSeek, zero data retention). Report the model id the worker returns for every call.

## 1. Live plans with timing (question: does a v2 plan fit the Vercel function's 115 s upstream deadline?)

Using the harness in `eval/plan-quality/` (branch `eval/plan-v2` has `run-v2.mjs`; copy it into your worktree, do not merge eval
branches into `main`), draft **one plan each** for: AI in Daily Life (ages 5–12, anchor `mt_AzTrT5ySCx`), Smart Versus Not-Smart
Devices (5–8, anchor `mt_WRRv1ABECC`), and Ecom 57 intro statistics (ages 19, no anchor), **twice each** (6 calls). Record per call:
wall time, output tokens if reported, truncated yes/no, clamp notes. Report min / median / max wall time and compare with 115 s and
with the UI plan wait range (10–60 s). Save outputs to `/Users/bonorinoa/Hermes/Projects/silicus-private/live-checks/2026-11-15/`
(outside git; these are drafts, not fixtures).

## 2. Student-helper eval

`node eval/student-helper/run.mjs` on this sha, as in STATUS §3 (it calls the real model). Report measured / total, refusals by kind,
p95 latency, exit code. Compare with the 19 October record (44/44).

## 3. Record

`docs/verification/2026-11-15-paid-checks.md` on branch `verify/paid-checks` from the merge sha: sha, Node version, model ids,
every number above with its command, cost if the host or OpenRouter reports it, and a plain answer to the 115 s question. Commit,
no push. At most 60 model calls in total; stop and report if a run starts failing (402, 429, timeouts).

## Fence

No code change. No deploy. Do not touch the Vercel project.
