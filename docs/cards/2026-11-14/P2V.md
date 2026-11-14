# P2V · Verifier gate on `feat/p2` (host side)

You may block. Read `docs/cards/2026-11-14/P2.md` on `main` and the P2 summary.

1. Producer route (engineer log); flag a Claude fallback.
2. Clean `git archive feat/p2` export: confirm-gate, api, host, e2e restart on Node 22.
3. v1 plans still valid; the clamp table holds for every stage (write your own cases, not the producer's); the model can never
   set the stage; no `aiStatus` without ages; unknown values dropped with a note.
4. The prompt: read it in full. Does it ask for every rubric-relevant move in plain terms? Does it leak anything private
   (rubric or booklet wording beyond a short phrase, or Sarah's name outside a code comment)? Untrusted-material rules intact?
   The anchored prompt includes the hard prerequisite only when an anchor exists.
5. No `frontend/`, `confirm-gate/` or `api/` diff. Mutation-test the clamps.

Verdict ACCEPT / ACCEPT WITH CONDITIONS / BLOCK, record `docs/verification/2026-11-14-p2-verifier.md` on `verify/p2` from
`feat/p2`, commit, no push.
