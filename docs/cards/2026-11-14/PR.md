# PR · Plan drafts must finish (the REL blocker)

**Owner decision (19 Nov): "queue it."** REL's DO NOT SHIP rests on one thing: of L2's 37 live plan calls, 23 finished, **10 were cut at
the 16,000-token ceiling** (the model's reasoning used all 16,000 under `reasoning: low`), and **4 never answered** (120–130 s). Both
hosts recovered only by retrying in front of the teacher. This is the core teacher action. Fix it.

New branch `feat/pr` from the `main` sha in the unblock comment; worktree `/Users/bonorinoa/Hermes/Projects/silicus-wt/PR`.
Node `/Users/bonorinoa/.local/bin/node`. Commit `wip(PR)` after each item. **Tests first.**

Read first: `host/worker.mjs` (the plan task, `maxTokens`, the reasoning setting), `api/_lib/worker.mjs` (the Vercel copy, including
the per-task reasoning), L2's record `~/Hermes/Projects/silicus-private/live-tests/2026-11-18/stress/STRESS.md` and `cases.tsv` rows
O09–O11 (private; never copy source text into the repo), and `eval/plan/` if a plan eval runner exists.

1. **Reasoning off for the plan task.** L2 measured the cause: with `reasoning: low`, the model's hidden reasoning consumed the whole
   16,000-token budget and the plan itself never arrived. N1 already turned reasoning off for ranking and the helper and it worked.
   Turn it off for the plan task in both hosts and in the Vercel function's per-task setting. The client still cannot set it.
   Keep the 16,000 output cap and the 32,000 ceiling. Add a test that the plan task's request carries reasoning off.
2. **A scripted reliability set.** Build a runner (under `eval/plan-reliability/`) that drafts a plan for each of 12 fixtures: short,
   long (many sources), 50 objectives (L2's L07), a non-English source, ages at each band including 18+ and unknown, and the two
   courses L2 found hardest (read which from the private record; do not copy their source text, write your own stand-ins). Scripted
   worker only: assert a complete plan (activities, minutes, citations) comes back, and that a truncated or empty draft is retried
   **once, automatically, inside the host**, not by the teacher clicking again. The retry is recorded in the trace.
3. **The wait.** A plan that cannot be drafted after the retry shows a plain sentence ("Silicus couldn't finish this plan. Try again,
   or shorten the sources.") and records the failure where a teacher can see it (L2 O02: four failed drafts appeared nowhere).
   The UI's 10–60 s hint becomes honest: show elapsed seconds, as N1 did for the map.
4. **The age label (L2 O10).** `plan.audience` is the model's guess and disagreed with the teacher's ages on 8 of 9 plans. The displayed
   ages come from the course record, not from the model's line. Test it.
5. **Paid check, one run, ≤ $0.30.** Run the 12 fixtures against the live model with the credential via
   `SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env` (never read the file). Record finish rate, p50/p95 and cost in
   `docs/verification/2026-11-19-plan-reliability.md`. **Target: 12 of 12 finished, p95 under 75 s.** If you miss it, say exactly which
   fixtures and why; do not hide a miss behind a retry.

Run every STATUS §3 suite plus studio-smoke and narrow-shell. Commit on `feat/pr`, no push.

## Fence

No `confirm-gate/`. No change to the plan's schema or to what "confirmed" means. No model call except item 5.
