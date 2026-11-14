# P3a · v2 plans from the same inputs, and the blind scoring set (paid, small)

Worktree `/Users/bonorinoa/Hermes/Projects/silicus-wt/P3`, new branch `eval/plan-v2` from `feat/p2` (P2 done), then merge
`eval/plan-baseline` into it for the harness (`eval/plan-quality/`). Worker credential: start the host with
`(cd host && SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env npm run start:worker)`. Never read that file.

1. Re-run B1's harness on the v2 code for the same three courses, two runs each (6 plans), adding the structured ages
   (5–8, 5–12, 19) and the anchors (`mt_WRRv1ABECC`, `mt_AzTrT5ySCx`, none for Ecom 57). Save to
   `eval/plan-quality/v2-2026-11-14/`. At most 12 model calls. Record model id, latency, cost if reported.
2. Build the blind set: the 6 baseline + 6 v2 plans, each rendered as plain text (title, audience ages, activities with
   labelled fields, cited objective statements, plan-level fields), **stripped** of model names, versions, ids, timestamps and
   field names that reveal the version (render new fields as plain labelled lines, and render baseline plans through the same
   renderer). Shuffle with a recorded seed. Write the 12 texts and a sealed key to
   `/Users/bonorinoa/Hermes/Projects/silicus-private/plan-scoring/2026-11-14/` (outside git; the key in `key.json`).
3. Judge A: score all 12 with the frozen rubric (`…/plan-rubric/2026-11-14-rubric-v0.3.md` page 2 plus
   `…-decisions.md`), one plan per prompt, no access to the key, on your own route (DeepSeek). Output per the rubric's format to
   `…/plan-scoring/2026-11-14/judge-deepseek.md`.
4. Commit only the harness changes and the 6 v2 plan JSONs on `eval/plan-v2`. The scoring folder stays private.

Fence: no product code change. Do not open `key.json` while judging (write it, close it, judge from the texts only).
