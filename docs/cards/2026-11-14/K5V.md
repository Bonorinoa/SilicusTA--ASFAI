# K5V · Gate on `feat/k5` (classic-view parity + polish)

You may block. Read K5.md on `main`, K5's summary and `docs/verification/2026-11-18-classic-parity.md` on `feat/k5`.

1. **Check the parity table independently:** list the capabilities of `437f053:frontend/src/live/` yourself, then diff your list with K5's.
   Any capability the table misses is a finding.
2. The pin check in real Chrome on a live host. Pin a published version, rewrite the stored record consistently (as
   `live-host-smoke` does), press "Check my pinned copies" → "Differs". On an untouched record → "Matches". Mutation: remove the
   `comparePin` call → a test fails. `live-host-smoke` must drive the app's action.
3. Every restored feature works in both hosts (archive verified with its digest; version comparison; revision).
4. Polish items at 390 px, with screenshots.
5. Clean `git archive feat/k5` export, every STATUS §3 suite plus both scripts, using `/Users/bonorinoa/.local/bin/node`.
   The diff `main...feat/k5` touches no `confirm-gate/` and no `api/`.

Verdict and record: write `docs/verification/2026-11-18-k5-gate.md` on `verify/k5`, commit, no push. Say plainly whether `feat/k5` may merge.
