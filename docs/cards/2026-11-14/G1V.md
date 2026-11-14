# G1V · Independent verifier gate on G1 (Marble source)

You may block. Read the G1 card's summary and metadata (your parent) and the G1 spec at
`docs/cards/2026-11-14/G1.md` on `main`.

## Check

1. **Independence.** Find the producer's route in `/Users/bonorinoa/.hermes/profiles/engineer/logs/agent.log`
   (`API call #N: model=… provider=…`) for the G1 session. If it says `Fallback activated` to a Claude model,
   say that your check is same-family and not independent.
2. **Clean export.** `git archive feat/marble-source | tar -x -C <scratch dir>`, `npm ci`, then run every suite in
   STATUS §3 on Node 22, including `studio-smoke.mjs` and `browser-mode-smoke.mjs`. Report each count and exit code.
3. **Data.** Re-download the two files at the pinned commit and confirm the recorded hashes. Confirm the snapshot
   keeps only the listed fields, the ODbL notice is present, and nothing else from the upstream repo was vendored.
4. **Locks.** No `confirm-gate/` diff. No code path turns an `mt_*` into an objective id or confirms anything.
   `MarbleSource.egress` is null and no network call happens at query time in either host (grep, and run one search
   with the network off if you can).
5. **Behaviour.** The demo edges from the spec; age filter; "maximum likelihood" for ages 19 returns nothing; the two
   routes write nothing to the course log (compare the log before and after a call).
6. **Diff review.** Read the whole diff `main..feat/marble-source`. List findings HIGH / MEDIUM / LOW with file:line.

## Verdict

One of: ACCEPT, ACCEPT WITH CONDITIONS (list them), BLOCK (list what must change). Write the record to
`docs/verification/2026-11-14-g1-marble-verifier.md` in your own worktree on a branch `verify/g1` from
`feat/marble-source`, commit it, do not push.
