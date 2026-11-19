# N5V · Gate on `feat/n5`

You may block. Read N5.md on `main`, N5's summary and your own N1V record (`docs/verification/2026-11-18-n1-gate.md`).

1. Clean `git archive feat/n5` export: every STATUS §3 suite plus studio-smoke and narrow-shell (`/Users/bonorinoa/.local/bin/node`).
2. Re-run your N1V probes: `n4-attempt-probe` must now give attempt_first without the cite, and `n4-grading-probe` must stop 16/16. Then write
   10 **new** grading phrasings the producer has not seen, and 10 innocent questions that use the words "correct", "score" or "grade"
   in another sense, for example "what is the correct formula". Report both rates. Over-refusing innocent questions is a finding too.
3. Mutations: remove the output check; remove the title/number backstop. Each must fail a test.
4. Add, remove and reorder activities in real Chrome on both hosts. The minutes check re-runs, and the logs are byte-identical across hosts.
5. C3 text and the C6 explanation. Diff `main...feat/n5`: no `confirm-gate/` and no `api/` changes.

Record `docs/verification/2026-11-18-n5-gate.md` on `verify/n5`, commit, no push. Say plainly whether `feat/n5` may merge.
