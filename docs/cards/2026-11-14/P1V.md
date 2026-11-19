# P1V · Gate on plan reliability, cross-family (Codex)

You may block. You run on **openai-codex / gpt-5.6-sol**. Read P1.md, P1's summary, and REL's record
`docs/verification/2026-11-18-release-gate.md` (condition 1 and condition 2).

1. Clean `git archive feat/p1` export: every STATUS §3 suite plus studio-smoke and narrow-shell, on `/Users/bonorinoa/.local/bin/node`.
2. Confirm the plan task sends reasoning off in **both hosts and the Vercel function**, and that the client cannot set it. Mutation:
   force reasoning low → a test fails.
3. The automatic retry: a truncated draft is retried once inside the host, the retry is in the trace, and a second failure shows the
   plain sentence and is recorded where the teacher can see it (answer REL's O02 finding).
4. The displayed ages come from the course record. Mutation: show `plan.audience` → a test fails.
5. Read P1's paid record. Re-run **4 of the 12 fixtures yourself** (pick the ones P1 found slowest, plus one it found easy) against the
   live model, credential via `SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env`, never reading it, budget ≤ $0.15. Report finish rate and times.
6. Confirm the scripted suite now fails if the plan task returns a truncation (REL condition 2: the 639 checks didn't exercise it).

Record `docs/verification/2026-11-19-plan-reliability-gate.md` on `verify/p1`, commit, no push. Say plainly whether `feat/p1` may merge.
A finish rate under 12/12 in P1's record, or under 4/4 in yours, is a BLOCK unless you can show the miss is the model's alone and the
host handled it exactly as item 3 specifies.
