# N6V · Gate on the trust-core change (`feat/n6`)

You may block. This is the first `confirm-gate/` change in this sprint. Read N6.md on `main`, N6's summary, and STATUS section 2.

1. Clean `git archive feat/n6` export: confirm-gate first, then every STATUS §3 suite plus studio-smoke and narrow-shell
   (`/Users/bonorinoa/.local/bin/node`).
2. Read the whole `confirm-gate/` diff line by line. Is it additive? Does any path let something other than the teacher confirm? Does the
   default stay `"ai"`? Does a bad `proposedBy` fail closed?
3. Check every `proposedBy` filter site with your own grep. Is each choice right, and is each one tested?
4. Old records: verify the hash chain, export and pin on a record from before the change (`git show 437f053` era, or a fixture). Mutations:
   default to `"teacher"` → a test fails; drop the edit marker → a test fails.
5. Both hosts are byte-identical on the parity course. The export shows the new fields.

Record `docs/verification/2026-11-18-n6-gate.md` on `verify/n6`, commit, no push. Say plainly whether `feat/n6` may merge.
