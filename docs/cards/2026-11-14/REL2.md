# REL2 · Release re-gate, delta only (Codex)

You may block. You run on **openai-codex / gpt-5.6-sol**. This is a delta on REL
(`docs/verification/2026-11-18-release-gate.md`), not a full re-gate. Runs on the `main` sha the PM gives once PR is merged.

REL gave DO NOT SHIP on five conditions. Re-check exactly these:

1. **Plan reliability (was the blocker).** Read `docs/verification/2026-11-19-plan-reliability.md` and PRV's record. State the finish
   rate, p95, and whether the host retries once and records a failure the teacher can see. Run the PR reliability suite yourself from
   a clean export (scripted, no paid calls) and confirm it fails on a truncation.
2. **Condition 3, unchanged by design.** Confirm "AI never grades" is still prompt + refusal flag + partial nets, and that the app's own
   copy does not call it a guarantee. Quote the line. This stays an owner acceptance, not a defect.
3. **Regressions.** From a clean export: confirm-gate, host, studio-smoke, narrow-shell, on `/Users/bonorinoa/.local/bin/node`.
4. **The Vercel path for the plan task.** Read `api/_lib/worker.mjs`: does the plan task's reasoning setting and the 16,000 cap match
   the local host? Name any difference.

Verdict: **SHIP WITH CONDITIONS** if item 1 holds and item 3 is green, listing exactly what the owner accepts (condition 3, and anything
still open). **DO NOT SHIP** if the plan path can still fail silently. Record `docs/verification/2026-11-19-release-gate-2.md` on
`verify/release2`, commit, no push.
